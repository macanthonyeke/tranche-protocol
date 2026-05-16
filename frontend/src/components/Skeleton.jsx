export default function Skeleton({ className = '', style }) {
  return (
    <div
      className={`animate-pulse bg-background-tertiary rounded-xl ${className}`}
      style={style}
      aria-hidden
    />
  )
}

export function SkeletonText({ width = '100%', height = 12 }) {
  return (
    <span
      className="inline-block animate-pulse bg-background-tertiary rounded-full"
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
