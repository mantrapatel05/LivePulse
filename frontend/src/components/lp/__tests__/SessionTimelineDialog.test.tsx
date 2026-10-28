import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../lib/api";

const { mockExplainSession, mockSessionTimeline } = vi.hoisted(() => ({
  mockExplainSession: vi.fn(),
  mockSessionTimeline: vi.fn(),
}));

vi.mock("../../../lib/apiV2", () => ({
  analyticsV2: () => ({
    explainSession: mockExplainSession,
    sessionTimeline: mockSessionTimeline,
  }),
}));

import { SessionTimelineDialog } from "../SessionTimelineDialog";

const timeline = {
  sessionId: "session-1",
  startedAt: "2026-10-25T10:00:00.000Z",
  lastSeenAt: "2026-10-25T10:00:30.000Z",
  eventCount: 2,
  errorCount: 1,
  entryUrl: "https://site.test/start",
  exitUrl: "https://site.test/checkout",
  engagedSeconds: 12,
  events: [
    {
      event_id: "event-real-1",
      event_type: "page_view",
      url: "https://site.test/start",
      element: null,
      properties: "{}",
      occurred_at: "2026-10-25 10:00:00",
    },
    {
      event_id: "event-real-2",
      event_type: "error",
      url: "https://site.test/checkout",
      element: null,
      properties: "{}",
      occurred_at: "2026-10-25 10:00:30",
    },
  ],
};

const insightResult = {
  insight: {
    headline: "Checkout failed after a product visit",
    narrative: "The session reached checkout before an error.",
    outcome: "frustrated",
    friction: [
      {
        kind: "error",
        note: "Checkout raised an error.",
        evidenceIds: ["event-real-2"],
        eventIds: ["event-real-2"],
      },
    ],
    suggestedActions: ["Inspect the checkout error."],
  },
  cached: false,
  model: "test-model",
  generatedAt: "2026-10-25T10:01:00.000Z",
};

function setup() {
  return render(
    <SessionTimelineDialog projectId="project-1" sessionId="session-1" onClose={vi.fn()} />,
  );
}

describe("SessionTimelineDialog AI insight", () => {
  beforeEach(() => {
    mockExplainSession.mockReset();
    mockSessionTimeline.mockReset().mockResolvedValue({ data: timeline });
  });

  it("renders the insight and highlights the matching timeline event when evidence is selected", async () => {
    mockExplainSession.mockResolvedValue({ data: insightResult });
    setup();
    await screen.findByText("https://site.test/checkout");
    fireEvent.click(screen.getByRole("button", { name: "explain session" }));
    expect(await screen.findByText(insightResult.insight.headline)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "event event-re" }));
    await waitFor(() =>
      expect(document.getElementById("lp-event-event-real-2")?.className).toContain("is-evidence"),
    );
    expect(screen.getByText("AI-generated. Verify against the timeline.")).toBeTruthy();
  });

  it("explains how to enable AI when the project is opted out", async () => {
    mockExplainSession.mockRejectedValue(new ApiError("disabled", 403));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "explain session" }));
    expect(await screen.findByText(/Enable them in the project's Install settings/)).toBeTruthy();
  });

  it("shows a retry time for 429 responses", async () => {
    mockExplainSession.mockRejectedValue(new ApiError("limited", 429, 23));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "explain session" }));
    expect(await screen.findByText("Rate limit reached. Try again in 23 seconds.")).toBeTruthy();
  });

  it("labels deterministic fallback output when the model is unavailable", async () => {
    mockExplainSession.mockResolvedValue({
      data: { ...insightResult, degraded: true },
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "explain session" }));
    expect(await screen.findByText("basic summary · AI unavailable")).toBeTruthy();
  });
});
