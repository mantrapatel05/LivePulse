(function (window, document) {
  "use strict";

  var SCHEMA_VERSION = 2;
  var FLUSH_INTERVAL_MS = 5000;
  var MAX_INFLIGHT_QUEUE = 20; // in-memory: flush early once this many events are waiting
  var MAX_PERSISTED_QUEUE = 200; // localStorage-backed retry queue, bounded so a long outage can't grow it forever
  var MAX_BATCH_BYTES = 60000; // stay comfortably under the backend's 1MB body cap even with several batches in flight
  var BASE_RETRY_MS = 2000;
  var MAX_RETRY_MS = 60000;
  var MAX_PROPERTY_STRING_LENGTH = 500;
  var MAX_PROPERTY_DEPTH = 3;
  var LEGACY_QUEUE_KEY = "__lp_retry_queue_v2"; // old shared key, adopted once then deleted
  var Q_PREFIX = "__lp_q_"; // per-tab queue: __lp_q_<sessionId>
  var HB_PREFIX = "__lp_hb_"; // heartbeat for the owning tab
  var ORPHAN_AFTER_MS = 60000;
  var MAX_EVENTS_PER_SESSION = 3000;
  var BUCKET_MAX = 60;
  var BUCKET_REFILL_PER_SEC = 5;
  var ERROR_DEDUPE_MS = 10000;
  var MIN_URGENT_FLUSH_MS = 2000;
  var STORAGE_SESSION_KEY = "__lp_sid";
  var PII_KEY_PATTERN = /(email|passw|ssn|social.?security|credit.?card|card.?number|cvv|phone|address|token|secret|auth|api.?key)/i;
  var EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

  var _apiKey = null;
  var _apiOrigin = null;
  var _endpoint = null;
  var _sessionId = null;
  var _userId = "anonymous";
  var _pageStartTime = Date.now();
  var _inflightQueue = [];
  var _bucket = BUCKET_MAX;
  var _bucketTs = Date.now();
  var _sessionCount = 0;
  var _recentErrors = {};
  var _recentErrorCount = 0;
  var _lastUrgentFlush = 0;
  var _sending = {}; // eventId -> true while in flight
  var _timeReported = false;
  var _flushTimer = null;
  var _retryTimer = null;
  var _retryDelay = BASE_RETRY_MS;
  var _online = typeof navigator === "undefined" || navigator.onLine !== false;

  var _consentRequired = false;
  var _consentState = "granted"; // "pending" | "granted" | "denied" -- default ungated (V1 compatible) unless config says otherwise
  var _trackingStarted = false;
  var _propertyAllowlist = null;
  var _redactSelectors = [];

  var _chatEnabled = false;
  var _chatSocketStarted = false;
  var _socket = null;
  var _chatOpen = false;

  /* ---------------------------------------------------------------- *
   * ids / storage helpers
   * ---------------------------------------------------------------- */

  function generateId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    try {
      var sid = sessionStorage.getItem(STORAGE_SESSION_KEY);
      if (!sid) {
        sid = generateId();
        sessionStorage.setItem(STORAGE_SESSION_KEY, sid);
      }
      return sid;
    } catch (e) {
      return generateId();
    }
  }

  function isDoNotTrack() {
    var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    return dnt === "1" || dnt === "yes";
  }

  function touchHeartbeat() {
    try {
      localStorage.setItem(HB_PREFIX + _sessionId, String(Date.now()));
    } catch (e) {}
  }

  function loadPersistedQueue() {
    try {
      var raw = localStorage.getItem(Q_PREFIX + _sessionId);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function savePersistedQueue(queue) {
    try {
      if (!queue.length) {
        localStorage.removeItem(Q_PREFIX + _sessionId);
        localStorage.removeItem(HB_PREFIX + _sessionId);
        return;
      }
      var bounded = queue.length > MAX_PERSISTED_QUEUE ? queue.slice(queue.length - MAX_PERSISTED_QUEUE) : queue;
      localStorage.setItem(Q_PREFIX + _sessionId, JSON.stringify(bounded));
      touchHeartbeat();
    } catch (e) {}
  }

  function adoptOrphanedQueues() {
    try {
      var now = Date.now();
      var mine = Q_PREFIX + _sessionId;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      var adopted = [];
      keys.forEach(function (k) {
        if (!k) return;
        var legacy = k === LEGACY_QUEUE_KEY;
        if (!legacy && (k.indexOf(Q_PREFIX) !== 0 || k === mine)) return;
        var sid = legacy ? "" : k.slice(Q_PREFIX.length);
        if (!legacy && now - (Number(localStorage.getItem(HB_PREFIX + sid)) || 0) < ORPHAN_AFTER_MS) return;
        try { adopted = adopted.concat(JSON.parse(localStorage.getItem(k) || "[]")); } catch (e) {}
        localStorage.removeItem(k);
        if (!legacy) localStorage.removeItem(HB_PREFIX + sid);
      });
      if (adopted.length) savePersistedQueue(loadPersistedQueue().concat(adopted));
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- *
   * sanitization (mirrors the server's redaction, defense in depth --
   * also just keeps payloads smaller before they ever leave the browser)
   * ---------------------------------------------------------------- */

  function sanitizeScalar(value) {
    if (typeof value === "string") return value.replace(EMAIL_RE, "[email]").slice(0, MAX_PROPERTY_STRING_LENGTH);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeScalar);
    return String(value).slice(0, MAX_PROPERTY_STRING_LENGTH);
  }

  function sanitizeProperties(input, depth) {
    depth = depth || 0;
    if (input === null || typeof input !== "object" || Array.isArray(input)) return sanitizeScalar(input);
    if (depth >= MAX_PROPERTY_DEPTH) return "[max depth exceeded]";

    var out = {};
    var count = 0;
    for (var key in input) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      if (count >= 40) break;
      if (_propertyAllowlist && _propertyAllowlist.indexOf(key) === -1) continue;
      if (PII_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
        count++;
        continue;
      }
      var value = input[key];
      out[key] = value && typeof value === "object" && !Array.isArray(value) ? sanitizeProperties(value, depth + 1) : sanitizeScalar(value);
      count++;
    }
    return out;
  }

  function sanitizeElement(el) {
    if (!el) return null;
    if (isRedactedElement(el)) return "[redacted element]";
    var tag = el.tagName ? el.tagName.toLowerCase() : "unknown";
    var id = el.id ? "#" + el.id : "";
    var cls = "";
    if (el.className && typeof el.className === "string") {
      var classes = el.className.trim().split(/\s+/).slice(0, 2).join(".");
      cls = classes ? "." + classes : "";
    }
    var text = el.innerText ? el.innerText.trim().replace(EMAIL_RE, "[email]").slice(0, 40) : "";
    return text ? tag + id + cls + ' "' + text + '"' : tag + id + cls;
  }

  // Customer-configured selectors (config.redactSelectors, e.g.
  // ['[data-lp-redact]', '.no-track']) -- an element matching any of them,
  // or a descendant of one, never has its text/attributes captured.
  function isRedactedElement(el) {
    if (!_redactSelectors.length || !el || !el.closest) return false;
    for (var i = 0; i < _redactSelectors.length; i++) {
      try {
        if (el.closest(_redactSelectors[i])) return true;
      } catch (e) {
        /* invalid selector from config -- ignore rather than throw */
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------- *
   * event construction / queueing -- the single choke point consent
   * gating goes through. If consent is required and not granted, events
   * are never built, never queued, never sent -- not "queued but held".
   * ---------------------------------------------------------------- */

  function consentAllows() {
    return !_consentRequired || _consentState === "granted";
  }

  function buildEvent(eventType, options) {
    var extra = options || {};
    return {
      eventId: generateId(),
      sessionId: _sessionId,
      userId: _userId,
      eventType: eventType,
      url: window.location.href,
      element: extra.element || null,
      occurredAt: new Date().toISOString(),
      consent: _consentRequired ? "granted" : "n/a",
      properties: sanitizeProperties(extra.properties || {}),
      clientContext: {
        referrer: document.referrer || null,
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    };
  }

  function allowEvent(eventType, options) {
    if (_sessionCount >= MAX_EVENTS_PER_SESSION) return false;
    var now = Date.now();
    _bucket = Math.min(BUCKET_MAX, _bucket + ((now - _bucketTs) / 1000) * BUCKET_REFILL_PER_SEC);
    _bucketTs = now;
    if (eventType === "error") {
      var p = (options && options.properties) || {};
      var key = p.message + "|" + p.source + "|" + p.line + "|" + p.col;
      var last = _recentErrors[key];
      if (last && now - last < ERROR_DEDUPE_MS) return false;
      if (_recentErrorCount > 50) { _recentErrors = {}; _recentErrorCount = 0; }
      _recentErrors[key] = now;
      _recentErrorCount++;
    }
    if (_bucket < 1) return false;
    _bucket -= 1;
    _sessionCount++;
    return true;
  }

  function enqueue(eventType, options) {
    if (!_apiKey || !consentAllows() || !allowEvent(eventType, options)) return;
    _inflightQueue.push(buildEvent(eventType, options));
    if (_inflightQueue.length >= MAX_INFLIGHT_QUEUE) flush();
  }

  function urgentFlush() {
    var now = Date.now();
    if (now - _lastUrgentFlush < MIN_URGENT_FLUSH_MS) return;
    _lastUrgentFlush = now;
    flush();
  }

  /* ---------------------------------------------------------------- *
   * transport: versioned batch envelope, size-bounded chunks, bounded
   * local retry with exponential backoff + jitter
   * ---------------------------------------------------------------- */

  function drainInflightIntoPersisted() {
    if (!_inflightQueue.length) return;
    var persisted = loadPersistedQueue().concat(_inflightQueue);
    _inflightQueue = [];
    savePersistedQueue(persisted);
  }

  function chunkBySize(events) {
    var chunks = [];
    var current = [];
    var currentSize = 2; // "[]"
    for (var i = 0; i < events.length; i++) {
      var size = JSON.stringify(events[i]).length + 1;
      if (current.length && currentSize + size > MAX_BATCH_BYTES) {
        chunks.push(current);
        current = [];
        currentSize = 2;
      }
      current.push(events[i]);
      currentSize += size;
    }
    if (current.length) chunks.push(current);
    return chunks;
  }

  function flush() {
    drainInflightIntoPersisted();
    var persisted = loadPersistedQueue();
    if (!persisted.length) return;
    touchHeartbeat();
    var queue = persisted.filter(function (e) { return !_sending[e.eventId]; });
    if (!queue.length) return;
    chunkBySize(queue).forEach(function (chunk) { sendBatch(chunk); });
  }

  function unmark(events) { events.forEach(function (e) { delete _sending[e.eventId]; }); }

  function sendBatch(events) {
    events.forEach(function (e) { _sending[e.eventId] = true; });
    var body = JSON.stringify({ schemaVersion: SCHEMA_VERSION, sentAt: new Date().toISOString(), events: events });
    fetch(_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": _apiKey },
      body: body,
      keepalive: true,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("collector responded " + res.status);
        removeFromPersistedQueue(events);
        unmark(events);
        _retryDelay = BASE_RETRY_MS;
      })
      .catch(function () {
        unmark(events);
        scheduleRetry();
      });
  }

  function removeFromPersistedQueue(sentEvents) {
    var sentIds = {};
    sentEvents.forEach(function (e) {
      sentIds[e.eventId] = true;
    });
    var remaining = loadPersistedQueue().filter(function (e) {
      return !sentIds[e.eventId];
    });
    savePersistedQueue(remaining);
  }

  function scheduleRetry() {
    if (_retryTimer || !_online) return; // don't stack timers; offline handler resumes on 'online'
    var jitter = 1 + (Math.random() * 0.6 - 0.3); // +/-30%
    var delay = Math.min(_retryDelay, MAX_RETRY_MS) * jitter;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      _retryDelay = Math.min(_retryDelay * 2, MAX_RETRY_MS);
      flush();
    }, delay);
  }

  function setupNetworkRecovery() {
    window.addEventListener("online", function () {
      _online = true;
      _retryDelay = BASE_RETRY_MS;
      flush();
    });
    window.addEventListener("offline", function () {
      _online = false;
      if (_retryTimer) {
        clearTimeout(_retryTimer);
        _retryTimer = null;
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * auto-tracking
   * ---------------------------------------------------------------- */

  function trackPageView() {
    _pageStartTime = Date.now();
    _timeReported = false;
    enqueue("page_view", { properties: { title: document.title } });
  }

  function trackTimeOnPage() {
    if (_timeReported) return;
    var seconds = Math.max(1, Math.round((Date.now() - _pageStartTime) / 1000));
    enqueue("time_on_page", { properties: { seconds: seconds, title: document.title } });
    _timeReported = true;
  }

  function trackClicks() {
    document.addEventListener(
      "click",
      function (e) {
        if (isInsideChatWidget(e.target)) return;
        enqueue("click", { element: sanitizeElement(e.target), properties: { x: e.clientX, y: e.clientY } });
      },
      { passive: true },
    );
  }

  function trackErrors() {
    window.addEventListener("error", function (e) {
      enqueue("error", { properties: { message: e.message, source: e.filename, line: e.lineno, col: e.colno } });
      urgentFlush();
    });
    window.addEventListener("unhandledrejection", function (e) {
      enqueue("error", {
        properties: { message: e.reason ? String(e.reason) : "Unhandled Promise rejection", type: "promise" },
      });
      urgentFlush();
    });
  }

  function trackRageClicks() {
    var clickLog = [];
    var RAGE_THRESHOLD = 3;
    var RAGE_WINDOW_MS = 500;
    var RAGE_RADIUS_PX = 30;

    document.addEventListener(
      "click",
      function (e) {
        if (isInsideChatWidget(e.target)) return;
        var now = Date.now();
        clickLog.push({ x: e.clientX, y: e.clientY, t: now });
        clickLog = clickLog.filter(function (c) {
          return now - c.t <= RAGE_WINDOW_MS;
        });
        if (clickLog.length >= RAGE_THRESHOLD) {
          var first = clickLog[0];
          var last = clickLog[clickLog.length - 1];
          var dist = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
          if (dist <= RAGE_RADIUS_PX) {
            enqueue("rage_click", { element: sanitizeElement(e.target), properties: { x: e.clientX, y: e.clientY, clickCount: clickLog.length } });
            urgentFlush();
            clickLog = [];
          }
        }
      },
      { passive: true },
    );
  }

  function trackScrollDepth() {
    var reported = {};
    window.addEventListener(
      "scroll",
      function () {
        var total = Math.max(document.documentElement.scrollHeight, 1);
        var scrolled = window.scrollY + window.innerHeight;
        var depth = Math.round((scrolled / total) * 100);
        [25, 50, 75, 100].forEach(function (m) {
          if (depth >= m && !reported[m]) {
            reported[m] = true;
            enqueue("scroll_depth", { properties: { depth: m, title: document.title } });
          }
        });
      },
      { passive: true },
    );
  }

  function trackPageVisibility() {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        trackTimeOnPage();
        flush();
      } else if (document.visibilityState === "visible") {
        _pageStartTime = Date.now();
        _timeReported = false;
      }
    });
  }

  function trackSPA() {
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      trackPageView();
    };
    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      trackPageView();
    };
    window.addEventListener("popstate", trackPageView);
  }

  var _trackConfig = null;

  function startTracking() {
    if (_trackingStarted) return;
    _trackingStarted = true;
    adoptOrphanedQueues();

    var track = _trackConfig || {};
    var all = track.all !== false;
    if (all || track.pageViews !== false) trackPageView();
    if (all || track.clicks !== false) trackClicks();
    if (all || track.errors !== false) trackErrors();
    if (all || track.rageClicks !== false) trackRageClicks();
    if (all || track.scrollDepth !== false) trackScrollDepth();
    if (all || track.visibility !== false) trackPageVisibility();
    if (all || track.spa !== false) trackSPA();

    _flushTimer = setInterval(function () {
      flush();
    }, FLUSH_INTERVAL_MS);
    window.addEventListener("beforeunload", function () {
      trackTimeOnPage();
      flush();
    });
    window.addEventListener("pagehide", function () {
      flush();
    });
  }

  /* ---------------------------------------------------------------- *
   * consent banner (only shown when consent is required and still
   * pending -- and never shown at all if Do Not Track already answered
   * the question for the visitor)
   * ---------------------------------------------------------------- */

  var BANNER_ID = "lp-consent-banner";

  function showConsentBanner() {
    if (document.getElementById(BANNER_ID)) return;
    var style = document.createElement("style");
    style.textContent =
      "#" + BANNER_ID + "{position:fixed;left:16px;right:16px;bottom:16px;max-width:520px;" +
      "background:#111;color:#fff;padding:14px 16px;border-radius:10px;font:13px/1.5 -apple-system,sans-serif;" +
      "box-shadow:0 8px 30px rgba(0,0,0,.3);z-index:2147483000;display:flex;gap:12px;align-items:center;flex-wrap:wrap;}" +
      "#" + BANNER_ID + " p{margin:0;flex:1;min-width:200px;}" +
      "#" + BANNER_ID + " button{border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;}" +
      "#" + BANNER_ID + " .lp-accept{background:#fff;color:#111;}" +
      "#" + BANNER_ID + " .lp-decline{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);}";
    document.head.appendChild(style);

    var el = document.createElement("div");
    el.id = BANNER_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Analytics consent");
    el.innerHTML =
      '<p>This site uses LivePulse to see how visitors use it. No cookies, nothing sold.</p>' +
      '<button type="button" class="lp-decline">Decline</button>' +
      '<button type="button" class="lp-accept">Accept</button>';
    document.body.appendChild(el);

    el.querySelector(".lp-accept").addEventListener("click", function () {
      LivePulse.consent("granted");
      el.remove();
    });
    el.querySelector(".lp-decline").addEventListener("click", function () {
      LivePulse.consent("denied");
      el.remove();
    });
  }

  function hideConsentBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  /* ---------------------------------------------------------------- *
   * visitor chat widget -- opt-in is independent of analytics consent.
   * The socket only ever connects once the visitor actually opens the
   * panel (that action *is* the opt-in), never on page load.
   * ---------------------------------------------------------------- */

  var WIDGET_ROOT_ID = "lp-chat-widget";

  function isInsideChatWidget(el) {
    var root = document.getElementById(WIDGET_ROOT_ID);
    return !!(root && el && root.contains(el));
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.io) return resolve();
      var existing = document.querySelector("script[data-lp-socketio]");
      if (existing) {
        existing.addEventListener("load", resolve);
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.setAttribute("data-lp-socketio", "1");
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function injectChatStyles() {
    if (document.getElementById("lp-chat-styles")) return;
    var style = document.createElement("style");
    style.id = "lp-chat-styles";
    style.textContent =
      "#" + WIDGET_ROOT_ID + "{position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      ".lp-launch{width:52px;height:52px;border-radius:50%;background:#111;color:#fff;border:none;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;font-size:22px;}" +
      ".lp-launch:focus-visible{outline:2px solid #ff3b3b;outline-offset:2px;}" +
      ".lp-panel{position:absolute;bottom:64px;right:0;width:300px;max-height:420px;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,.08);}" +
      ".lp-panel[hidden]{display:none;}" +
      ".lp-head{padding:12px 14px;border-bottom:1px solid rgba(0,0,0,.08);}" +
      ".lp-head b{display:block;font-size:13px;}" +
      ".lp-head span{font-size:11px;color:#666;}" +
      ".lp-msgs{flex:1;overflow-y:auto;padding:10px 12px;min-height:120px;max-height:260px;}" +
      ".lp-msg{margin-bottom:8px;max-width:85%;padding:8px 10px;border-radius:10px;font-size:13px;line-height:1.4;word-wrap:break-word;}" +
      ".lp-msg.founder{background:#f1f1f1;color:#111;}" +
      ".lp-msg.user{background:#111;color:#fff;margin-left:auto;}" +
      ".lp-empty{font-size:12px;color:#888;padding:8px 2px;}" +
      ".lp-row{display:flex;border-top:1px solid rgba(0,0,0,.08);}" +
      ".lp-row input{flex:1;border:none;padding:10px 12px;font-size:13px;outline:none;}" +
      ".lp-row button{border:none;background:#111;color:#fff;padding:0 14px;font-size:13px;cursor:pointer;}" +
      ".lp-row button:disabled{opacity:.4;cursor:default;}";
    document.head.appendChild(style);
  }

  function appendChatMessage(sender, text) {
    var list = document.getElementById("lp-chat-msgs");
    if (!list) return;
    var empty = list.querySelector(".lp-empty");
    if (empty) empty.remove();
    var el = document.createElement("div");
    el.className = "lp-msg " + (sender === "user" ? "user" : "founder");
    el.textContent = text;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
  }

  function connectChatSocket() {
    if (_chatSocketStarted) return;
    _chatSocketStarted = true;
    loadScript(_apiOrigin + "/socket.io/socket.io.js")
      .then(function () {
        if (!window.io) return;
        _socket = window.io(_apiOrigin, {
          auth: { apiKey: _apiKey, sessionId: _sessionId },
          transports: ["websocket", "polling"],
        });
        _socket.on("founder_message", function (payload) {
          appendChatMessage("founder", payload && payload.message ? payload.message : "");
        });
      })
      .catch(function () {
        /* chat is a progressive enhancement -- tracking still works without it */
      });
  }

  function sendReply(text, id, attempt) {
    _socket.timeout(5000).emit("user_reply", { message: text, clientMsgId: id }, function (err, res) {
      if (err && attempt < 1) return sendReply(text, id, attempt + 1); // same id => server de-dupes
      if (err || !res || !res.ok) appendChatMessage("founder", "Message failed to send -- try again.");
    });
  }

  function buildChatDom() {
    injectChatStyles();
    var root = document.createElement("div");
    root.id = WIDGET_ROOT_ID;
    root.innerHTML =
      '<button type="button" class="lp-launch" aria-haspopup="dialog" aria-expanded="false" aria-controls="lp-chat-panel" aria-label="Open chat with the site team">\uD83D\uDCAC</button>' +
      '<div class="lp-panel" id="lp-chat-panel" role="dialog" aria-modal="false" aria-label="Private chat with the site team" hidden>' +
      '  <div class="lp-head"><b>Chat with the team</b><span>Private -- only visible to you and the site team.</span></div>' +
      '  <div class="lp-msgs" id="lp-chat-msgs" aria-live="polite"><p class="lp-empty">Say hello -- a real person on the team will see this.</p></div>' +
      '  <form class="lp-row" id="lp-chat-form">' +
      '    <input id="lp-chat-input" type="text" maxlength="500" placeholder="Type a message\u2026" aria-label="Message to the site team" autocomplete="off" />' +
      '    <button type="submit" id="lp-chat-send" disabled>Send</button>' +
      "  </form>" +
      "</div>";
    document.body.appendChild(root);

    var launch = root.querySelector(".lp-launch");
    var panel = root.querySelector("#lp-chat-panel");
    var input = root.querySelector("#lp-chat-input");
    var send = root.querySelector("#lp-chat-send");
    var form = root.querySelector("#lp-chat-form");

    function setOpen(open) {
      _chatOpen = open;
      panel.hidden = !open;
      launch.setAttribute("aria-expanded", String(open));
      if (open) {
        connectChatSocket(); // the opt-in moment -- independent of analytics consent
        input.focus();
      }
    }

    launch.addEventListener("click", function () {
      setOpen(!_chatOpen);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && _chatOpen) {
        setOpen(false);
        launch.focus();
      }
    });
    input.addEventListener("input", function () {
      send.disabled = !input.value.trim();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || !_socket) return;
      appendChatMessage("user", text);
      sendReply(text, generateId(), 0);
      input.value = "";
      send.disabled = true;
    });
  }

  function initChatWidget() {
    buildChatDom();
    // Socket connects lazily on first open (see setOpen above) -- not here.
  }

  /* ---------------------------------------------------------------- *
   * public API
   * ---------------------------------------------------------------- */

  var LivePulse = {
    init: function (config) {
      if (!config || !config.apiKey) {
        console.warn("[LivePulse] apiKey is required.");
        return;
      }

      _apiKey = config.apiKey;
      _apiOrigin = (config.endpoint ? String(config.endpoint) : "http://localhost:5000").replace(/\/$/, "");
      _endpoint = _apiOrigin + "/api/v2/collect";
      _userId = config.userId || "anonymous";
      _sessionId = getSessionId();
      _chatEnabled = !!config.chat;
      _propertyAllowlist = Array.isArray(config.propertyAllowlist) ? config.propertyAllowlist : null;
      _redactSelectors = Array.isArray(config.redactSelectors) ? config.redactSelectors : [];
      _trackConfig = config.track || {};

      // "consent" key not passed at all -> V1-compatible, ungated behavior.
      // Passed (any value, including "pending") -> the V2 consent gate applies.
      _consentRequired = Object.prototype.hasOwnProperty.call(config, "consent");
      _consentState = _consentRequired ? "pending" : "granted";

      setupNetworkRecovery();

      if (isDoNotTrack()) {
        // The browser already answered the question -- respect it silently,
        // don't additionally nag with a banner asking the same thing again.
        _consentRequired = true;
        _consentState = "denied";
      } else if (_consentRequired && config.consent === "granted") {
        _consentState = "granted";
      }

      if (consentAllows()) {
        startTracking();
      } else if (_consentRequired && _consentState === "pending") {
        showConsentBanner();
      }

      if (_chatEnabled) initChatWidget();

      console.log("[LivePulse] initialized" + (_consentRequired ? " (consent: " + _consentState + ")" : "") + (_chatEnabled ? " (chat available)" : ""));
    },

    /** LivePulse.consent("granted" | "denied") */
    consent: function (state) {
      if (state !== "granted" && state !== "denied") {
        console.warn('[LivePulse] consent() expects "granted" or "denied"');
        return;
      }
      _consentState = state;
      hideConsentBanner();
      if (state === "granted") {
        startTracking();
      } else {
        // Denied: nothing queued should linger. Cancel any pending retry
        // and drop whatever's persisted -- consent withdrawal means don't
        // hold or eventually send anything already sitting in the queue.
        if (_retryTimer) {
          clearTimeout(_retryTimer);
          _retryTimer = null;
        }
        _inflightQueue = [];
        savePersistedQueue([]);
      }
    },

    /** Forgets this visitor: fresh session, cleared queue, chat disconnected. Re-shows the consent banner if consent was required. */
    reset: function () {
      try {
        sessionStorage.removeItem(STORAGE_SESSION_KEY);
      } catch (e) {}
      savePersistedQueue([]);
      _inflightQueue = [];
      _sending = {}; _bucket = BUCKET_MAX; _bucketTs = Date.now(); _sessionCount = 0; _recentErrors = {}; _recentErrorCount = 0; _timeReported = false;
      _sessionId = getSessionId();
      if (_socket) {
        _socket.disconnect();
        _socket = null;
        _chatSocketStarted = false;
      }
      if (_consentRequired) {
        _consentState = "pending";
        _trackingStarted = false;
        if (_flushTimer) {
          clearInterval(_flushTimer);
          _flushTimer = null;
        }
        showConsentBanner();
      }
    },

    track: function (eventType, properties) {
      enqueue(eventType || "custom", { properties: properties || {} });
    },

    flush: function () {
      flush();
    },

    getSessionId: function () {
      return _sessionId;
    },

    getConsentState: function () {
      return _consentRequired ? _consentState : "n/a";
    },
  };

  window.LivePulse = LivePulse;

  /* ---------------------------------------------------------------- *
   * one-tag auto-init
   *
   * <script src="https://api.livepulse.app/sdk/livepulse.js"
   *         data-key="lp_xxx"
   *         data-api="https://api.livepulse.app"
   *         data-chat="true"
   *         data-consent="required"
   *         defer></script>
   *
   * data-consent="required" is the default production contract for the
   * one-tag path -- omit the attribute entirely (or set any other value)
   * to fall back to ungated V1-compatible behavior.
   * ---------------------------------------------------------------- */
  var currentScript = document.currentScript;
  if (currentScript && currentScript.dataset && currentScript.dataset.key) {
    var ds = currentScript.dataset;
    var apiOrigin = ds.api;
    if (!apiOrigin) {
      try {
        apiOrigin = new URL(currentScript.src).origin;
      } catch (e) {
        apiOrigin = "http://localhost:5000";
      }
    }
    var initConfig = {
      apiKey: ds.key,
      endpoint: apiOrigin,
      userId: ds.userId || "anonymous",
      chat: ds.chat === "true",
    };
    if (ds.consent === "required") initConfig.consent = "pending";
    LivePulse.init(initConfig);
  }
})(window, document);
