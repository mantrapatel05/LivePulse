(function (window, document) {
  'use strict';

  var DEFAULT_ENDPOINT = 'http://localhost:5000/api/events/ingest';
  var FLUSH_INTERVAL_MS = 5000;
  var MAX_QUEUE_SIZE = 20;

  var _apiKey = null;
  var _projectId = null;
  var _endpoint = DEFAULT_ENDPOINT;
  var _sessionId = null;
  var _userId = 'anonymous';
  var _queue = [];
  var _flushTimer = null;
  var _pageStartTime = Date.now();

  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    try {
      var sid = sessionStorage.getItem('__lp_sid');
      if (!sid) {
        sid = generateId();
        sessionStorage.setItem('__lp_sid', sid);
      }
      return sid;
    } catch (e) {
      return generateId();
    }
  }

  function sanitizeElement(el) {
    if (!el) return null;
    var tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    var id = el.id ? '#' + el.id : '';
    var cls = '';
    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      cls = classes ? '.' + classes : '';
    }
    var text = el.innerText ? el.innerText.trim().slice(0, 40) : '';
    return text ? tag + id + cls + ' "' + text + '"' : tag + id + cls;
  }

  function enqueue(event) {
    _queue.push(event);
    if (_queue.length >= MAX_QUEUE_SIZE) {
      flush();
    }
  }

  function flush() {
    if (_queue.length === 0) return;
    var batch = _queue.splice(0, _queue.length);
    for (var i = 0; i < batch.length; i++) {
      send(batch[i]);
    }
  }

  function send(event) {
    if (!_apiKey) return;

    fetch(_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': _apiKey
      },
      body: JSON.stringify(event),
      keepalive: true
    }).catch(function () {
    });
  }

  function buildEvent(eventType, options) {
    var extra = options || {};
    return {
      project_id: _projectId,
      session_id: _sessionId,
      user_id: _userId,
      event_type: eventType,
      url: window.location.href,
      element: extra.element || null,
      timestamp: new Date().toISOString(),
      metadata: {
        referrer: document.referrer || null,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        data: extra.metadata || {}
      }
    };
  }

  function trackPageView() {
    _pageStartTime = Date.now();
    enqueue(buildEvent('page_view', {
      metadata: {
        title: document.title
      }
    }));
  }

  function trackTimeOnPage() {
    var seconds = Math.max(1, Math.round((Date.now() - _pageStartTime) / 1000));
    enqueue(buildEvent('time_on_page', {
      metadata: {
        seconds: seconds,
        title: document.title
      }
    }));
  }

  function trackClicks() {
    document.addEventListener('click', function (e) {
      enqueue(buildEvent('click', {
        element: sanitizeElement(e.target),
        metadata: {
          x: e.clientX,
          y: e.clientY
        }
      }));
    }, { passive: true });
  }

  function trackErrors() {
    window.addEventListener('error', function (e) {
      enqueue(buildEvent('error', {
        metadata: {
          message: e.message,
          source: e.filename,
          line: e.lineno,
          col: e.colno
        }
      }));
      flush();
    });

    window.addEventListener('unhandledrejection', function (e) {
      enqueue(buildEvent('error', {
        metadata: {
          message: e.reason ? String(e.reason) : 'Unhandled Promise rejection',
          type: 'promise'
        }
      }));
      flush();
    });
  }

  function trackRageClicks() {
    var clickLog = [];
    var RAGE_THRESHOLD = 3;
    var RAGE_WINDOW_MS = 500;
    var RAGE_RADIUS_PX = 30;

    document.addEventListener('click', function (e) {
      var now = Date.now();
      clickLog.push({ x: e.clientX, y: e.clientY, t: now });
      clickLog = clickLog.filter(function (c) { return now - c.t <= RAGE_WINDOW_MS; });

      if (clickLog.length >= RAGE_THRESHOLD) {
        var first = clickLog[0];
        var last = clickLog[clickLog.length - 1];
        var dist = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));

        if (dist <= RAGE_RADIUS_PX) {
          enqueue(buildEvent('rage_click', {
            element: sanitizeElement(e.target),
            metadata: {
              x: e.clientX,
              y: e.clientY,
              clickCount: clickLog.length
            }
          }));
          flush();
          clickLog = [];
        }
      }
    }, { passive: true });
  }

  function trackScrollDepth() {
    var reported = {};
    window.addEventListener('scroll', function () {
      var total = Math.max(document.documentElement.scrollHeight, 1);
      var scrolled = window.scrollY + window.innerHeight;
      var depth = Math.round((scrolled / total) * 100);
      var marks = [25, 50, 75, 100];

      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        if (depth >= m && !reported[m]) {
          reported[m] = true;
          enqueue(buildEvent('scroll_depth', {
            metadata: { depth: m, title: document.title }
          }));
        }
      }
    }, { passive: true });
  }

  function trackPageVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        trackTimeOnPage();
        flush();
      } else if (document.visibilityState === 'visible') {
        _pageStartTime = Date.now();
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

    window.addEventListener('popstate', function () {
      trackPageView();
    });
  }

  var LivePulse = {
    init: function (config) {
      if (!config || !config.apiKey) {
        console.warn('[LivePulse] apiKey is required.');
        return;
      }

      _apiKey = config.apiKey;
      _projectId = config.projectId || null;
      _endpoint = config.endpoint || DEFAULT_ENDPOINT;
      _userId = config.userId || 'anonymous';
      _sessionId = getSessionId();

      var track = config.track || {};
      var all = track.all !== false;

      if (all || track.pageViews !== false) trackPageView();
      if (all || track.clicks !== false) trackClicks();
      if (all || track.errors !== false) trackErrors();
      if (all || track.rageClicks !== false) trackRageClicks();
      if (all || track.scrollDepth !== false) trackScrollDepth();
      if (all || track.visibility !== false) trackPageVisibility();
      if (all || track.spa !== false) trackSPA();

      _flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

      window.addEventListener('beforeunload', function () {
        trackTimeOnPage();
        flush();
      });
    },

    track: function (eventType, metadata) {
      if (!_apiKey) return;
      enqueue(buildEvent(eventType || 'custom', { metadata: metadata || {} }));
    },

    flush: flush,

    getSessionId: function () {
      return _sessionId;
    }
  };

  window.LivePulse = LivePulse;
})(window, document);
