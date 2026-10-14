const { pctDiff } = require("../../scripts/checkParity");

describe("pctDiff", () => {
  it("is 0 when both sides agree exactly", () => {
    expect(pctDiff(100, 100)).toBe(0);
    expect(pctDiff(0, 0)).toBe(0);
  });

  it("computes percentage difference relative to the larger value", () => {
    expect(pctDiff(100, 99)).toBeCloseTo(1, 5);
    expect(pctDiff(99, 100)).toBeCloseTo(1, 5);
  });

  it("a total mismatch (one side zero) is 100%", () => {
    expect(pctDiff(0, 50)).toBe(100);
    expect(pctDiff(50, 0)).toBe(100);
  });

  it("is symmetric", () => {
    expect(pctDiff(80, 120)).toBeCloseTo(pctDiff(120, 80), 5);
  });
});
