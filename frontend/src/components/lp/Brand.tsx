import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

export type BrandVariant =
  "default" | "mono-black" | "mono-white" | "red" | "dark-surface" | "adaptive";

const VARIANT_COLORS: Record<BrandVariant, [string, string]> = {
  default: ["#0A0A0A", "#FF2D2D"],
  "mono-black": ["#0A0A0A", "#0A0A0A"],
  "mono-white": ["#EFEAE0", "#EFEAE0"],
  red: ["#FF2D2D", "#FF2D2D"],
  "dark-surface": ["#EFEAE0", "#FF2D2D"],
  adaptive: ["currentColor", "var(--pulse, #FF2D2D)"],
};

export interface BrandMarkProps {
  size?: number | string;
  width?: number | string;
  height?: number | string;
  variant?: BrandVariant;
  animated?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  ariaHidden?: boolean;
}

/**
 * LivePulse Signal Aperture Mark
 * Built on a 64x64 grid with reticle brackets, baseline segments,
 * and an asymmetric spike (26,32 -> 31,14 -> 40,32).
 */
export function BrandMark({
  size = 26,
  width,
  height,
  variant = "default",
  animated = false,
  className = "",
  style,
  ariaLabel,
  ariaHidden = true,
}: BrandMarkProps) {
  const [ink, spike] = VARIANT_COLORS[variant] || VARIANT_COLORS.default;
  const w = width ?? size;
  const h = height ?? size;

  if (animated) {
    return (
      <svg
        viewBox="-4 -4 72 72"
        width={w}
        height={h}
        xmlns="http://www.w3.org/2000/svg"
        className={`lp-mark-animated ${className}`.trim()}
        style={{ overflow: "visible", ...style }}
        aria-hidden={ariaHidden && !ariaLabel}
        aria-label={ariaLabel}
      >
        <path
          className="m-bracket"
          d="M8 24 V8 H24"
          fill="none"
          stroke={ink}
          strokeWidth="5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <path
          className="m-bracket"
          d="M56 40 V56 H40"
          fill="none"
          stroke={ink}
          strokeWidth="5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <path
          className="m-flat"
          d="M16 32 H48"
          fill="none"
          stroke={ink}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          className="m-seg"
          d="M16 32 H26"
          fill="none"
          stroke={ink}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          className="m-seg"
          d="M40 32 H48"
          fill="none"
          stroke={ink}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          className="m-spike"
          d="M26 32 L31 14 L40 32"
          fill="none"
          stroke={spike}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="m-dot" cx="16" cy="32" r="3" fill={spike} />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      width={w}
      height={h}
      xmlns="http://www.w3.org/2000/svg"
      className={`lp-mark-svg ${className}`.trim()}
      style={style}
      aria-hidden={ariaHidden && !ariaLabel}
      aria-label={ariaLabel}
    >
      <path
        d="M8 24 V8 H24"
        fill="none"
        stroke={ink}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M56 40 V56 H40"
        fill="none"
        stroke={ink}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path d="M16 32 H26" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M40 32 H48" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M26 32 L31 14 L40 32"
        fill="none"
        stroke={spike}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface BrandWordmarkProps {
  onDark?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * LivePulse Typographic Wordmark
 * Fraunces 400 for 'Live' and Fraunces 600 for 'Pulse'.
 */
export function BrandWordmark({ onDark = false, className = "", style }: BrandWordmarkProps) {
  return (
    <span
      className={`wordmark lp-brand-name ${onDark ? "on-dark" : ""} ${className}`.trim()}
      style={style}
    >
      <span className="wm-live">Live</span>
      <span className="wm-pulse">Pulse</span>
    </span>
  );
}

export interface BrandProps {
  to?: string | null;
  size?: number;
  variant?: BrandVariant;
  animated?: boolean;
  showWordmark?: boolean;
  onDark?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Primary LivePulse Lockup Component
 * Combines the Signal Aperture Mark with the Fraunces Wordmark.
 */
export function Brand({
  to = "/",
  size = 26,
  variant = "default",
  animated = false,
  showWordmark = true,
  onDark = false,
  className = "",
  style,
}: BrandProps) {
  const isDark = onDark || variant === "dark-surface" || variant === "mono-white";
  const markVariant = isDark && variant === "default" ? "dark-surface" : variant;

  const content = (
    <>
      <span
        className="mark-box"
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <BrandMark size={size} variant={markVariant} animated={animated} />
      </span>
      {showWordmark && <BrandWordmark onDark={isDark} />}
    </>
  );

  const containerClasses = `lockup lp-brand ${isDark ? "on-dark" : ""} ${className}`.trim();

  if (to) {
    return (
      <Link to={to} className={containerClasses} style={style} aria-label="LivePulse home">
        {content}
      </Link>
    );
  }

  return (
    <span className={containerClasses} style={style} aria-label="LivePulse">
      {content}
    </span>
  );
}
