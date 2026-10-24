const KEY = "lp_referral";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ID_RE = /^[1-9A-HJ-NP-Za-km-z]{12}$/;

/** Reads ?ref=badge&p=<publicId>; stores it (last touch wins) with a 30-day expiry. Returns the id or null. */
export function captureReferralFromUrl(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): string | null {
  const q = new URLSearchParams(search);
  const p = q.get("p");
  if (q.get("ref") !== "badge" || !p || !ID_RE.test(p)) return null;
  try {
    localStorage.setItem(KEY, JSON.stringify({ p, exp: Date.now() + TTL_MS }));
  } catch {
    /* storage blocked: attribution is best effort */
  }
  return p;
}

export function peekReferral(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { p, exp } = JSON.parse(raw) as { p?: unknown; exp?: unknown };
    if (typeof p !== "string" || !ID_RE.test(p) || typeof exp !== "number" || exp < Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
