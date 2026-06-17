// Compact timeline bar inspired by multica's agent-transcript-dialog. Each
// step group renders as a colored segment proportional to its log count; click
// to scroll the corresponding StepAccordion into view.

interface TimelineSegment {
  id: number;
  toolName: string;
  toolIcon: string;
  accentColor: string;
  logCount: number;
  hasError: boolean;
}

interface AgentTimelineBarProps {
  segments: TimelineSegment[];
  activeId: number | null;
  onSegmentClick: (id: number) => void;
}

export type { TimelineSegment };

export function AgentTimelineBar({ segments, activeId, onSegmentClick }: AgentTimelineBarProps) {
  if (segments.length === 0) return null;
  const total = segments.reduce((sum, s) => sum + Math.max(1, s.logCount), 0);

  return (
    <nav
      className="flex gap-px h-3 px-2 py-1 bg-[var(--bg-surface)] border-b border-default"
      aria-label="Execution timeline"
    >
      {segments.map((seg) => {
        const widthPct = (Math.max(1, seg.logCount) / total) * 100;
        const isActive = activeId === seg.id;
        return (
          <button
            type="button"
            key={seg.id}
            className="h-full rounded-sm transition-all hover:opacity-100 relative group cursor-pointer"
            style={{
              width: `${Math.max(widthPct, 1.2)}%`,
              backgroundColor: seg.hasError ? "#f87171" : seg.accentColor,
              opacity: isActive ? 1 : 0.55,
              minWidth: 4,
              outline: isActive ? `1px solid ${seg.accentColor}` : "none",
              outlineOffset: 1,
            }}
            onClick={() => onSegmentClick(seg.id)}
            title={`${seg.toolIcon} ${seg.toolName} · ${seg.logCount} log${seg.logCount === 1 ? "" : "s"}`}
            aria-label={`Step ${seg.id}: ${seg.toolName}`}
          >
            <span className="sr-only">{seg.toolName}</span>
          </button>
        );
      })}
    </nav>
  );
}
