import { useEffect, useState } from "react";
import { analyticsV2, type SessionTimelineV2 } from "../../lib/apiV2";
import { clock } from "../../lib/usePolling";

export function SessionTimelineDialog({
  projectId,
  sessionId,
  onClose,
}: {
  projectId: string;
  sessionId: string;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<SessionTimelineV2 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    analyticsV2(projectId)
      .sessionTimeline(sessionId)
      .then((res) => alive && setTimeline(res.data))
      .catch(
        (err) =>
          alive &&
          setError(err instanceof Error ? err.message : "Couldn't load this session's timeline."),
      );
    return () => {
      alive = false;
    };
  }, [projectId, sessionId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lp-modal-backdrop" onClick={onClose}>
      <div
        className="lp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Timeline for session ${sessionId}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="lp-modal-head">
          <div>
            <span className="lp-num">session</span>
            <h3>{sessionId.slice(0, 16)}</h3>
          </div>
          <button type="button" className="lp-btn-link" onClick={onClose} aria-label="Close">
            close ✕
          </button>
        </header>

        {error && (
          <div className="lp-alert" role="alert">
            <b>Couldn't load timeline</b>
            {error}
          </div>
        )}

        {!error && !timeline && <p className="lp-empty">Loading…</p>}

        {timeline && (
          <>
            <div className="lp-stat-deck compact">
              <MiniStat label="events" value={timeline.eventCount} />
              <MiniStat label="errors" value={timeline.errorCount} />
              <MiniStat label="engaged" value={`${timeline.engagedSeconds}s`} />
              <MiniStat label="entry" value={shortenUrl(timeline.entryUrl)} />
              <MiniStat label="exit" value={shortenUrl(timeline.exitUrl)} />
            </div>

            <ol className="lp-timeline">
              {timeline.events.map((e) => (
                <li key={e.event_id}>
                  <span className="t">
                    {clock(Date.parse(e.occurred_at.replace(" ", "T") + "Z"))}
                  </span>
                  <span className={`lp-k ${e.event_type === "error" ? "err" : "view"}`}>
                    {e.event_type}
                  </span>
                  <span className="lp-stream-label">
                    {e.url}
                    {e.element ? ` · ${e.element}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="lp-mini-stat">
      <span>{label}</span>
      <b title={String(value)}>{value}</b>
    </div>
  );
}

function shortenUrl(url: string | undefined): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url.slice(0, 40);
  }
}
