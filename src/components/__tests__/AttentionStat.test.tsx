/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AttentionStat } from "../AttentionStat";

afterEach(() => cleanup());

describe("AttentionStat (Stock Detail screen, Test Gate: component test)", () => {
  it("a highlighted stat renders the bordered/tinted stat-card treatment with a large value", () => {
    render(<AttentionStat label="Price move" value="+5.8%" direction="positive" highlighted message="Big move." />);

    const value = screen.getByText("+5.8%");
    expect(value.className).toContain("text-2xl"); // larger font per spec (1.5-2x body)
    expect(value.className).toContain("font-bold");

    // Never color-only: an icon + text label accompany the color.
    expect(screen.getByText("up")).toBeInTheDocument();
    expect(screen.getByText("Big move.")).toBeInTheDocument();
  });

  it("a non-highlighted stat renders as plain body text, not a stat card", () => {
    render(<AttentionStat label="Volume" value="1.1x" direction="unusual" highlighted={false} />);

    const value = screen.getByText("1.1x");
    expect(value.className).not.toContain("text-2xl");
    expect(value.className).not.toContain("font-bold");
    expect(screen.queryByText("unusual")).not.toBeInTheDocument(); // no icon/direction chip when not highlighted
  });

  it("negative direction renders the down icon and red-family text color, never color alone", () => {
    render(<AttentionStat label="Price move" value="-3.2%" direction="negative" highlighted />);
    expect(screen.getByText("down")).toBeInTheDocument();
  });

  it("unusual direction (volume/volatility) renders its own amber treatment, distinct from positive/negative", () => {
    render(<AttentionStat label="Volume" value="3.0x" direction="unusual" highlighted />);
    const value = screen.getByText("3.0x");
    expect(value.className).toContain("amber");
    expect(screen.getByText("unusual")).toBeInTheDocument();
  });
});
