import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  livepulseApi: vi.fn(),
}));
vi.mock("../../../lib/socket", () => ({
  getDashboardSocket: vi.fn(),
}));

import { livepulseApi } from "../../../lib/api";
import { getDashboardSocket } from "../../../lib/socket";
import { ChatDock } from "../ChatDock";

function makeFakeSocket() {
  const handlers: Record<string, Array<(payload: unknown) => void>> = {};
  return {
    on: vi.fn((event: string, cb: (payload: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
    }),
    off: vi.fn((event: string, cb: (payload: unknown) => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb);
    }),
    emit: vi.fn(),
    __trigger(event: string, payload: unknown) {
      (handlers[event] ?? []).forEach((h) => h(payload));
    },
  };
}

describe("ChatDock", () => {
  let socket: ReturnType<typeof makeFakeSocket>;
  let chatHistory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    socket = makeFakeSocket();
    (getDashboardSocket as unknown as ReturnType<typeof vi.fn>).mockReturnValue(socket);
    chatHistory = vi.fn().mockResolvedValue({ messages: [] });
    (livepulseApi as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ chatHistory });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prompts to pick a session when none is selected", () => {
    render(<ChatDock projectId="p1" sessionId={null} />);
    expect(screen.getByText(/select a live session/i)).toBeInTheDocument();
  });

  it("loads and renders chat history for the selected session", async () => {
    chatHistory.mockResolvedValue({
      messages: [
        { sender: "founder", message: "hey there", timestamp: new Date().toISOString() },
        { sender: "user", message: "hi!", timestamp: new Date().toISOString() },
      ],
    });

    render(<ChatDock projectId="p1" sessionId="sess-1" />);

    expect(await screen.findByText("hey there")).toBeInTheDocument();
    expect(screen.getByText("hi!")).toBeInTheDocument();
    expect(chatHistory).toHaveBeenCalledWith("sess-1");
  });

  it("optimistically appends and emits send_chat when the founder sends a message", async () => {
    const user = userEvent.setup();
    render(<ChatDock projectId="p1" sessionId="sess-1" />);
    await waitFor(() => expect(chatHistory).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/reply to/i);
    await user.type(input, "need a hand?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("need a hand?")).toBeInTheDocument();
    expect(socket.emit).toHaveBeenCalledWith(
      "send_chat",
      { projectId: "p1", sessionId: "sess-1", message: "need a hand?" },
      expect.any(Function),
    );
  });

  it("renders a visitor's user_reply the instant the socket delivers it", async () => {
    render(<ChatDock projectId="p1" sessionId="sess-1" />);
    await waitFor(() => expect(chatHistory).toHaveBeenCalled());

    act(() => {
      socket.__trigger("user_reply", {
        sessionId: "sess-1",
        message: "yes please",
        timestamp: new Date().toISOString(),
      });
    });

    expect(await screen.findByText("yes please")).toBeInTheDocument();
  });

  it("ignores user_reply events for a different session", async () => {
    render(<ChatDock projectId="p1" sessionId="sess-1" />);
    await waitFor(() => expect(chatHistory).toHaveBeenCalled());

    act(() => {
      socket.__trigger("user_reply", { sessionId: "some-other-session", message: "not for us" });
    });

    await waitFor(() => {
      expect(screen.queryByText("not for us")).not.toBeInTheDocument();
    });
  });

  it("clears messages and re-fetches history when switching sessions", async () => {
    const { rerender } = render(<ChatDock projectId="p1" sessionId="sess-1" />);
    await waitFor(() => expect(chatHistory).toHaveBeenCalledWith("sess-1"));

    rerender(<ChatDock projectId="p1" sessionId="sess-2" />);
    await waitFor(() => expect(chatHistory).toHaveBeenCalledWith("sess-2"));
  });
});
