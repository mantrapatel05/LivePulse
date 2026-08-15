import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "../../lib/auth";
import { API_URL } from "../../lib/config";

/**
 * The hero monitor, world map and chat replay are clearly-labelled preview
 * animations (see aria-hidden + copy below) — not a claim of real traffic.
 * The actual dashboard (behind sign-in) is 100% real data; see
 * ControlRoom.tsx and its "nothing here is simulated" banner.
 */
export function Landing() {
  const { user } = useAuth();
  const primaryTo = user ? "/dashboard" : "/login";
  const primaryLabel = user ? "open dashboard" : "get started";

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const q = <T extends Element = Element>(id: string) => root.querySelector<T>(`#${id}`);
    const pad = (n: number) => String(n).padStart(2, "0");
    const timers: Array<number> = [];
    let rafId: number | null = null;

    /* ---------- ECG line ---------- */
    const ecg = q<SVGPathElement>("ecgPath");
    if (ecg) {
      const W = 800;
      const MID = 130;
      const beat = (x: number) => [
        [x, MID],
        [x + 8, MID],
        [x + 14, MID - 6],
        [x + 20, MID + 8],
        [x + 24, MID - 60],
        [x + 28, MID + 30],
        [x + 34, MID - 4],
        [x + 44, MID],
        [x + 70, MID],
      ];
      let pts: number[][] = [];
      for (let x = -20; x < W + 100; x += 90) pts = pts.concat(beat(x));
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
      ecg.setAttribute("d", d);

      let off = 0;
      const tick = () => {
        off = (off + 1.4) % 90;
        ecg.setAttribute("transform", `translate(${-off} 0)`);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    /* ---------- monitor clock + jittering metrics ---------- */
    const monTime = q("monTime");
    const bpmEl = q("bpm");
    const rxEl = q("rx");
    const dBpm = q("dBpm");
    const dPpm = q("dPpm");
    const dHpm = q("dHpm");
    const navOnline = q("navOnline");
    const footBpm = q("footBpm");

    timers.push(
      window.setInterval(() => {
        const d = new Date();
        if (monTime)
          monTime.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        const bpm = 68 + Math.floor(Math.random() * 14);
        if (bpmEl) bpmEl.textContent = String(bpm);
        if (dBpm) dBpm.textContent = String(bpm);
        if (footBpm) footBpm.textContent = String(bpm);
        if (rxEl) rxEl.textContent = (3 + Math.random() * 9).toFixed(1);
        if (dPpm) dPpm.textContent = String(28 + Math.floor(Math.random() * 20));
        if (dHpm) dHpm.textContent = String(10 + Math.floor(Math.random() * 12));
      }, 900),
    );

    /* ---------- preview visitor list ---------- */
    const visitors = [
      { id: "a91", flag: "🇩🇪", city: "Berlin", page: "/pricing", dwell: "4m 12s" },
      { id: "b04", flag: "🇺🇸", city: "New York", page: "/", dwell: "0m 38s" },
      { id: "c77", flag: "🇯🇵", city: "Tokyo", page: "/docs", dwell: "2m 04s" },
      { id: "d12", flag: "🇮🇳", city: "Bengaluru", page: "/changelog", dwell: "1m 21s" },
      { id: "e55", flag: "🇧🇷", city: "São Paulo", page: "/pricing", dwell: "0m 09s" },
      { id: "f08", flag: "🇫🇷", city: "Paris", page: "/blog/v01", dwell: "3m 47s" },
      { id: "g30", flag: "🇬🇧", city: "London", page: "/", dwell: "0m 51s" },
      { id: "h22", flag: "🇨🇦", city: "Toronto", page: "/docs/sdk", dwell: "5m 33s" },
      { id: "i89", flag: "🇦🇺", city: "Sydney", page: "/pricing", dwell: "1m 04s" },
      { id: "j17", flag: "🇸🇪", city: "Stockholm", page: "/", dwell: "0m 22s" },
      { id: "k63", flag: "🇰🇷", city: "Seoul", page: "/docs", dwell: "2m 58s" },
      { id: "l44", flag: "🇲🇽", city: "CDMX", page: "/blog/v01", dwell: "1m 11s" },
    ];
    const vList = q<HTMLUListElement>("visitorList");
    if (vList) {
      vList.innerHTML = visitors
        .map(
          (v) => `
        <li data-id="${v.id}">
          <b>visitor#${v.id}</b>
          <span class="v-flag">${v.flag}</span>
          <small>${v.page} · ${v.city} · ${v.dwell}</small>
        </li>`,
        )
        .join("");
      const nowCount = q("nowCount");
      if (nowCount) nowCount.textContent = String(visitors.length);
      if (navOnline) navOnline.textContent = String(200 + visitors.length);
    }

    /* ---------- world map dot grid + pings ---------- */
    const grid = q<SVGGElement>("dotGrid");
    if (grid) {
      let s = "";
      for (let y = 0; y < 380; y += 12) {
        for (let x = 0; x < 800; x += 12) {
          const inLand =
            (x > 90 && x < 230 && y > 80 && y < 260) ||
            (x > 360 && x < 470 && y > 80 && y < 280) ||
            (x > 520 && x < 720 && y > 70 && y < 230);
          if (inLand && Math.random() > 0.35) s += `<circle cx="${x}" cy="${y}" r="1.4"/>`;
        }
      }
      grid.innerHTML = s;
    }

    const pings = q<SVGGElement>("pings");
    const cityCoords: Array<[number, number]> = [
      [185, 175],
      [150, 145],
      [200, 260],
      [395, 130],
      [420, 170],
      [450, 220],
      [560, 150],
      [615, 165],
      [680, 200],
      [660, 270],
    ];
    if (pings) {
      pings.innerHTML = cityCoords
        .map(
          ([x, y]) => `
        <g transform="translate(${x} ${y})">
          <circle class="ping" cx="0" cy="0" r="2"/>
          <circle class="ping-core" cx="0" cy="0" r="2.5"/>
        </g>`,
        )
        .join("");
    }

    /* ---------- preview stream feed ---------- */
    const stream = q<HTMLUListElement>("streamList");
    const dErr = q("dErr");
    let errCount = 2;
    const kinds = [
      { k: "VIEW", cls: "k-view", msg: (v: (typeof visitors)[number]) => `${v.id} → ${v.page}` },
      {
        k: "HOVER",
        cls: "k-hover",
        msg: (v: (typeof visitors)[number]) => `${v.id} hover [Buy Pro]`,
      },
      { k: "SCROLL", cls: "k-view", msg: (v: (typeof visitors)[number]) => `${v.id} scrolled 80%` },
      {
        k: "CLICK",
        cls: "k-chat",
        msg: (v: (typeof visitors)[number]) => `${v.id} clicked [Docs]`,
      },
      { k: "ERR", cls: "k-err", msg: (v: (typeof visitors)[number]) => `TypeError @ ${v.page}` },
      {
        k: "CHAT",
        cls: "k-chat",
        msg: (v: (typeof visitors)[number]) => `you → ${v.id}: "hey 👋"`,
      },
    ];
    function pushStream() {
      if (!stream) return;
      const v = visitors[Math.floor(Math.random() * visitors.length)];
      const t = kinds[Math.floor(Math.random() * kinds.length)];
      if (t.k === "ERR") {
        errCount++;
        if (dErr) dErr.textContent = String(errCount);
      }
      const time = new Date();
      const ts = `${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
      const li = document.createElement("li");
      li.innerHTML = `<span class="k ${t.cls}">${t.k}</span><span>${ts} · ${t.msg(v)}</span>`;
      stream.insertBefore(li, stream.firstChild);
      while (stream.childNodes.length > 16) stream.removeChild(stream.lastChild as ChildNode);
    }
    if (stream) {
      for (let i = 0; i < 8; i++) pushStream();
      timers.push(window.setInterval(pushStream, 1400));
    }

    /* ---------- chat replay demo ---------- */
    const log = q<HTMLOListElement>("chatLog");
    const input = q<HTMLInputElement>("chatInput");
    const replay = q<HTMLButtonElement>("chatPing");

    const script = [
      { who: "me", t: "hey 👋 saw you bouncing between Pro and Team — anything I can clarify?" },
      { who: "them", t: "oh hi! yeah — does Team include the SDK on unlimited domains?" },
      { who: "me", t: "yep, unlimited. + 90-day retention vs 30 on Pro." },
      { who: "them", t: "sold. taking it." },
      { who: "me", t: "love you. 🩷" },
    ];

    function play() {
      if (!log) return;
      log.innerHTML = "";
      script.forEach((m, i) => {
        timers.push(
          window.setTimeout(() => {
            const li = document.createElement("li");
            li.className = m.who;
            li.innerHTML = `${m.t}<small>${m.who === "me" ? "you" : "visitor#a91"} · just now</small>`;
            log.appendChild(li);
            log.scrollTop = log.scrollHeight;
          }, i * 1100),
        );
      });
    }
    play();
    replay?.addEventListener("click", play);

    function onInputKeydown(e: KeyboardEvent) {
      if (!input || !log) return;
      if (e.key !== "Enter" || !input.value.trim()) return;
      const li = document.createElement("li");
      li.className = "me";
      li.innerHTML = `${input.value}<small>you · just now</small>`;
      log.appendChild(li);
      input.value = "";
      log.scrollTop = log.scrollHeight;
      timers.push(
        window.setTimeout(() => {
          const r = document.createElement("li");
          r.className = "them";
          r.innerHTML = `noted — thanks!<small>visitor#a91 · just now</small>`;
          log.appendChild(r);
          log.scrollTop = log.scrollHeight;
        }, 900),
      );
    }
    input?.addEventListener("keydown", onInputKeydown);

    function onVisitorClick(e: Event) {
      const target = e.target as HTMLElement;
      const li = target.closest("li");
      if (!li) return;
      q("chat")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    vList?.addEventListener("click", onVisitorClick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      timers.forEach((t) => {
        window.clearInterval(t);
        window.clearTimeout(t);
      });
      replay?.removeEventListener("click", play);
      input?.removeEventListener("keydown", onInputKeydown);
      vList?.removeEventListener("click", onVisitorClick);
    };
  }, []);

  return (
    <div ref={rootRef}>
      <div className="grain" />

      <header className="nav">
        <a className="brand" href="#top">
          <span className="brand-mark">
            <svg viewBox="0 0 60 24" width="48" height="20" aria-hidden="true">
              <polyline
                className="ecg-mini"
                points="0,12 12,12 16,4 22,20 28,8 32,12 60,12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
            </svg>
          </span>
          <span className="brand-name">LivePulse</span>
          <span className="brand-status">
            <i className="dot" /> online · <span id="navOnline">217</span>
          </span>
        </a>
        <nav className="nav-links">
          <a href="#what">what</a>
          <a href="#how">how</a>
          <a href="#dash">dashboard</a>
          <a href="#chat">chat</a>
          <a href="#install">install</a>
        </nav>
        <Link to={primaryTo} className="cta-mini">
          {primaryLabel} →
        </Link>
      </header>

      {/* ─────────────────────── HERO ─────────────────────── */}
      <section id="top" className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="kicker">
              v0.1 · public beta · built by <span className="under">@mantrapatel05</span>
            </p>
            <h1 className="display">
              Your product,
              <br />
              with a <em>heartbeat</em>.
            </h1>
            <p className="lede">
              LivePulse is a small embeddable script that turns any website into a living organism.
              See who's reading your pricing page right now, which button they're hovering, the JS
              error that just crashed their checkout — and{" "}
              <u>chat with them in that exact moment</u>.
            </p>
            <div className="hero-cta">
              <Link to={primaryTo} className="btn-primary">
                <span>{primaryLabel}</span>
                <span className="btn-arrow">⇲</span>
              </Link>
              <a href="#dash" className="btn-ghost">
                see a live preview ↘
              </a>
            </div>
            <ul className="stats">
              <li>
                <b>~8KB</b>
                <span>minified SDK</span>
              </li>
              <li>
                <b>&lt;100ms</b>
                <span>event to dashboard</span>
              </li>
              <li>
                <b>0</b>
                <span>cookies, ever</span>
              </li>
            </ul>
          </div>

          <div className="hero-monitor" aria-hidden="true">
            <div className="monitor-bezel">
              <div className="monitor-topbar">
                <span className="led led-red" />
                <span className="led led-amber" />
                <span className="led led-green" />
                <span className="monitor-title">livepulse://session/feed (preview)</span>
                <span className="monitor-time" id="monTime">
                  --:--:--
                </span>
              </div>
              <div className="monitor-screen">
                <svg className="ecg" viewBox="0 0 800 240" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="fade" x1="0" x2="1">
                      <stop offset="0" stopColor="#ff3b3b" stopOpacity="0" />
                      <stop offset="0.85" stopColor="#ff3b3b" stopOpacity="1" />
                      <stop offset="1" stopColor="#ffffff" stopOpacity="1" />
                    </linearGradient>
                  </defs>
                  <g className="grid-lines">
                    <line x1="0" y1="40" x2="800" y2="40" />
                    <line x1="0" y1="80" x2="800" y2="80" />
                    <line x1="0" y1="120" x2="800" y2="120" />
                    <line x1="0" y1="160" x2="800" y2="160" />
                    <line x1="0" y1="200" x2="800" y2="200" />
                  </g>
                  <path
                    id="ecgPath"
                    className="ecg-line"
                    fill="none"
                    stroke="url(#fade)"
                    strokeWidth="2.5"
                    strokeLinecap="square"
                  />
                </svg>

                <div className="feed">
                  <div className="feed-row" data-kind="view">
                    <span className="t">19:42:01</span>
                    <span className="k k-view">VIEW</span>
                    <span className="m">
                      <b>visitor#a91</b> opened /pricing · 🇩🇪 Berlin
                    </span>
                  </div>
                  <div className="feed-row" data-kind="hover">
                    <span className="t">19:42:03</span>
                    <span className="k k-hover">HOVER</span>
                    <span className="m">
                      <b>visitor#a91</b> hovering [Buy Pro] for 4.1s
                    </span>
                  </div>
                  <div className="feed-row" data-kind="error">
                    <span className="t">19:42:04</span>
                    <span className="k k-err">ERR</span>
                    <span className="m">
                      <code>TypeError: cart is undefined</code> · 3 users hit this
                    </span>
                  </div>
                  <div className="feed-row" data-kind="chat">
                    <span className="t">19:42:06</span>
                    <span className="k k-chat">CHAT</span>
                    <span className="m">
                      you → <b>visitor#a91</b>: "need a hand with the upgrade?"
                    </span>
                  </div>
                </div>
              </div>
              <div className="monitor-foot">
                <span>
                  BPM <b id="bpm">72</b>
                </span>
                <span>
                  RX <b id="rx">0</b> ev/s
                </span>
                <span>
                  LAT <b>87ms</b>
                </span>
                <span className="rec">
                  <i /> PREVIEW
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── WHAT ─────────────────────── */}
      <section id="what" className="band band-ink">
        <div className="band-head">
          <span className="band-num">01</span>
          <h2>
            Most analytics tools tell you what happened <em>yesterday</em>.
          </h2>
          <p>
            LivePulse tells you what's happening right now — and lets you do something about it.
          </p>
        </div>

        <div className="cards">
          <article className="card">
            <div className="card-ico">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" fill="currentColor" />
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle
                  cx="12"
                  cy="12"
                  r="11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
              </svg>
            </div>
            <h3>Live presence</h3>
            <p>Every page view, click and scroll in real time. Watch the funnel breathe.</p>
          </article>
          <article className="card">
            <div className="card-ico">
              <svg viewBox="0 0 24 24">
                <path d="M3 17h6v4H3zM10 11h4v10h-4zM15 5h6v16h-6z" fill="currentColor" />
              </svg>
            </div>
            <h3>Intent signals</h3>
            <p>Rage-clicks, scroll depth, time on page. The signals GA throws away.</p>
          </article>
          <article className="card">
            <div className="card-ico">
              <svg viewBox="0 0 24 24">
                <path
                  d="M12 2 2 22h20L12 2zm0 7 6.5 11h-13L12 9zm-1 4h2v3h-2zm0 4h2v2h-2z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <h3>Error firehose</h3>
            <p>JS errors clustered and tied to the visitors who actually hit them.</p>
          </article>
          <article className="card card-feature">
            <div className="card-ico">
              <svg viewBox="0 0 24 24">
                <path d="M4 4h16v12H7l-3 3V4z" fill="currentColor" />
              </svg>
            </div>
            <h3>
              Direct chat <span className="pill">killer feature</span>
            </h3>
            <p>
              Click a visitor in the feed. Start typing. No email. No widget. Just a knock on the
              glass.
            </p>
          </article>
        </div>
      </section>

      {/* ─────────────────────── HOW ─────────────────────── */}
      <section id="how" className="band">
        <div className="band-head">
          <span className="band-num">02</span>
          <h2>The pipeline, drawn honestly.</h2>
          <p>
            From <code>window</code> to your dashboard — no vendor magic, one clear path.
          </p>
        </div>

        <div className="pipeline">
          <div className="stage">
            <span className="stage-tag">browser</span>
            <b>SDK</b>
            <i>batches events every ~5s, one script tag</i>
          </div>
          <div className="arrow">
            <span />
          </div>
          <div className="stage">
            <span className="stage-tag">backend</span>
            <b>Collector</b>
            <i>Node/Express · validates the api key · geo-enriches</i>
          </div>
          <div className="arrow">
            <span />
          </div>
          <div className="stage-col">
            <div className="stage hot">
              <span className="stage-tag">&lt;100ms</span>
              <b>Socket.IO</b>
              <i>pushes straight to your dashboard, room-isolated per project</i>
            </div>
            <div className="stage cold">
              <span className="stage-tag">durable</span>
              <b>MongoDB</b>
              <i>events, sessions, chat — queryable, 30-day TTL</i>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── DASHBOARD (preview) ─────────────────────── */}
      <section id="dash" className="band band-bone">
        <div className="band-head">
          <span className="band-num">03</span>
          <h2>The dashboard isn't a chart. It's a control room.</h2>
          <p>
            A preview of the layout below —{" "}
            <Link to={primaryTo}>
              {user ? "open your real one →" : "sign in for the real, live one →"}
            </Link>
          </p>
        </div>

        <div className="dashboard">
          <aside className="d-col d-now">
            <header>
              <h4>NOW</h4>
              <span id="nowCount">12</span>
            </header>
            <ul id="visitorList" className="visitors" />
          </aside>

          <main className="d-col d-map">
            <header>
              <h4>WORLD</h4>
              <span className="map-legend">
                <i className="dot pulse-dot" /> active sessions
              </span>
            </header>
            <div className="map">
              <svg viewBox="0 0 800 380" className="map-svg" preserveAspectRatio="xMidYMid meet">
                <g id="dotGrid" />
                <g id="pings" />
              </svg>
            </div>
            <footer className="d-metrics">
              <div>
                <span>BPM</span>
                <b id="dBpm">72</b>
              </div>
              <div>
                <span>Page/min</span>
                <b id="dPpm">38</b>
              </div>
              <div>
                <span>Hovers/min</span>
                <b id="dHpm">14</b>
              </div>
              <div>
                <span>Errors</span>
                <b id="dErr">2</b>
              </div>
            </footer>
          </main>

          <aside className="d-col d-stream">
            <header>
              <h4>STREAM</h4>
              <span className="live">
                <i /> preview
              </span>
            </header>
            <ul id="streamList" className="stream" />
          </aside>
        </div>
      </section>

      {/* ─────────────────────── CHAT (preview) ─────────────────────── */}
      <section id="chat" className="band">
        <div className="band-head">
          <span className="band-num">04</span>
          <h2>And then — you just say hi.</h2>
          <p>
            No widget config. No email gate. You see them. They see you. That's the whole feature.
          </p>
        </div>

        <div className="chat-demo">
          <div className="chat-side">
            <p className="chat-context">
              visitor <b>#a91</b> · /pricing · Berlin · 4m 12s on site
              <br />
              hovered <code>[Buy Pro]</code> twice · scrolled 92%
            </p>
            <button className="btn-primary small" id="chatPing" type="button">
              ↺ replay conversation
            </button>
          </div>

          <div className="chat-window" id="chatWindow">
            <header>
              <span className="chat-who">
                <i className="dot" /> visitor#a91
              </span>
              <span className="chat-meta">private · ephemeral · no email asked</span>
            </header>
            <ol className="chat-log" id="chatLog" />
            <div className="chat-input">
              <span>you</span>
              <input type="text" placeholder="press enter to send…" id="chatInput" />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── INSTALL ─────────────────────── */}
      <section id="install" className="band band-ink">
        <div className="band-head">
          <span className="band-num">05</span>
          <h2>One script tag. That's the install.</h2>
          <p>
            Drop it anywhere in <code>&lt;head&gt;</code> or before <code>&lt;/body&gt;</code>.
            Works with React, plain HTML, Webflow, your buddy's Wix site.
          </p>
        </div>

        <div className="install-grid">
          <pre className="snippet">
            <code>
              <span className="c">
                {"// generic example — sign in for your project's real key"}
              </span>
              {"\n"}
              <span className="t">{"<script"}</span> <span className="a">src</span>=
              <span className="s">"{API_URL}/sdk/livepulse.js"</span>
              {"\n        "}
              <span className="a">data-key</span>=<span className="s">"lp_your_project_key"</span>{" "}
              <span className="a">data-chat</span>=<span className="s">"true"</span>{" "}
              <span className="a">defer</span>
              <span className="t">{"></script>"}</span>
            </code>
          </pre>
          <ul className="checks">
            <li>✓ vanilla JS · zero deps</li>
            <li>✓ auto-tracks page views, clicks, errors, scroll depth</li>
            <li>✓ chat widget lazy-loads only if data-chat="true"</li>
            <li>✓ api key is write-only — it can't read your data back</li>
          </ul>
        </div>

        <div className="cta-final">
          <a href="https://github.com/mantrapatel05/LivePulse" className="btn-primary big">
            ★ star on github · mantrapatel05/LivePulse
          </a>
          <p className="cta-sub">
            <Link to={primaryTo} className="under">
              {user ? "open your dashboard →" : "sign in to get your own project key →"}
            </Link>
          </p>
        </div>
      </section>

      <footer className="foot">
        <span>LivePulse · v0.1 · 2026</span>
        <span>
          made by <span className="under">@mantrapatel05</span>
        </span>
        <span className="heart">
          ♥ <span id="footBpm">72</span> bpm
        </span>
      </footer>
    </div>
  );
}
