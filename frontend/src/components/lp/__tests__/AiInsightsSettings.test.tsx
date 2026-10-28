import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateAiInsights } = vi.hoisted(() => ({
  mockUpdateAiInsights: vi.fn(),
}));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    updateAiInsights: (...args: unknown[]) => mockUpdateAiInsights(...args),
  };
});

import { AiInsightsSettings } from "../AiInsightsSettings";

describe("AiInsightsSettings", () => {
  beforeEach(() => mockUpdateAiInsights.mockReset());

  it("shows privacy details and persists the user's opt-in", async () => {
    mockUpdateAiInsights.mockResolvedValue({
      _id: "project-1",
      aiInsights: { enabled: true },
    });
    render(
      <AiInsightsSettings
        project={{
          _id: "project-1",
          name: "Site",
          aiInsights: { enabled: false },
        }}
      />,
    );
    expect(screen.getByText(/No user IDs, IP addresses, chat messages/)).toBeTruthy();
    const toggle = screen.getByRole("checkbox", {
      name: "Enable AI session insights",
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(mockUpdateAiInsights).toHaveBeenCalledWith("project-1", true));
    expect(await screen.findByText("AI session insights enabled for this project.")).toBeTruthy();
  });
});
