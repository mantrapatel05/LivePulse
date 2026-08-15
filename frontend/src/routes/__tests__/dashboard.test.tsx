import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../lib/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock("../../components/lp/ControlRoom", () => ({
  ControlRoom: ({ project }: { project: { name: string } }) => (
    <div data-testid="control-room">control room for {project.name}</div>
  ),
}));

vi.mock("../../components/lp/Brand", () => ({
  Brand: () => <div data-testid="brand">LivePulse</div>,
}));

import { useAuth } from "../../lib/auth";
import { createProject, listProjects } from "../../lib/api";
import { DashboardPage } from "../dashboard";

function authed(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: "u1", email: "founder@example.com" },
    loading: false,
    configured: true,
    signOut: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    session: null,
    ...overrides,
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /login when there is no signed-in user", async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: false,
      configured: true,
      signOut: vi.fn(),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      session: null,
    });

    render(<DashboardPage />);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/login", replace: true }));
  });

  it("does not redirect while the auth state is still loading", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: true,
      configured: true,
      signOut: vi.fn(),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      session: null,
    });

    render(<DashboardPage />);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows the first-project form when the signed-in user has no projects yet", async () => {
    authed();
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<DashboardPage />);

    expect(await screen.findByLabelText(/project name/i)).toBeInTheDocument();
  });

  it("creates a project and immediately shows the control room for it", async () => {
    authed();
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (createProject as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "p1",
      name: "Acme site",
      apiKey: "lp_abc123",
    });

    const user = userEvent.setup();
    render(<DashboardPage />);

    const input = await screen.findByLabelText(/project name/i);
    await user.type(input, "Acme site");
    await user.click(screen.getByRole("button", { name: /create project/i }));

    expect(await screen.findByTestId("control-room")).toHaveTextContent("Acme site");
    expect(createProject).toHaveBeenCalledWith("Acme site");
  });

  it("goes straight to the control room when projects already exist", async () => {
    authed();
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: "p1", name: "Existing project", apiKey: "lp_xyz" },
    ]);

    render(<DashboardPage />);

    expect(await screen.findByTestId("control-room")).toHaveTextContent("Existing project");
  });

  it("shows a retry option when the collector can't be reached", async () => {
    authed();
    (listProjects as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Can't reach the LivePulse collector"),
    );

    render(<DashboardPage />);

    expect(await screen.findByText(/can't reach the livepulse collector/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry connection/i })).toBeInTheDocument();
  });
});
