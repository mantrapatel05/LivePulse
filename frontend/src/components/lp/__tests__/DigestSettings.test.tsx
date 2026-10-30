import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateDigest } = vi.hoisted(() => ({ mockUpdateDigest: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  updateDigest: (...args: unknown[]) => mockUpdateDigest(...args),
}));

import { DigestSettings } from "../DigestSettings";

describe("DigestSettings", () => {
  beforeEach(() => mockUpdateDigest.mockReset());

  it("persists the opt-in", async () => {
    mockUpdateDigest.mockResolvedValue({ _id: "p1", digest: { enabled: true } });
    render(<DigestSettings project={{ _id: "p1", name: "Site", analyticsBackend: "clickhouse", digest: { enabled: false } }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable weekly digest" }));
    await waitFor(() => expect(mockUpdateDigest).toHaveBeenCalledWith("p1", true));
    expect(await screen.findByText("Weekly digest enabled.")).toBeTruthy();
  });

  it("is disabled for projects not on ClickHouse", () => {
    render(<DigestSettings project={{ _id: "p1", name: "Site", analyticsBackend: "dual" }} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
});
