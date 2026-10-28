import type { EngagementDrift } from "../../lib/apiV2";
import { Bars, Empty, Panel } from "./Panel";

const STATUS_TONE = {
  ok: "ok",
  watch: "warn",
  drop: "bad",
  insufficient_data: "warn",
} as const;

const STATUS_LABEL = {
  ok: "steady",
  watch: "watch",
  drop: "dropping",
  insufficient_data: "not enough data",
} as const;

const METRIC_LABEL: Record<string, string> = {
  sessions: "sessions",
  events: "events",
  avg_engaged_seconds: "avg engaged",
  rage_clicks: "rage clicks",
  error_rate: "error rate",
};

function signedPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value}%`;
}

export function EngagementPanel({
  drift,
  loading = false,
  error,
}: {
  drift: EngagementDrift | undefined;
  loading?: boolean;
  error?: string | null;
}) {
  if (!drift) {
    return (
      <Panel label="engagement" title="vs previous 7 days" className="span-4">
        {error ? (
          <Empty>{error}</Empty>
        ) : (
          <Empty>{loading ? "Loading…" : "No engagement data."}</Empty>
        )}
      </Panel>
    );
  }

  const metricRows = drift.metrics.map((metric) => ({
    key: metric.name,
    label: METRIC_LABEL[metric.name] ?? metric.name,
    value: Math.abs(metric.deltaPct ?? 0),
    sub: signedPercent(metric.deltaPct),
  }));
  const pageRows = drift.topDecliners.map((page) => ({
    key: page.path,
    label: page.path || "/",
    value: Math.abs(page.deltaPct ?? 0),
    sub: signedPercent(page.deltaPct),
  }));

  return (
    <Panel label="engagement" title="vs previous 7 days" className="span-4">
      <span className={`lp-chip lp-health-${STATUS_TONE[drift.status]}`}>
        <i /> {STATUS_LABEL[drift.status]}
      </span>
      <p className="lp-empty">{drift.summary}</p>

      {drift.status === "insufficient_data" ? (
        <Empty>
          Comparisons need at least the configured minimum number of sessions in the previous 7-day
          window, so a small sample cannot trigger a misleading alert.
        </Empty>
      ) : (
        <>
          <Bars rows={metricRows} />
          {pageRows.length > 0 && (
            <>
              <span className="lp-panel-label">biggest page declines</span>
              <Bars rows={pageRows} />
            </>
          )}
        </>
      )}
    </Panel>
  );
}
