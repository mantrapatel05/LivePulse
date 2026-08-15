import { Link } from "@tanstack/react-router";

export function BrandMark({ width = 44 }: { width?: number }) {
  return (
    <svg viewBox="0 0 60 24" width={width} height={width * 0.42} aria-hidden="true">
      <polyline
        points="0,12 12,12 16,4 22,20 28,8 32,12 60,12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="lp-brand" aria-label="LivePulse home">
      <BrandMark />
      <span className="lp-brand-name">LivePulse</span>
    </Link>
  );
}
