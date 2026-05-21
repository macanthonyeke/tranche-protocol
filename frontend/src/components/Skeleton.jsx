export default function Skeleton({ className = '', style }) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={style}
      aria-hidden
    />
  )
}

export function SkeletonText({ width = '100%', height = 12 }) {
  return (
    <span
      className="skeleton-shimmer inline-block rounded-full"
      style={{ width, height }}
      aria-hidden
    />
  )
}

export function SkeletonCard({ height = 140 }) {
  return (
    <div className="card-surface p-6">
      <Skeleton style={{ height }} />
    </div>
  )
}

/* Skeleton that mimics the shape of an active milestone card on EscrowDetail.
   Each row mirrors the real layout: index/title/badge, big amount, action row. */
export function SkeletonMilestoneCard() {
  return (
    <div className="relative pl-8">
      <span className="absolute left-[7px] top-6 h-3 w-3 rounded-full bg-sunk" aria-hidden />
      <div className="rounded-2xl border border-rule bg-paper p-5 flex flex-col gap-4 pl-7">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  )
}

/* Skeleton card sized to the Dashboard EscrowCard. */
export function SkeletonEscrowCard() {
  return (
    <div className="card-surface p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="flex items-baseline gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="pt-2 border-t border-rule flex items-center justify-between">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  )
}
