import { memo } from "react";

interface SkeletonProps {
  className?: string;
}

export const Skeleton = memo(function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-white/5 ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
    </div>
  );
});

export const SkeletonCard = memo(function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="glass-panel p-5 flex flex-col gap-4 rounded-3xl border border-white/5">
      <div className="flex items-start gap-4">
        <Skeleton className="w-10 h-10 rounded-2xl shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="w-16 h-6 rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeletons are static loading states
          <Skeleton key={i} className="h-2.5 w-full" />
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Skeleton className="h-6 w-24 rounded-xl" />
        <Skeleton className="h-6 w-16 rounded-xl" />
      </div>
    </div>
  );
});

export const SkeletonColumn = memo(function SkeletonColumn({
  taskCount = 3,
}: {
  taskCount?: number;
}) {
  return (
    <div className="flex-1 min-w-[280px] min-h-0 flex flex-col rounded-[2.5rem] bg-white/[0.02] border border-white/5">
      <div className="px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Skeleton className="w-2.5 h-2.5 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-8 rounded-full ml-auto" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-4 space-y-4">
        {Array.from({ length: taskCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeletons are static loading states
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
});

export const SkeletonBoard = memo(function SkeletonBoard({
  columnCount = 4,
  tasksPerColumn = 2,
}: {
  columnCount?: number;
  tasksPerColumn?: number;
}) {
  return (
    <div className="h-full w-full p-8 overflow-hidden">
      <div className="flex gap-6 h-full min-w-0">
        {Array.from({ length: columnCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeletons are static loading states
          <SkeletonColumn key={i} taskCount={tasksPerColumn} />
        ))}
      </div>
    </div>
  );
});
