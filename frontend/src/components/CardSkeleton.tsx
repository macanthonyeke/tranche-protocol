export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass p-6 animate-pulse">
          <div className="flex justify-between items-center mb-4">
            <div className="h-4 w-32 rounded bg-surface/70" />
            <div className="h-5 w-20 rounded-full bg-surface/70" />
          </div>
          <div className="h-3 w-2/3 rounded bg-surface/70 mb-2" />
          <div className="h-3 w-1/2 rounded bg-surface/70" />
          <div className="mt-4 h-2 w-full rounded bg-surface/70" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="glass p-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-surface/70 flex items-center justify-center mb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-muted">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </div>
      <div className="font-display text-xl text-fg-strong mb-2">{title}</div>
      <div className="text-sm text-muted-soft mb-5 max-w-md mx-auto">{hint}</div>
      {action}
    </div>
  );
}
