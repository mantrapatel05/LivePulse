import type { ReactNode } from "react";

export function Panel({
  label,
  title,
  right,
  children,
  className = "",
}: {
  label: string;
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`lp-panel ${className}`}>
      <header className="lp-panel-head">
        <span className="lp-panel-label">{label}</span>
        {title && <span className="lp-panel-title">{title}</span>}
        <span className="lp-panel-right">{right}</span>
      </header>
      <div className="lp-panel-body">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="lp-empty">{children}</p>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "pulse" | "signal";
}) {
  return (
    <div className="lp-stat">
      <span className="lp-stat-label">{label}</span>
      <b className={tone ? `lp-stat-value is-${tone}` : "lp-stat-value"}>{value}</b>
      {hint && <span className="lp-stat-hint">{hint}</span>}
    </div>
  );
}

export function Bars({
  rows,
}: {
  rows: { key: string; label: string; value: number; sub?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="lp-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="lp-bar-label" title={r.label}>
            {r.label}
          </span>
          <span className="lp-bar-track">
            <i style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </span>
          <span className="lp-bar-value">{r.sub ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Minimal inline sparkline — no chart lib, keeps the monitor language. */
export function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return <Empty>Not enough samples yet.</Empty>;
  const max = Math.max(...points, 1);
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${34 - (p / max) * 30}`)
    .join(" ");
  return (
    <svg className="lp-spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
