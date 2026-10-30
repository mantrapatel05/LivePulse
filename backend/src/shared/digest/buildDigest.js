const { clean } = require("../insights/buildSessionDigest");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ESC[char]);
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const fmtDelta = (value) => (value == null ? "n/a" : `${value > 0 ? "+" : ""}${value}%`);

const STATUS_PHRASE = {
  ok: "engagement is steady",
  watch: "worth a look",
  drop: "engagement is dropping",
  insufficient_data: "your weekly summary",
};
const METRIC_LABEL = {
  sessions: "Sessions",
  events: "Events",
  avg_engaged_seconds: "Avg engaged (s)",
  rage_clicks: "Rage clicks",
  error_rate: "Error rate (%)",
};

function allowlist(data) {
  const numbers = new Set(["7"]);
  const paths = new Set();
  const add = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return;
    numbers.add(String(Number(value)));
    numbers.add(String(Math.abs(Number(value))));
  };
  (data.drift.metrics || []).forEach((metric) => {
    add(metric.cur); add(metric.prev); add(metric.deltaPct);
  });
  (data.drift.topDecliners || []).forEach((page) => {
    paths.add(page.path); add(page.cur); add(page.prev); add(page.deltaPct);
  });
  data.pages.forEach((page) => { paths.add(page.path); add(page.views); add(page.sessions); });
  data.clusters.forEach((cluster) => { add(cluster.occurrences); add(cluster.affectedSessions); });
  return { numbers, paths };
}

function groundingOk(text, data) {
  const { numbers, paths } = allowlist(data);
  for (const found of text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []) {
    if (!numbers.has(String(Number(found.replace(/,/g, ""))))) return false;
  }
  for (const found of text.matchAll(/(?:^|[\s("'])(\/[\w\-./%]*)/g)) {
    if (!paths.has(found[1].replace(/[.,;:)]+$/, ""))) return false;
  }
  return true;
}

function buildData({ drift, pages, clusters }) {
  return {
    drift: {
      status: drift.status,
      summary: clean(drift.summary, 300),
      metrics: drift.metrics || [],
      topDecliners: (drift.topDecliners || []).map((page) => ({ ...page, path: clean(page.path, 80) })),
    },
    pages: (pages || []).slice(0, 5).map((page) => ({
      path: clean(page.path || "/", 80), views: number(page.views), sessions: number(page.sessions),
    })),
    clusters: (clusters || []).map((cluster) => ({
      message: clean(cluster.message || cluster.signature, 140),
      occurrences: number(cluster.occurrences),
      affectedSessions: number(cluster.affected_sessions),
    })).sort((a, b) => b.occurrences - a.occurrences).slice(0, 3),
  };
}

function buildDigest({ projectName, week, range, drift, pages, clusters, aiParagraph = null, unsubscribeUrl }) {
  const data = buildData({ drift, pages, clusters });
  const name = clean(projectName, 60) || "Your project";
  const subject = `${name}: ${STATUS_PHRASE[data.drift.status] || "weekly summary"}`;
  const unsub = /^https?:\/\//.test(unsubscribeUrl || "") ? unsubscribeUrl : null;
  const period = `${range.from} to ${range.to}`;

  const text = [`${name} — week ${week} (${period})`, "", data.drift.summary, ""];
  if (data.drift.metrics.length) {
    text.push("Changes vs previous 7 days:");
    data.drift.metrics.forEach((metric) => text.push(
      `  ${METRIC_LABEL[metric.name] || clean(metric.name, 60)}: ${metric.cur} (was ${metric.prev}, ${fmtDelta(metric.deltaPct)})`,
    ));
    text.push("");
  }
  if (data.pages.length) {
    text.push("Top pages:");
    data.pages.forEach((page) => text.push(`  ${page.path} — ${page.views} views, ${page.sessions} sessions`));
    text.push("");
  }
  if (data.clusters.length) {
    text.push("Top errors:");
    data.clusters.forEach((cluster) => text.push(
      `  ${cluster.message} — x${cluster.occurrences}, ${cluster.affectedSessions} sessions`,
    ));
    text.push("");
  }
  if (aiParagraph) text.push("What to fix (AI-generated, based only on the numbers above):", aiParagraph, "");
  if (unsub) text.push(`Unsubscribe: ${unsub}`);

  const row = (left, right) => `<tr><td style="padding:4px 12px 4px 0">${esc(left)}</td><td style="padding:4px 0;color:#555">${esc(right)}</td></tr>`;
  const html = [
    `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.5">`,
    `<h2 style="margin:0 0 4px">${esc(name)}</h2>`,
    `<div style="color:#777;font-size:12px">Week ${esc(week)} · ${esc(period)}</div>`,
    `<p>${esc(data.drift.summary)}</p>`,
  ];
  if (data.drift.metrics.length) {
    html.push("<h3>Vs previous 7 days</h3><table>");
    data.drift.metrics.forEach((metric) => html.push(row(
      METRIC_LABEL[metric.name] || clean(metric.name, 60),
      `${metric.cur} (was ${metric.prev}, ${fmtDelta(metric.deltaPct)})`,
    )));
    html.push("</table>");
  }
  if (data.pages.length) {
    html.push("<h3>Top pages</h3><table>");
    data.pages.forEach((page) => html.push(row(page.path, `${page.views} views · ${page.sessions} sessions`)));
    html.push("</table>");
  }
  if (data.clusters.length) {
    html.push("<h3>Top errors</h3><table>");
    data.clusters.forEach((cluster) => html.push(row(
      cluster.message, `x${cluster.occurrences} · ${cluster.affectedSessions} sessions`,
    )));
    html.push("</table>");
  }
  if (aiParagraph) {
    html.push(`<h3>What to fix</h3><p>${esc(aiParagraph)}</p><div style="color:#777;font-size:11px">AI-generated from the numbers above. Verify in your dashboard.</div>`);
  }
  if (unsub) html.push(`<hr style="margin-top:24px;border:0;border-top:1px solid #ddd"/><p style="font-size:11px;color:#777"><a href="${esc(unsub)}">Unsubscribe</a></p>`);
  html.push("</div>");
  return { subject, text: text.join("\n"), html: html.join(""), data };
}

module.exports = { buildDigest, buildData, groundingOk, allowlist, esc };
