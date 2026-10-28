import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EngagementDrift } from "../../../lib/apiV2";
import { EngagementPanel } from "../EngagementPanel";

const drift = (status: EngagementDrift["status"]): EngagementDrift => ({
  status,
  summary: "Sessions down 25% vs the previous 7 days.",
  cached: false,
  metrics: [
    { name: "sessions", cur: 75, prev: 100, deltaPct: -25 },
    { name: "error_rate", cur: 1, prev: 0.5, deltaPct: 100 },
  ],
  topDecliners: [{ path: "/checkout", cur: 10, prev: 100, deltaPct: -90 }],
});

describe("EngagementPanel", () => {
  it.each([
    ["ok", "steady"],
    ["watch", "watch"],
    ["drop", "dropping"],
  ] as const)("renders the %s status and metric/page deltas", (status, label) => {
    render(<EngagementPanel drift={drift(status)} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Sessions down 25% vs the previous 7 days.")).toBeTruthy();
    expect(screen.getByText("sessions")).toBeTruthy();
    expect(screen.getByText("/checkout")).toBeTruthy();
  });

  it("explains the sample minimum when data is insufficient", () => {
    render(
      <EngagementPanel
        drift={{
          ...drift("insufficient_data"),
          status: "insufficient_data",
          metrics: [],
          topDecliners: [],
          summary: "Not enough data yet: need at least 30 sessions in the prior 7 days (found 4).",
        }}
      />,
    );
    expect(screen.getByText("not enough data")).toBeTruthy();
    expect(screen.getByText(/at least the configured minimum number of sessions/)).toBeTruthy();
    expect(screen.getByText(/found 4/)).toBeTruthy();
  });

  it("shows an API error instead of leaving the panel loading", () => {
    render(<EngagementPanel drift={undefined} error="ClickHouse is unavailable" />);
    expect(screen.getByText("ClickHouse is unavailable")).toBeTruthy();
  });
});
