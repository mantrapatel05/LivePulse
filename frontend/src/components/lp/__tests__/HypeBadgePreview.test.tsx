import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getBadgeStats: vi.fn(),
  updateBadge: vi.fn(),
}));

import { getBadgeStats, updateBadge } from "../../../lib/api";
import type { BadgeStats, LPProject } from "../../../lib/api";
import { HypeBadgePreview } from "../HypeBadgePreview";

const stats: BadgeStats = {
  publicId: "AbCdEfGhJkLm",
  badge: { enabled: false, minCount: 3 },
  today: { impressions: 321, landingHits: 12 },
  last7Days: [],
  referralProjects: 4,
};

const project: LPProject = {
  _id: "proj-1",
  name: "Acme",
  publicId: "AbCdEfGhJkLm",
  badge: { enabled: false, minCount: 3 },
};

describe("HypeBadgePreview", () => {
  beforeEach(() => {
    vi.mocked(getBadgeStats).mockResolvedValue(stats);
    vi.mocked(updateBadge).mockResolvedValue({ ...project, badge: { enabled: true, minCount: 3 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the backfill hint without controls when publicId is missing", () => {
    render(<HypeBadgePreview project={{ _id: "proj-1", name: "Acme" }} />);

    expect(screen.getByText(/no public id yet/i)).toBeInTheDocument();
    expect(screen.getByText(/npm run backfill:public-id/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /show badge/i })).not.toBeInTheDocument();
  });

  it("enables the badge and then shows its preview image", async () => {
    const user = userEvent.setup();
    render(<HypeBadgePreview project={project} />);
    const checkbox = screen.getByRole("checkbox", { name: /show badge/i });

    expect(screen.queryByAltText("LivePulse badge preview")).not.toBeInTheDocument();
    await user.click(checkbox);

    expect(updateBadge).toHaveBeenCalledWith("proj-1", { enabled: true });
    expect(await screen.findByAltText("LivePulse badge preview")).toHaveAttribute(
      "src",
      expect.stringContaining("/badge/AbCdEfGhJkLm.svg"),
    );
  });

  it("shows update errors and leaves the toggle unchanged", async () => {
    const user = userEvent.setup();
    vi.mocked(updateBadge).mockRejectedValue(new Error("settings rejected"));
    render(<HypeBadgePreview project={project} />);
    const checkbox = screen.getByRole("checkbox", { name: /show badge/i });
    await user.click(checkbox);

    expect(await screen.findByRole("alert")).toHaveTextContent("settings rejected");
    expect(checkbox).not.toBeChecked();
  });

  it("builds the HTML referral link and copies the selected snippet", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<HypeBadgePreview project={project} />);

    const snippet = await screen.findByText((content) =>
      content.includes(`${window.location.origin}/?ref=badge&p=${project.publicId}`),
    );
    const text = snippet.textContent ?? "";
    await user.click(screen.getByRole("button", { name: /copy snippet/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
  });

  it("renders the badge funnel stats", async () => {
    render(<HypeBadgePreview project={project} />);

    await waitFor(() => {
      expect(screen.getByText("321")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });
  });
});
