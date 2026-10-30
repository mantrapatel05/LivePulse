import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../lib/api";

const { mockAsk } = vi.hoisted(() => ({ mockAsk: vi.fn() }));
vi.mock("../../../lib/apiV2", () => ({ analyticsV2: () => ({ ask: mockAsk }) }));

import { AskPanel } from "../AskPanel";

const success = {
  status: "ok" as const,
  interpreted: "sessions, grouped by page, where device = mobile, last 7 days",
  spec: {
    metric: "sessions",
    groupBy: "url_path",
    filters: [],
    range: "last_7d",
    orderBy: "value_desc",
    limit: 10,
  },
  columns: [
    { key: "label", label: "page", type: "text" as const },
    { key: "value", label: "sessions", type: "number" as const },
  ],
  rows: [
    { label: "/pricing", value: 5 },
    { label: "/", value: 3 },
  ],
  truncated: false,
  cached: false,
};

function submit(question: string) {
  render(<AskPanel projectId="p1" />);
  fireEvent.change(screen.getByLabelText("Ask a question about your analytics"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "ask" }));
}

describe("AskPanel", () => {
  beforeEach(() => mockAsk.mockReset());

  it("renders the interpretation and grouped results", async () => {
    mockAsk.mockResolvedValue({ data: success });
    submit("sessions by page on mobile");
    expect(await screen.findByText(success.interpreted)).toBeTruthy();
    expect(screen.getByText("/pricing")).toBeTruthy();
    expect(mockAsk).toHaveBeenCalledWith("sessions by page on mobile");
  });

  it("explains disabled and rate-limited responses", async () => {
    mockAsk.mockRejectedValueOnce(new ApiError("disabled", 403));
    submit("anything");
    expect(await screen.findByText(/AI features are off/)).toBeTruthy();
    mockAsk.mockRejectedValueOnce(new ApiError("limited", 429, 23));
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(await screen.findByText("Rate limit reached. Try again in 23 seconds.")).toBeTruthy();
  });

  it("renders an unsupported question message", async () => {
    mockAsk.mockResolvedValue({
      data: { status: "unsupported", message: "I can only read analytics." },
    });
    submit("delete everything");
    expect(await screen.findByText("I can only read analytics.")).toBeTruthy();
  });
});
