const { evaluateCutoverGate } = require("../../scripts/setAnalyticsBackend");

const NOW = new Date("2026-10-20T10:00:00Z");
const cp = { processedCount: 100 };
const run = (day, ok = true, n = 50) => ({ day, withinThreshold: ok, report: { total: { mongo: n } } });
const week = [
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
  "2026-10-19",
  "2026-10-20",
].map((day) => run(day));
const g = (options) =>
  evaluateCutoverGate({ from: "dual", to: "clickhouse", runs: week, checkpoint: cp, now: NOW, ...options });

describe("evaluateCutoverGate", () => {
  it("blocks mongo -> clickhouse", () =>
    expect(
      evaluateCutoverGate({ from: "mongo", to: "clickhouse", runs: week, checkpoint: cp, now: NOW })[0],
    ).toMatch(/not allowed/));

  it("allows dual -> clickhouse after 7 clean consecutive days + backfill", () =>
    expect(g({})).toEqual([]));

  it("blocks without a backfill checkpoint", () => expect(g({ checkpoint: null }).join()).toMatch(/backfill/));

  it("blocks with fewer than 7 runs", () => expect(g({ runs: week.slice(2) }).join()).toMatch(/need 7/));

  it("blocks on a dirty day", () =>
    expect(g({ runs: week.map((r, i) => (i === 3 ? run(r.day, false) : r)) }).join()).toMatch(/out of threshold/));

  it("blocks on a gap", () =>
    expect(
      g({ runs: week.filter((r) => r.day !== "2026-10-17").concat(run("2026-10-10")) }).join(),
    ).toMatch(/gap/));

  it("blocks stale data", () =>
    expect(g({ now: new Date("2026-10-25T00:00:00Z") }).join()).toMatch(/stale/));

  it("rejects all-empty runs", () =>
    expect(g({ runs: week.map((r) => run(r.day, true, 0)) }).join()).toMatch(/zero events/));

  it("allows rollback clickhouse -> dual", () =>
    expect(evaluateCutoverGate({ from: "clickhouse", to: "dual", runs: [], checkpoint: cp, now: NOW })).toEqual(
      [],
    ));
});
