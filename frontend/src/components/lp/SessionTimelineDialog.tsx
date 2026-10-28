import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  analyticsV2,
  type InsightResult,
  type SessionInsight,
  type SessionTimelineV2,
} from "../../lib/apiV2";
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
  const [insight, setInsight] = useState<InsightResult<SessionInsight> | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTimeline(null);
    setError(null);
    setInsight(null);
    setInsightError(null);
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
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function explain() {
    setExplaining(true);
    setInsightError(null);
    try {
      const response = await analyticsV2(projectId).explainSession(sessionId);
      if (!("data" in response)) {
        setInsightError(
          "This session is already being explained in another tab. Try again shortly.",
        );
        return;
      }
      setInsight(response.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setInsightError(
          "AI insights are off. Enable them in the project's Install settings, then try again.",
        );
      } else if (err instanceof ApiError && err.status === 409) {
        setInsightError(
          "Explain session is available after this project is migrated to ClickHouse.",
        );
      } else if (err instanceof ApiError && err.status === 429) {
        const seconds = err.retryAfterSeconds;
        setInsightError(
          seconds
            ? `Rate limit reached. Try again in ${seconds} seconds.`
            : err.resetsAt
              ? `Daily limit reached. Resets at ${new Date(err.resetsAt).toLocaleTimeString()}.`
              : "The AI insight limit has been reached. Try again later.",
        );
      } else {
        setInsightError(err instanceof Error ? err.message : "Couldn't explain this session.");
      }
    } finally {
      setExplaining(false);
    }
  }

  function showEvidence(eventId: string) {
    setHighlightedEventId(eventId);
    document
      .getElementById(`lp-event-${eventId}`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="lp-modal-backdrop" onClick={onClose}>
      <div
        className="lp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Timeline for session ${sessionId}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="lp-modal-head">
          <div>
            <span className="lp-num">session</span>
            <h3>{sessionId.slice(0, 16)}</h3>
          </div>
          <button type="button" className="lp-btn-link" onClick={onClose} aria-label="Close">
            close ×
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

            <section className="lp-ai-section" aria-label="AI session insight">
              <div className="lp-ai-actions">
                <div>
                  <span className="lp-panel-label">session readout</span>
                  <p className="lp-ai-privacy">
                    A grounded summary of this session's scrubbed event trail.
                  </p>
                </div>
                <button
                  type="button"
                  className="lp-btn small"
                  onClick={() => void explain()}
                  disabled={explaining}
                >
                  {explaining ? "reading session…" : insight ? "explain again" : "explain session"}
                </button>
              </div>

              {explaining && (
                <div
                  className="lp-ai-loading"
                  role="status"
                  aria-label="Generating session insight"
                >
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {insightError && (
                <div className="lp-alert" role="alert">
                  {insightError}
                </div>
              )}
              {insight && <SessionInsightView result={insight} onEvidence={showEvidence} />}
            </section>

            <ol className="lp-timeline">
              {timeline.events.map((event) => (
                <li
                  key={event.event_id}
                  id={`lp-event-${event.event_id}`}
                  className={highlightedEventId === event.event_id ? "is-evidence" : ""}
                >
                  <span className="t">
                    {clock(Date.parse(event.occurred_at.replace(" ", "T") + "Z"))}
                  </span>
                  <span className={`lp-k ${event.event_type === "error" ? "err" : "view"}`}>
                    {event.event_type}
                  </span>
                  <span className="lp-stream-label">
                    {event.url}
                    {event.element ? ` · ${event.element}` : ""}
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

function SessionInsightView({
  result,
  onEvidence,
}: {
  result: InsightResult<SessionInsight>;
  onEvidence: (eventId: string) => void;
}) {
  const insight = result.insight;
  return (
    <div className="lp-ai-insight" aria-live="polite">
      <div className="lp-ai-result-meta">
        <span className={`lp-chip lp-outcome-${insight.outcome}`}>
          <i />
          {insight.outcome}
        </span>
        {result.cached && <span className="lp-ai-tag">cached</span>}
        {result.degraded && (
          <span className="lp-ai-tag is-warn">basic summary · AI unavailable</span>
        )}
      </div>
      <h4>{insight.headline}</h4>
      <p>{insight.narrative}</p>
      {insight.friction.length > 0 && (
        <div className="lp-ai-detail">
          <span className="lp-panel-label">friction in the trail</span>
          <ul>
            {insight.friction.map((item, index) => (
              <li key={`${item.kind}-${index}`}>
                <span className="lp-ai-friction-kind">{item.kind}</span>
                <span>{item.note}</span>
                <span className="lp-ai-evidence">
                  {item.eventIds.map((id) => (
                    <button key={id} type="button" onClick={() => onEvidence(id)}>
                      event {id.slice(0, 8)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {insight.suggestedActions.length > 0 && (
        <div className="lp-ai-detail">
          <span className="lp-panel-label">possible next steps</span>
          <ul>
            {insight.suggestedActions.map((action, index) => (
              <li key={`${index}-${action}`}>{action}</li>
            ))}
          </ul>
        </div>
      )}
      <small className="lp-ai-disclaimer">AI-generated. Verify against the timeline.</small>
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
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return url.slice(0, 40);
  }
}
