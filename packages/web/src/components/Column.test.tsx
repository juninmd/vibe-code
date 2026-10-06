import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/core", () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }) }));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  horizontalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

import { Column } from "./Column";

const props = { tasks: [], onTaskClick: vi.fn(), onRetryPR: vi.fn() };

describe("Column", () => {
  it("shows the issue label behind the lane while lane sync is on", () => {
    render(<Column status="review" laneLabel="status:review" {...props} />);
    expect(screen.getByText("status:review")).toBeInTheDocument();
  });

  it("shows no label line while it is off", () => {
    render(<Column status="review" {...props} />);
    expect(screen.queryByText(/status:/)).not.toBeInTheDocument();
  });
});
