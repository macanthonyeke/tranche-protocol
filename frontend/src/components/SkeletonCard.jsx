export default function SkeletonCard({ height = 120 }) {
  return (
    <div className="card-surface p-6">
      <div className="animate-pulse rounded-lg bg-background-tertiary" style={{ height, width: '100%' }} />
    </div>
  )
}

export function SkeletonLine({ width = '100%', height = 12 }) {
  return <span className="inline-block animate-pulse rounded-sm bg-background-tertiary" style={{ width, height }} />
}
