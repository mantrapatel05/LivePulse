const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deltaPct(current, previous) {
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

function round1(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

function computeDrift({ cur = {}, prev = {}, pages = [] } = {}) {
  const minSessions = Math.max(0, Math.floor(envNumber("ENGAGEMENT_MIN_PREV_SESSIONS", 30)));
  const minPageViews = Math.max(0, Math.floor(envNumber("ENGAGEMENT_MIN_PAGE_VIEWS", 20)));
  const watchPct = envNumber("ENGAGEMENT_WATCH_PCT", -20);
  const dropPct = envNumber("ENGAGEMENT_DROP_PCT", -40);

  const current = {
    sessions: number(cur.sessions),
    events: number(cur.events),
    errors: number(cur.errors),
    rageClicks: number(cur.rage_clicks),
    engagedSeconds: number(cur.avg_engaged_seconds),
  };
  const previous = {
    sessions: number(prev.sessions),
    events: number(prev.events),
    errors: number(prev.errors),
    rageClicks: number(prev.rage_clicks),
    engagedSeconds: number(prev.avg_engaged_seconds),
  };

  if (previous.sessions < minSessions) {
    return {
      status: "insufficient_data",
      metrics: [],
      topDecliners: [],
      summary: `Not enough data yet: need at least ${minSessions} sessions in the prior 7 days (found ${previous.sessions}).`,
    };
  }

  const metrics = [
    {
      name: "sessions",
      cur: current.sessions,
      prev: previous.sessions,
      deltaPct: round1(deltaPct(current.sessions, previous.sessions)),
    },
    {
      name: "events",
      cur: current.events,
      prev: previous.events,
      deltaPct: round1(deltaPct(current.events, previous.events)),
    },
    {
      name: "avg_engaged_seconds",
      cur: current.engagedSeconds,
      prev: previous.engagedSeconds,
      deltaPct: round1(deltaPct(current.engagedSeconds, previous.engagedSeconds)),
    },
    {
      name: "rage_clicks",
      cur: current.rageClicks,
      prev: previous.rageClicks,
      deltaPct: round1(deltaPct(current.rageClicks, previous.rageClicks)),
    },
  ];

  const currentErrorRate = current.events > 0 ? current.errors / current.events : 0;
  const previousErrorRate = previous.events > 0 ? previous.errors / previous.events : 0;
  const errorRateDelta = deltaPct(currentErrorRate, previousErrorRate);
  metrics.push({
    name: "error_rate",
    cur: Math.round(currentErrorRate * 10000) / 100,
    prev: Math.round(previousErrorRate * 10000) / 100,
    deltaPct: round1(errorRateDelta),
  });

  const topDecliners = pages
    .map((page) => ({
      path: String(page.path ?? ""),
      cur: number(page.cur),
      prev: number(page.prev),
    }))
    .filter((page) => page.prev >= minPageViews)
    .map((page) => ({ ...page, deltaPct: round1(deltaPct(page.cur, page.prev)) }))
    .filter((page) => page.deltaPct !== null && page.deltaPct < 0)
    .sort((left, right) => left.deltaPct - right.deltaPct)
    .slice(0, 5);

  const sessionsDelta = deltaPct(current.sessions, previous.sessions);
  let status = "ok";
  if (sessionsDelta !== null && sessionsDelta <= dropPct) status = "drop";
  else if (
    (sessionsDelta !== null && sessionsDelta <= watchPct) ||
    (errorRateDelta !== null && errorRateDelta > 50)
  ) {
    status = "watch";
  }

  let summary = "Engagement is steady vs the previous 7 days.";
  if (status === "drop" || (status === "watch" && sessionsDelta !== null && sessionsDelta <= watchPct)) {
    summary = `Sessions down ${Math.abs(round1(sessionsDelta))}% vs the previous 7 days.`;
  } else if (status === "watch") {
    summary = `Error rate up ${round1(errorRateDelta)}% vs the previous 7 days.`;
  }
  if (topDecliners.length > 0 && status !== "ok") {
    const biggest = topDecliners[0];
    summary += ` Biggest drop: ${biggest.path || "/"} (${biggest.deltaPct}%).`;
  }

  return { status, metrics, topDecliners, summary };
}

module.exports = { computeDrift, deltaPct };
