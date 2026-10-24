import { useEffect, useState } from "react";
import { getBadgeStats, updateBadge } from "../../lib/api";
import type { BadgeSettings, BadgeStats, LPProject } from "../../lib/api";
import { API_URL, PUBLIC_DASHBOARD_URL } from "../../lib/config";
import { buildSnippets } from "../../lib/badgeSnippets";
import { Empty, Panel, Stat } from "./Panel";

type SnippetTab = "html" | "markdown" | "react";

export function HypeBadgePreview({ project }: { project: LPProject }) {
  const initialBadge: BadgeSettings = project.badge ?? { enabled: false, minCount: 3 };
  const [enabled, setEnabled] = useState(initialBadge.enabled);
  const [minCount, setMinCount] = useState(initialBadge.minCount);
  const [savedMinCount, setSavedMinCount] = useState(initialBadge.minCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BadgeStats | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<SnippetTab>("html");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!project.publicId) return;
    let current = true;
    getBadgeStats(project._id)
      .then((value) => {
        if (current) setStats(value);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err.message : "Couldn't load badge stats.");
      });
    return () => {
      current = false;
    };
  }, [project._id, project.publicId]);

  if (!project.publicId) {
    return (
      <Panel label="hype badge" title="social proof" className="span-12">
        <Empty>
          This project has no public id yet. Run npm run backfill:public-id to assign one.
        </Empty>
      </Panel>
    );
  }

  const snippets = buildSnippets(project.publicId, API_URL, PUBLIC_DASHBOARD_URL);

  async function refreshStats() {
    try {
      setStats(await getBadgeStats(project._id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load badge stats.");
    }
  }

  async function saveEnabled() {
    const next = !enabled;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateBadge(project._id, { enabled: next });
      setEnabled(updated.badge?.enabled ?? next);
      setVersion((value) => value + 1);
      await refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update badge settings.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMinCount() {
    const parsed = Number(minCount);
    const next = Math.min(999, Math.max(3, Math.round(Number.isFinite(parsed) ? parsed : 3)));
    setMinCount(next);
    if (next === savedMinCount) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateBadge(project._id, { minCount: next });
      const saved = updated.badge?.minCount ?? next;
      setMinCount(saved);
      setSavedMinCount(saved);
      setVersion((value) => value + 1);
      await refreshStats();
    } catch (err) {
      setMinCount(savedMinCount);
      setError(err instanceof Error ? err.message : "Couldn't update badge settings.");
    } finally {
      setBusy(false);
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippets[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard permission denied: the snippet remains selectable */
    }
  }

  return (
    <Panel label="hype badge" title="social proof" className="span-12">
      {error && (
        <div className="lp-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lp-switch-row">
        <label htmlFor={`badge-enabled-${project._id}`}>
          <input
            id={`badge-enabled-${project._id}`}
            type="checkbox"
            checked={enabled}
            onChange={() => void saveEnabled()}
            disabled={busy}
          />{" "}
          show badge
        </label>
        <label htmlFor={`badge-min-count-${project._id}`}>
          minimum live readers{" "}
          <input
            id={`badge-min-count-${project._id}`}
            type="number"
            min={3}
            max={999}
            value={minCount}
            onChange={(event) => setMinCount(Number(event.currentTarget.value))}
            onBlur={() => void saveMinCount()}
            disabled={busy}
          />
        </label>
      </div>

      <p className="lp-empty">
        Below the threshold the badge shows visitors today; below 3 visitors it shows no number.
      </p>

      {enabled ? (
        <img
          src={`${API_URL}/badge/${project.publicId}.svg?v=${version}`}
          alt="LivePulse badge preview"
          height={30}
        />
      ) : (
        <p className="lp-empty">The badge is off.</p>
      )}

      <div className="lp-stat-deck">
        <Stat label="impressions today" value={stats?.today.impressions ?? "—"} />
        <Stat label="landing hits today" value={stats?.today.landingHits ?? "—"} />
        <Stat label="referred projects" value={stats?.referralProjects ?? "—"} />
      </div>
      <p className="lp-empty">
        Impressions are a rough hint because a CDN may cache most image requests.
      </p>

      <div role="tablist" aria-label="Badge snippet format">
        {(["html", "markdown", "react"] as const).map((format) => (
          <button
            key={format}
            type="button"
            role="tab"
            aria-selected={tab === format}
            className="lp-btn-link"
            onClick={() => setTab(format)}
            disabled={busy}
          >
            {format}
          </button>
        ))}
      </div>
      <pre className="lp-code">{snippets[tab]}</pre>
      <button
        type="button"
        className="lp-btn small"
        onClick={() => void copySnippet()}
        disabled={busy}
      >
        {copied ? "copied ✓" : "copy snippet"}
      </button>

      <p className="lp-empty">Optional pulse.js usage:</p>
      <pre className="lp-code">
        {`<script src="${API_URL}/pulse/pulse.js" data-public-id="${project.publicId}" defer></script>\n<span data-lp-pulse></span>`}
      </pre>
    </Panel>
  );
}
