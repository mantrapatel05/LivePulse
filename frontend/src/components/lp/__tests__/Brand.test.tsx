import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Brand, BrandMark, BrandWordmark } from "../Brand";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={to} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

describe("BrandMark", () => {
  it("renders the static Signal Aperture mark with viewBox 0 0 64 64", () => {
    const { container } = render(<BrandMark size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");

    // 5 paths in static mark: 2 brackets, 2 baseline segments, 1 asymmetric spike
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(5);

    // Verify asymmetric spike path: M26 32 L31 14 L40 32
    const spikePath = Array.from(paths).find((p) => p.getAttribute("d") === "M26 32 L31 14 L40 32");
    expect(spikePath).toBeTruthy();
    expect(spikePath?.getAttribute("stroke")).toBe("#FF2D2D");

    // Verify bracket paths
    const bracket1 = Array.from(paths).find((p) => p.getAttribute("d") === "M8 24 V8 H24");
    const bracket2 = Array.from(paths).find((p) => p.getAttribute("d") === "M56 40 V56 H40");
    expect(bracket1?.getAttribute("stroke")).toBe("#0A0A0A");
    expect(bracket2?.getAttribute("stroke")).toBe("#0A0A0A");
  });

  it("renders the animated aperture mark when animated=true", () => {
    const { container } = render(<BrandMark size={48} animated />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("-4 -4 72 72");

    // Check motion classes
    expect(container.querySelectorAll(".m-bracket").length).toBe(2);
    expect(container.querySelector(".m-flat")).toBeTruthy();
    expect(container.querySelectorAll(".m-seg").length).toBe(2);
    expect(container.querySelector(".m-spike")).toBeTruthy();
    expect(container.querySelector(".m-dot")).toBeTruthy();
  });

  it("supports all brand colour variants", () => {
    // mono-black
    const { container: c1 } = render(<BrandMark variant="mono-black" />);
    const paths1 = c1.querySelectorAll("path");
    paths1.forEach((p) => expect(p.getAttribute("stroke")).toBe("#0A0A0A"));

    // mono-white
    const { container: c2 } = render(<BrandMark variant="mono-white" />);
    const paths2 = c2.querySelectorAll("path");
    paths2.forEach((p) => expect(p.getAttribute("stroke")).toBe("#EFEAE0"));

    // red
    const { container: c3 } = render(<BrandMark variant="red" />);
    const paths3 = c3.querySelectorAll("path");
    paths3.forEach((p) => expect(p.getAttribute("stroke")).toBe("#FF2D2D"));

    // dark-surface
    const { container: c4 } = render(<BrandMark variant="dark-surface" />);
    const spike4 = Array.from(c4.querySelectorAll("path")).find(
      (p) => p.getAttribute("d") === "M26 32 L31 14 L40 32",
    );
    const bracket4 = Array.from(c4.querySelectorAll("path")).find(
      (p) => p.getAttribute("d") === "M8 24 V8 H24",
    );
    expect(spike4?.getAttribute("stroke")).toBe("#FF2D2D");
    expect(bracket4?.getAttribute("stroke")).toBe("#EFEAE0");
  });
});

describe("BrandWordmark", () => {
  it("renders Live in weight 400 and Pulse in weight 600 classes", () => {
    const { container } = render(<BrandWordmark />);
    const live = container.querySelector(".wm-live");
    const pulse = container.querySelector(".wm-pulse");
    expect(live?.textContent).toBe("Live");
    expect(pulse?.textContent).toBe("Pulse");
  });

  it("applies on-dark class when onDark is true", () => {
    const { container } = render(<BrandWordmark onDark />);
    expect(container.querySelector(".on-dark")).toBeTruthy();
  });
});

describe("Brand Lockup", () => {
  it("renders full lockup with mark and wordmark inside a link", () => {
    render(<Brand to="/" />);
    const link = screen.getByRole("link", { name: /LivePulse home/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/");
    expect(link.textContent).toContain("Live");
    expect(link.textContent).toContain("Pulse");
    expect(link.querySelector("svg")).toBeTruthy();
  });

  it("renders span container when to is null", () => {
    const { container } = render(<Brand to={null} />);
    expect(container.querySelector("a")).toBeNull();
    const span = container.querySelector(".lockup");
    expect(span).toBeTruthy();
  });
});
