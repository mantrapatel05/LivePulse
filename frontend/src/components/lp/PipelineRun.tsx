import { useCallback, useEffect, useRef, useState } from "react";
import { PIPELINE_TIMELINES, type PipelineScene } from "./pipelineTimeline";

type Scene = PipelineScene;
type Edge =
  | "sdk-collector"
  | "collector-socket"
  | "socket-dashboard"
  | "collector-redis"
  | "redis-worker"
  | "worker-ch"
  | "collector-mongo"
  | "worker-dlq";

const SCENES: { id: Scene; label: string; duration: number; caption: string }[] = [
  {
    id: "happy",
    label: "Happy path",
    duration: 9000,
    caption:
      "One event fans out live, lands in the durable stream, then reaches ClickHouse in a batch.",
  },
  {
    id: "retry",
    label: "Retry",
    duration: 10000,
    caption:
      "A worker crash leaves the entry pending; another consumer claims it and completes the write.",
  },
  {
    id: "dead",
    label: "Dead letter",
    duration: 11000,
    caption:
      "A poison event exhausts five attempts, then moves to the dead-letter stream for inspection.",
  },
];

const EDGES: { id: Edge; from: string; to: string; kind?: "async" | "side" }[] = [
  { id: "sdk-collector", from: "sdk", to: "collector" },
  { id: "collector-socket", from: "collector", to: "socket" },
  { id: "socket-dashboard", from: "socket", to: "dashboard" },
  { id: "collector-redis", from: "collector", to: "redis", kind: "async" },
  { id: "redis-worker", from: "redis", to: "worker", kind: "async" },
  { id: "worker-ch", from: "worker", to: "clickhouse", kind: "async" },
  { id: "collector-mongo", from: "collector", to: "mongo", kind: "side" },
  { id: "worker-dlq", from: "worker", to: "dlq", kind: "side" },
];

const STAGES = [
  {
    id: "sdk",
    className: "run-sdk",
    index: "01",
    title: "SDK",
    detail: "batches every 5s or 20 events",
    popover: "The browser SDK batches events before sending them to the collector.",
    code: "sdk/src/livepulse.js",
  },
  {
    id: "collector",
    className: "run-collector",
    index: "02",
    title: "Collector",
    detail: "validate → claim → enrich",
    chips: ["api key ok", "schema v2", "PII scrubbed", "deduped"],
    popover:
      "The collector validates, claims, enriches, then fans each event into its delivery paths.",
    code: "backend/src/shared/ingestPipeline.js",
  },
  {
    id: "socket",
    className: "run-socket",
    index: "↗",
    title: "Socket.IO",
    detail: "project room · live fan-out",
    popover: "Project-scoped rooms deliver visitor and event updates to connected dashboards.",
    code: "backend/src/sockets/socketHandler.js",
  },
  {
    id: "dashboard",
    className: "run-dashboard",
    index: "LIVE VIEW",
    title: "Dashboard",
    detail: "visitor joins the stream",
    popover: "The dashboard receives room events and updates the live visitor feed.",
    code: "frontend/src/components/lp/ControlRoomV2.tsx",
  },
  {
    id: "redis",
    className: "run-redis",
    index: "03",
    title: "Redis Streams",
    detail: "durable buffer · consumer groups",
    codeLine: "events:v2 · group clickhouse-writers",
    popover: "Redis Streams holds claimed events until a worker acknowledges them.",
    code: "backend/src/shared/redisStream.js",
  },
  {
    id: "worker",
    className: "run-worker",
    index: "04",
    title: "Worker",
    detail: "batch writer · up to 500",
    popover: "Workers claim stream entries, batch them, and write analytics rows.",
    code: "backend/worker.js",
  },
  {
    id: "clickhouse",
    className: "run-clickhouse",
    index: "05",
    title: "ClickHouse",
    detail: "analytics · 90-day retention",
    popover: "ClickHouse serves analytics reads after parity checks pass for a project.",
    code: "backend/src/shared/clickhouseClient.js",
  },
  {
    id: "mongo",
    className: "run-mongo",
    index: "OPS STORE",
    title: "MongoDB",
    detail: "dual-write during migration",
    popover: "MongoDB remains the operational store and keeps the migration copy of events.",
    code: "backend/src/models/Event.js",
  },
];

function edgePath(a: DOMRect, b: DOMRect, bounds: DOMRect) {
  const ax = a.left + a.width / 2 - bounds.left;
  const ay = a.top + a.height / 2 - bounds.top;
  const bx = b.left + b.width / 2 - bounds.left;
  const by = b.top + b.height / 2 - bounds.top;
  const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);
  const sx = horizontal ? ax + (Math.sign(bx - ax) * a.width) / 2 : ax;
  const sy = horizontal ? ay : ay + (Math.sign(by - ay) * a.height) / 2;
  const ex = horizontal ? bx - (Math.sign(bx - ax) * b.width) / 2 : bx;
  const ey = horizontal ? by : by - (Math.sign(by - ay) * b.height) / 2;
  if (horizontal) {
    const mid = (sx + ex) / 2;
    return `M ${sx} ${sy} H ${mid - 10} Q ${mid} ${sy} ${mid} ${sy + Math.sign(ey - sy) * 10} V ${ey - Math.sign(ey - sy) * 10} Q ${mid} ${ey} ${mid + 10} ${ey} H ${ex}`;
  }
  const mid = (sy + ey) / 2;
  return `M ${sx} ${sy} V ${mid - 10} Q ${sx} ${mid} ${sx + Math.sign(ex - sx) * 10} ${mid} H ${ex - Math.sign(ex - sx) * 10} Q ${ex} ${mid} ${ex} ${mid + 10} V ${ey}`;
}

export function PipelineRun() {
  const [scene, setScene] = useState<Scene>("happy");
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [cycleScenes, setCycleScenes] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [popover, setPopover] = useState<string | null>(null);
  const [paths, setPaths] = useState<Record<Edge, string>>({} as Record<Edge, string>);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const packetRef = useRef<SVGGElement>(null);
  const tipTimerRef = useRef<number | undefined>(undefined);
  const visibleRef = useRef(false);
  const currentRef = useRef({ playing, elapsed, scene, cycleScenes });
  currentRef.current = { playing, elapsed, scene, cycleScenes };

  const sceneConfig = SCENES.find((item) => item.id === scene)!;
  const events = PIPELINE_TIMELINES[scene];
  const activeEvent = [...events].reverse().find((event) => event.at <= elapsed);
  const activeEdge =
    playing && !reducedMotion && activeEvent && paths[activeEvent.edge]
      ? activeEvent.edge
      : undefined;
  const complete = elapsed >= sceneConfig.duration;
  const activeStages = new Set(
    events.filter((event) => event.at <= elapsed).map((event) => event.stage),
  );

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const bounds = wrap.getBoundingClientRect();
    const next = {} as Record<Edge, string>;
    for (const edge of EDGES) {
      const from = nodeRefs.current[edge.from]?.getBoundingClientRect();
      const to = nodeRefs.current[edge.to]?.getBoundingClientRect();
      if (from && to) next[edge.id] = edgePath(from, to, bounds);
    }
    setPaths(next);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (wrapRef.current) observer.observe(wrapRef.current);
    Object.values(nodeRefs.current).forEach((node) => node && observer.observe(node));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (!visibleRef.current || document.hidden) return;
      const current = currentRef.current;
      const duration = SCENES.find((item) => item.id === current.scene)!.duration;
      if (current.elapsed + 80 < duration) {
        setElapsed(current.elapsed + 80);
        return;
      }
      setElapsed(0);
      if (current.cycleScenes) {
        const index = SCENES.findIndex((item) => item.id === current.scene);
        setScene(SCENES[(index + 1) % SCENES.length].id);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion, cycleScenes, scene]);

  useEffect(() => {
    let frame = 0;
    let alive = true;
    const draw = (now: number) => {
      if (!alive) return;
      frame = requestAnimationFrame(draw);
      if (!visibleRef.current || document.hidden || reducedMotion) return;
      const current = currentRef.current;
      if (!current.playing) return;
      const item = [...PIPELINE_TIMELINES[current.scene]]
        .reverse()
        .find((event) => event.at <= current.elapsed);
      const packet = packetRef.current;
      const path = item && pathRefs.current[item.edge];
      if (!packet || !path || !item || !path.getAttribute("d")) return;
      const duration = 1350;
      const elapsed = current.elapsed - item.at + (now % 80);
      if (elapsed >= duration) {
        packet.style.opacity = "0";
        return;
      }
      const progress = Math.max(0, elapsed / duration);
      const length = path.getTotalLength();
      const point = path.getPointAtLength(length * progress);
      packet.setAttribute("transform", `translate(${point.x} ${point.y})`);
      packet.style.opacity = "1";
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (!entry.isIntersecting && frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        } else if (entry.isIntersecting && !frame) {
          frame = requestAnimationFrame(draw);
        }
      },
      { threshold: 0.1 },
    );
    if (wrapRef.current) observer.observe(wrapRef.current);
    const onVisibility = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!document.hidden && visibleRef.current && !frame) {
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (!document.hidden) frame = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) setElapsed(sceneConfig.duration);
  }, [reducedMotion, sceneConfig.duration]);

  useEffect(() => {
    if (!popover) return;
    const dismiss = (event: KeyboardEvent) => event.key === "Escape" && setPopover(null);
    const dismissOnScroll = () => setPopover(null);
    window.addEventListener("keydown", dismiss);
    window.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("scroll", dismissOnScroll, true);
    };
  }, [popover]);

  useEffect(() => () => window.clearTimeout(tipTimerRef.current), []);

  const selectScene = (next: Scene) => {
    setScene(next);
    setElapsed(0);
    setCycleScenes(false);
    setPlaying(true);
    setPopover(null);
  };
  const currentLabel = activeEvent?.label ?? "waiting for event";
  const caption = sceneConfig.caption;
  const infoProps = { popover, setPopover, timerRef: tipTimerRef };

  return (
    <div
      className={`heartbeat-run${reducedMotion ? " is-reduced" : ""}${playing ? "" : " is-paused"}`}
      role="group"
      aria-label="LivePulse pipeline run preview"
    >
      <div className="heartbeat-toolbar">
        <div className="heartbeat-window-title">
          <span className="heartbeat-window-dot" /> Pipeline.app <span>LIVE TRACE / SAMPLE</span>
        </div>
        <div className="heartbeat-controls">
          <div className="heartbeat-segments" role="radiogroup" aria-label="Pipeline scene">
            {SCENES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={scene === item.id}
                className={scene === item.id ? "is-selected" : ""}
                tabIndex={scene === item.id ? 0 : -1}
                onClick={() => selectScene(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const index = SCENES.findIndex((entry) => entry.id === scene);
                  const direction = event.key === "ArrowRight" ? 1 : -1;
                  const next = SCENES[(index + direction + SCENES.length) % SCENES.length];
                  selectScene(next.id);
                  window.requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(`[role="radio"][aria-checked="true"]`)
                      ?.focus(),
                  );
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            className="heartbeat-play"
            type="button"
            aria-label={playing ? "Pause pipeline" : "Play pipeline"}
            title={playing ? "Pause pipeline" : "Play pipeline"}
            onClick={() => {
              setPlaying((value) => !value);
              setCycleScenes(true);
            }}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14M16 5v14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8 5 11 7-11 7z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="heartbeat-readout" aria-live="off">
        <span>
          <i className={playing && !reducedMotion ? "is-pulsing" : ""} />
          {scene === "dead"
            ? "POISON EVENT"
            : scene === "retry"
              ? "WORKER RECOVERY"
              : "EVENT TRACE"}
        </span>
        <code>{currentLabel}</code>
        <span className="heartbeat-clock">
          {complete || reducedMotion ? "TRACE COMPLETE" : `${(elapsed / 1000).toFixed(1)}s`}
        </span>
      </div>

      <div className="heartbeat-diagram" ref={wrapRef}>
        <svg
          className="heartbeat-edges"
          role="img"
          aria-label="The SDK sends events to the collector, which branches to Socket.IO and MongoDB while Redis Streams feeds a worker that writes ClickHouse analytics."
        >
          <defs>
            <marker
              id="heartbeat-arrow-active"
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 6 3 0 6z" />
            </marker>
            <marker
              id="heartbeat-arrow"
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 6 3 0 6z" />
            </marker>
            <filter id="heartbeat-edge-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {EDGES.map((edge) => (
            <path
              key={edge.id}
              ref={(node) => {
                pathRefs.current[edge.id] = node;
              }}
              d={paths[edge.id] ?? ""}
              className={`heartbeat-edge${edge.kind ? ` is-${edge.kind}` : ""}${activeEdge === edge.id ? " is-active" : ""}`}
              markerEnd={`url(#heartbeat-arrow${activeEdge === edge.id ? "-active" : ""})`}
            />
          ))}
          <g ref={packetRef} className={`heartbeat-packet${activeEdge ? " is-visible" : ""}`}>
            <circle className="packet-tail packet-tail-3" r="3" cx="-24" />
            <circle className="packet-tail packet-tail-2" r="4" cx="-16" />
            <circle className="packet-tail packet-tail-1" r="5" cx="-8" />
            <circle className="packet-head" r="5" />
          </g>
        </svg>

        <div
          className="heartbeat-card run-sdk"
          ref={(node) => {
            nodeRefs.current.sdk = node;
          }}
        >
          <NodeHeader
            index="01"
            title="SDK"
            active={activeStages.has("sdk")}
            infoProps={infoProps}
          />
          <p>batches every 5s or 20 events</p>
          <div className="mini-browser">
            <span>shop.example / product</span>
            <b>
              pro plan <span>buy pro</span>
            </b>
          </div>
        </div>

        <div
          className="heartbeat-card run-collector"
          ref={(node) => {
            nodeRefs.current.collector = node;
          }}
        >
          <NodeHeader
            index="02"
            title="Collector"
            active={activeStages.has("collector")}
            infoProps={infoProps}
          />
          <p>validate → claim → enrich</p>
          <div className="collector-checks">
            {STAGES[1].chips!.map((chip, index) => (
              <span key={chip} className={elapsed > 1800 + index * 250 ? "is-checked" : ""}>
                <i />
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div
          className={`heartbeat-card run-socket${activeStages.has("socket") ? " is-lit" : ""}`}
          ref={(node) => {
            nodeRefs.current.socket = node;
          }}
        >
          <NodeHeader
            index="↗"
            title="Socket.IO"
            active={activeStages.has("socket")}
            infoProps={infoProps}
          />
          <p>room-isolated live fan-out</p>
        </div>
        <div
          className={`heartbeat-card run-dashboard${activeStages.has("dashboard") ? " is-lit" : ""}`}
          ref={(node) => {
            nodeRefs.current.dashboard = node;
          }}
        >
          <InfoButton id="dashboard" {...infoProps} />
          <div className="dashboard-mini-head">
            <span>LIVE VISITORS</span>
            <i>● 1</i>
          </div>
          <div
            className={`dashboard-mini-row${activeStages.has("dashboard") ? " has-arrived" : ""}`}
          >
            <span className="mini-avatar">M</span>
            <span>visitor · /product</span>
            <b>&lt; 1s</b>
          </div>
        </div>

        <div
          className={`heartbeat-card run-redis${activeStages.has("redis") ? " is-lit" : ""}`}
          ref={(node) => {
            nodeRefs.current.redis = node;
          }}
        >
          <NodeHeader
            index="03"
            title="Redis Streams"
            active={activeStages.has("redis")}
            infoProps={infoProps}
          />
          <p>durable buffer · consumer groups</p>
          <code className="stream-id">
            1710000000000-0{" "}
            <span>
              {scene === "dead" && activeStages.has("dlq")
                ? "DLQ 1"
                : activeStages.has("clickhouse")
                  ? "PENDING 0"
                  : activeStages.has("redis")
                    ? "PENDING 1"
                    : "DLQ 0"}
            </span>
          </code>
          <small>events:v2 · group clickhouse-writers</small>
        </div>

        <div
          className={`heartbeat-card run-worker${activeStages.has("worker") ? " is-lit" : ""}${scene === "retry" && elapsed >= 5900 && elapsed < 7700 ? " is-failed" : ""}`}
          ref={(node) => {
            nodeRefs.current.worker = node;
          }}
        >
          <NodeHeader
            index="04"
            title={scene === "retry" && elapsed >= 7700 ? "worker-2" : "Worker"}
            active={activeStages.has("worker") || activeStages.has("worker-2")}
            infoProps={infoProps}
          />
          <p>
            {scene === "dead" && elapsed >= 3100
              ? currentLabel
              : scene === "retry" && elapsed >= 5900 && elapsed < 7700
                ? "process stopped · pending"
                : activeStages.has("worker")
                  ? "XREADGROUP · batch up to 500"
                  : "batch writer · up to 500"}
          </p>
          {scene === "retry" && elapsed >= 5900 && elapsed < 7700 && (
            <span className="worker-fault" aria-label="worker crashed">
              ×
            </span>
          )}
          {scene === "retry" && elapsed >= 5900 && elapsed < 8800 && (
            <div className="retry-meter">
              <span />
              <b>XAUTOCLAIM · 30s idle</b>
            </div>
          )}
          {scene === "dead" && elapsed >= 3100 && (
            <div className="attempt-meter">
              <span
                style={{ width: `${Math.min(100, Math.max(8, ((elapsed - 3100) / 6000) * 100))}%` }}
              />
              <b>{Math.min(5, 1 + Math.floor((elapsed - 3100) / 1000))}/5 attempts</b>
            </div>
          )}
        </div>

        <div
          className={`heartbeat-card run-clickhouse${activeStages.has("clickhouse") ? " is-lit" : ""}`}
          ref={(node) => {
            nodeRefs.current.clickhouse = node;
          }}
        >
          <NodeHeader
            index="05"
            title="ClickHouse"
            active={activeStages.has("clickhouse")}
            infoProps={infoProps}
          />
          <p>worker batches 500 → insert</p>
          <div className="column-burst" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <small>analytics · 90-day retention</small>
        </div>

        <div
          className={`heartbeat-card run-mongo${activeStages.has("mongo") ? " is-lit" : ""}`}
          ref={(node) => {
            nodeRefs.current.mongo = node;
          }}
        >
          <NodeHeader
            index="OPS"
            title="MongoDB"
            active={activeStages.has("mongo")}
            infoProps={infoProps}
          />
          <p>dual-write (migration)</p>
        </div>

        <div className="heartbeat-dlq-slot">
          {scene === "dead" && elapsed >= 8300 && (
            <div
              className="heartbeat-card run-dlq is-lit"
              ref={(node) => {
                nodeRefs.current.dlq = node;
              }}
            >
              <div>
                <span className="dlq-eyebrow">DEAD LETTER · 1</span>
                <b>events:v2:dead</b>
                <code>1710000000000-0 · poison</code>
              </div>
              <span className="dlq-alert">LivePulseDeadLetterQueueActivity</span>
            </div>
          )}
        </div>
      </div>

      <p className="heartbeat-caption" aria-live="polite">
        {caption}
      </p>
      <div className="heartbeat-footnote">
        <span>
          <i /> Illustrative — not live traffic.
        </span>
        <span>
          {scene === "dead"
            ? "5 retries → dead-letter policy"
            : scene === "retry"
              ? "at-least-once · recovery path"
              : "at-least-once · durable path"}
        </span>
      </div>
      <ol className="visually-hidden">
        <li>Browser SDK batches events and sends them to the collector.</li>
        <li>
          The collector validates and enriches events, then sends live updates to Socket.IO and
          operational data to MongoDB.
        </li>
        <li>
          Analytics events enter Redis Streams, pass through a batch worker, and are written to
          ClickHouse.
        </li>
        <li>
          Retry and dead-letter scenes illustrate worker recovery and exhausted delivery attempts.
        </li>
      </ol>
    </div>
  );
}

type InfoProps = {
  popover: string | null;
  setPopover: (id: string | null) => void;
  timerRef: { current: number | undefined };
};

function InfoButton({ id, popover, setPopover, timerRef }: InfoProps & { id: string }) {
  const stage = STAGES.find((item) => item.id === id);
  if (!stage) return null;
  return (
    <button
      type="button"
      className="heartbeat-info"
      aria-label={`About ${stage.title}`}
      aria-expanded={popover === id}
      onMouseEnter={() => {
        timerRef.current = window.setTimeout(() => setPopover(id), 150);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timerRef.current);
        setPopover(null);
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) setPopover(id);
      }}
      onBlur={() => setPopover(null)}
      onClick={() => {
        if (window.matchMedia("(pointer: coarse)").matches) {
          setPopover(popover === id ? null : id);
        }
      }}
    >
      {popover === id && (
        <span role="tooltip">
          {stage.popover}
          <code>{stage.code}</code>
        </span>
      )}
      <i>i</i>
    </button>
  );
}

function NodeHeader({
  index,
  title,
  active,
  infoProps,
}: {
  index: string;
  title: string;
  active: boolean;
  infoProps: InfoProps;
}) {
  const stage = STAGES.find((item) => item.index === index);
  return (
    <div className="heartbeat-node-head">
      <span>{index}</span>
      <b>{title}</b>
      <i className={active ? "is-active" : ""} />
      {stage && <InfoButton id={stage.id} {...infoProps} />}
    </div>
  );
}
