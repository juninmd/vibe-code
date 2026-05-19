import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentTimelineBar, type TimelineSegment } from "./AgentTimelineBar";

const segs: TimelineSegment[] = [
  {
    id: 1,
    toolName: "Reading file",
    toolIcon: "📖",
    accentColor: "#a78bfa",
    logCount: 5,
    hasError: false,
  },
  {
    id: 2,
    toolName: "Running command",
    toolIcon: "💻",
    accentColor: "#22d3ee",
    logCount: 12,
    hasError: false,
  },
  { id: 3, toolName: "Edit", toolIcon: "✏️", accentColor: "#a78bfa", logCount: 2, hasError: true },
];

describe("AgentTimelineBar", () => {
  it("renders one button per segment", () => {
    const { container } = render(
      <AgentTimelineBar segments={segs} activeId={null} onSegmentClick={() => {}} />
    );
    expect(container.querySelectorAll("button").length).toBe(3);
  });

  it("returns null when no segments", () => {
    const { container } = render(
      <AgentTimelineBar segments={[]} activeId={null} onSegmentClick={() => {}} />
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("invokes onSegmentClick with segment id", () => {
    let clicked: number | null = null;
    const { container } = render(
      <AgentTimelineBar
        segments={segs}
        activeId={2}
        onSegmentClick={(id) => {
          clicked = id;
        }}
      />
    );
    const buttons = container.querySelectorAll("button");
    (buttons[1] as HTMLButtonElement).click();
    expect(clicked).toBe(2);
  });

  it("renders error segments with red tint", () => {
    const { container } = render(
      <AgentTimelineBar segments={segs} activeId={null} onSegmentClick={() => {}} />
    );
    const errorBtn = container.querySelectorAll("button")[2] as HTMLButtonElement;
    expect(errorBtn.style.backgroundColor).toMatch(/#f87171|rgb\(248,?\s*113,?\s*113\)/);
  });

  it("uses minimum width for tiny segments", () => {
    const tiny: TimelineSegment[] = [
      { id: 1, toolName: "a", toolIcon: "", accentColor: "#aaa", logCount: 1, hasError: false },
      { id: 2, toolName: "b", toolIcon: "", accentColor: "#bbb", logCount: 1000, hasError: false },
    ];
    const { container } = render(
      <AgentTimelineBar segments={tiny} activeId={null} onSegmentClick={() => {}} />
    );
    const firstBtn = container.querySelectorAll("button")[0] as HTMLButtonElement;
    // 1/1001 ≈ 0.1% but clamped to 1.2%
    expect(parseFloat(firstBtn.style.width)).toBeGreaterThanOrEqual(1.2);
  });
});
