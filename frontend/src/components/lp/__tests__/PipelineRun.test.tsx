import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineRun } from "../PipelineRun";
import { PIPELINE_TIMELINES } from "../pipelineTimeline";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        queueMicrotask(() =>
          this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        );
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PipelineRun", () => {
  it("renders all pipeline destinations and three accessible scene choices", () => {
    render(<PipelineRun />);

    expect(screen.getByText("SDK")).toBeInTheDocument();
    expect(screen.getByText("Collector")).toBeInTheDocument();
    expect(screen.getByText("Socket.IO")).toBeInTheDocument();
    expect(screen.getByText("Redis Streams")).toBeInTheDocument();
    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText("ClickHouse")).toBeInTheDocument();
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("shows the dead-letter tray only for the dead-letter scene", () => {
    render(<PipelineRun />);
    expect(screen.queryByText("events:v2:dead")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Dead letter" }));
    expect(screen.getByText("events:v2:dead")).toBeInTheDocument();
    expect(screen.getByText("5 retries → dead-letter policy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Happy path" }));
    expect(screen.queryByText("events:v2:dead")).not.toBeInTheDocument();
    expect(screen.getByText("at-least-once · durable path")).toBeInTheDocument();
  });

  it("keeps the packet static when reduced motion is requested", () => {
    const { container } = render(<PipelineRun />);
    expect(container.querySelector(".heartbeat-run")).toHaveClass("is-reduced");
    expect(container.querySelector(".heartbeat-packet")).not.toHaveClass("is-visible");
  });

  it("keeps each scene timeline in increasing time order", () => {
    for (const timeline of Object.values(PIPELINE_TIMELINES)) {
      expect(timeline.map(({ at }) => at)).toEqual(
        [...timeline.map(({ at }) => at)].sort((left, right) => left - right),
      );
    }
  });
});
