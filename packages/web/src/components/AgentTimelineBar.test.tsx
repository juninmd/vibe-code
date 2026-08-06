import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentTimelineBar, type TimelineSegment } from "./AgentTimelineBar";

describe("AgentTimelineBar", () => {
  it("renders null when no segments", () => {
    const { container } = render(
      <AgentTimelineBar segments={[]} activeId={null} onSegmentClick={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one button per segment", () => {
    const segments: TimelineSegment[] = [
      {
        id: 1,
        toolName: "Tool A",
        toolIcon: "A",
        accentColor: "#aaa",
        logCount: 2,
        hasError: false,
      },
      {
        id: 2,
        toolName: "Tool B",
        toolIcon: "B",
        accentColor: "#bbb",
        logCount: 3,
        hasError: false,
      },
    ];
    render(<AgentTimelineBar segments={segments} activeId={null} onSegmentClick={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("invokes onSegmentClick with segment id", () => {
    const fn = vi.fn();
    const segments: TimelineSegment[] = [
      {
        id: 1,
        toolName: "Tool A",
        toolIcon: "A",
        accentColor: "#aaa",
        logCount: 2,
        hasError: false,
      },
    ];
    render(<AgentTimelineBar segments={segments} activeId={null} onSegmentClick={fn} />);
    fireEvent.click(screen.getByRole("button"));
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("renders error segments with red tint", () => {
    const segments: TimelineSegment[] = [
      {
        id: 1,
        toolName: "Tool A",
        toolIcon: "A",
        accentColor: "#aaa",
        logCount: 2,
        hasError: true,
      },
    ];
    render(<AgentTimelineBar segments={segments} activeId={null} onSegmentClick={() => {}} />);
    const btn = screen.getByRole("button");
    // #f87171 is the color
    expect(btn.style.backgroundColor).toBe("rgb(248, 113, 113)");
  });

  it("uses minimum width for tiny segments", () => {
    const segments: TimelineSegment[] = [
      {
        id: 1,
        toolName: "Tool A",
        toolIcon: "A",
        accentColor: "#aaa",
        logCount: 1,
        hasError: false,
      },
      {
        id: 2,
        toolName: "Tool B",
        toolIcon: "B",
        accentColor: "#bbb",
        logCount: 999999,
        hasError: false,
      },
    ];
    render(<AgentTimelineBar segments={segments} activeId={null} onSegmentClick={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].style.width).toBe("1.2%");
  });
});
