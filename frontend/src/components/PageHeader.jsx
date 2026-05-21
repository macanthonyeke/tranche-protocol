// Editorial page header: eyebrow + serif title + optional kicker line,
// with an actions slot on the right. No card chrome, no shadow.
export default function PageHeader({ eyebrow, title, kicker, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-8 pt-10">
      <div className="flex flex-col gap-2 max-w-prose">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="display text-[44px] sm:text-[56px] leading-[1.02] text-ink">
          {title}
        </h1>
        {kicker && <p className="text-ink-2 text-[15px] leading-relaxed">{kicker}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
