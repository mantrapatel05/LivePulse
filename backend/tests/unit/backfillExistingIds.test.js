const { existingEventIds } = require("../../scripts/backfillClickhouse");

describe("existingEventIds", () => {
  it("queries a batch with bounded times, distinct projects, and all event ids", async () => {
    const ch = {
      query: jest.fn().mockResolvedValue({
        json: async () => [{ event_id: "mongo:a" }],
      }),
    };
    const rows = [
      { project_id: "p1", event_id: "mongo:a", occurred_at: "2026-01-01 12:00:00.000" },
      { project_id: "p1", event_id: "mongo:b", occurred_at: "2026-01-02 12:00:00.000" },
      { project_id: "p2", event_id: "mongo:c", occurred_at: "2026-01-03 12:00:00.000" },
    ];

    const result = await existingEventIds(ch, rows);

    expect(ch.query).toHaveBeenCalledTimes(1);
    const [{ query, query_params: params }] = ch.query.mock.calls[0];
    expect(query).toContain("event_id IN {ids:Array(String)}");
    expect(params.ids).toEqual(["mongo:a", "mongo:b", "mongo:c"]);
    expect(params.pids).toEqual(["p1", "p2"]);
    const rowTimes = rows.map((r) => Date.parse(r.occurred_at.replace(" ", "T") + "Z"));
    expect(Date.parse(params.minT.replace(" ", "T") + "Z")).toBeLessThanOrEqual(
      Math.min(...rowTimes) - 1000,
    );
    expect(Date.parse(params.maxT.replace(" ", "T") + "Z")).toBeGreaterThanOrEqual(
      Math.max(...rowTimes) + 1000,
    );
    expect(result).toEqual(new Set(["mongo:a"]));
  });
});
