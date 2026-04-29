import { memo } from "react";

interface SkeletonProps {
  className?: string;
}

export const Skeleton = memo(function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`animate-pulse rounded-md bg-surface-hover ${className}`} aria-hidden="true" />
  );
});

interface SkeletonCardProps {
  lines?: number;
}

export const SkeletonCard = memo(function SkeletonCard({ lines = 3 }: SkeletonCardProps) {
  return (
    <div className="glass-card p-4 flex flex-col gap-3 rounded-xl">
      <div className="flex items-start gap-3">
        <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-3.5 w-3/4 rounded" />
          <Skeleton className="h-2.5 w-1/2 rounded mt-1.5" />
        </div>
        <Skeleton className="w-16 h-5 rounded-full" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static
        <Skeleton key={i} className="h-2 w-full rounded" />
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-5 w-20 rounded" />
        <Skeleton className="h-5 w-16 rounded" />
      </div>
    </div>
  );
});

interface SkeletonColumnProps {
  taskCount?: number;
}

export const SkeletonColumn = memo(function SkeletonColumn({ taskCount = 3 }: SkeletonColumnProps) {
  return (
    <div className="flex-1 min-w-[220px] min-h-0 flex flex-col rounded-2xl glass-card border border-default/50">
      <div className="px-4 pt-3.5 pb-3 border-b" style={{ borderColor: "var(--glass-border)" }}>
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-2 h-2 rounded-full" />
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-4 w-6 rounded-full" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-2.5 py-2.5 space-y-2 min-h-[80px]">
        {Array.from({ length: taskCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    </div>
  );
});

interface SkeletonBoardProps {
  columnCount?: number;
  tasksPerColumn?: number;
}

export const SkeletonBoard = memo(function SkeletonBoard({
  columnCount = 5,
  tasksPerColumn = 3,
}: SkeletonBoardProps) {
  return (
    <div className="flex flex-col gap-4 pb-4 h-full">
      <div className="flex gap-3 flex-1 min-h-0 min-w-0 overflow-hidden">
        {Array.from({ length: columnCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <SkeletonColumn key={i} taskCount={tasksPerColumn} />
        ))}
      </div>
    </div>
  );
});
