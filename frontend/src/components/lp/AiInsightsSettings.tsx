import { useEffect, useState } from "react";
import { updateAiInsights, type LPProject } from "../../lib/api";
import { Panel } from "./Panel";

export function AiInsightsSettings({ project }: { project: LPProject }) {
  const [enabled, setEnabled] = useState(project.aiInsights?.enabled === true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () => setEnabled(project.aiInsights?.enabled === true),
    [project._id, project.aiInsights?.enabled],
  );

  async function changeEnabled(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateAiInsights(project._id, next);
      setEnabled(updated.aiInsights?.enabled === true);
      setMessage(
        next ? "AI session insights enabled for this project." : "AI session insights disabled.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Couldn't update the AI insight setting.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel label="privacy" title="AI session insights" className="span-12">
      <div className="lp-ai-settings">
        <div>
          <p>
            Off by default. When you click Explain, LivePulse sends a scrubbed session summary to
            the configured third-party LLM provider (OpenRouter by default): page paths, event
            types, and truncated error messages. Error explanations can include up to five session
            summaries. No user IDs, IP addresses, chat messages, full properties, or client context
            are sent. Scrubbing is best effort; provider policies apply, and free model endpoints
            may log prompts. Don't use this with confidential or sensitive session data.
          </p>
          {message && (
            <small className="lp-ai-settings-message" role="status">
              {message}
            </small>
          )}
        </div>
        <label className="lp-toggle">
          <span>{enabled ? "enabled" : "off"}</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => void changeEnabled(event.target.checked)}
            aria-label="Enable AI session insights"
          />
          <i aria-hidden="true" />
        </label>
      </div>
    </Panel>
  );
}
