import { useEffect, useState } from "react";
import { updateDigest, type LPProject } from "../../lib/api";
import { Panel } from "./Panel";

export function DigestSettings({ project }: { project: LPProject }) {
  const [enabled, setEnabled] = useState(project.digest?.enabled === true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const available = project.analyticsBackend === "clickhouse";

  useEffect(
    () => setEnabled(project.digest?.enabled === true),
    [project._id, project.digest?.enabled],
  );

  async function change(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateDigest(project._id, next);
      setEnabled(updated.digest?.enabled === true);
      setMessage(next ? "Weekly digest enabled." : "Weekly digest disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't update the digest setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel label="email" title="weekly digest" className="span-12">
      <div className="lp-ai-settings">
        <div>
          <p>
            Off by default. Every Monday (09:00 UTC) we email you a summary of the last 7 days:
            engagement trend, top pages and top errors. It goes to the verified email address on
            your account, and every email has an unsubscribe link. If AI insights are enabled for
            this project, a short AI-written note is added, based only on those numbers.
            {!available && " Available after this project is migrated to ClickHouse."}
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
            disabled={busy || !available}
            onChange={(event) => void change(event.target.checked)}
            aria-label="Enable weekly digest"
          />
          <i aria-hidden="true" />
        </label>
      </div>
    </Panel>
  );
}
