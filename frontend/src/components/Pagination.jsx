import React from 'react'
import { Link } from 'react-router-dom'

/* Pagination — composable primitives for paged navigation, adapted to the
   Tranche stack (Vite + JSX + Tailwind v3 + react-router). This mirrors the
   shadcn Pagination API (Pagination / Content / Item / Link / Previous / Next
   / Ellipsis) but drops the Next.js, TypeScript, CVA and lucide dependencies
   in favour of the project's design tokens, template-string classes and inline
   SVGs — the same conventions used by IconButton and the rest of components/.

   PaginationLink renders a react-router <Link> when `to` is set, a plain <a>
   when `href` is set, and a <button> otherwise — so it works for both routed
   pages and onClick-driven client paging (e.g. useInfiniteList). */

function cls(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function Pagination({ className = '', ...props }) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cls('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

export function PaginationContent({ className = '', ...props }) {
  return (
    <ul
      data-slot="pagination-content"
      className={cls('flex flex-row items-center gap-1', className)}
      {...props}
    />
  )
}

export function PaginationItem({ className = '', ...props }) {
  return <li data-slot="pagination-item" className={className} {...props} />
}

const LINK_BASE =
  'inline-flex items-center justify-center rounded-md text-sm font-medium select-none ' +
  'transition-[color,background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'active:scale-[0.96] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-clay ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-paper'

const LINK_SIZE = {
  default: 'h-9 gap-1.5 px-3',
  icon: 'h-9 w-9'
}

const LINK_TONE = {
  // active = "outline" look; inactive = "ghost" look (matches the demo)
  active: 'border border-rule text-ink hover:bg-sunk',
  ghost: 'text-ink-3 hover:text-ink hover:bg-sunk'
}

/* PaginationLink
   - `isActive` : current page styling + aria-current
   - `size`     : 'icon' (square page numbers) | 'default' (prev/next w/ label)
   - `to`       : react-router target -> renders <Link>
   - `href`     : renders <a>
   - (neither)  : renders <button>; pass `onClick` */
export function PaginationLink({
  className = '',
  isActive = false,
  size = 'icon',
  to,
  href,
  children,
  ...rest
}) {
  const classes = cls(
    LINK_BASE,
    LINK_SIZE[size] ?? LINK_SIZE.icon,
    isActive ? LINK_TONE.active : LINK_TONE.ghost,
    className
  )
  const aria = { 'aria-current': isActive ? 'page' : undefined }

  if (to != null) {
    return (
      <Link to={to} data-slot="pagination-link" className={classes} {...aria} {...rest}>
        {children}
      </Link>
    )
  }
  if (href != null) {
    return (
      <a href={href} data-slot="pagination-link" className={classes} {...aria} {...rest}>
        {children}
      </a>
    )
  }
  const { type = 'button', ...buttonRest } = rest
  return (
    <button type={type} data-slot="pagination-link" className={classes} {...aria} {...buttonRest}>
      {children}
    </button>
  )
}

const ChevronLeft = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    className="h-4 w-4 rtl:rotate-180" {...props}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)

const ChevronRight = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    className="h-4 w-4 rtl:rotate-180" {...props}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export function PaginationPrevious({ className = '', label = 'Previous', ...props }) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cls('pe-3 ps-2.5', className)}
      {...props}
    >
      <ChevronLeft />
      <span>{label}</span>
    </PaginationLink>
  )
}

export function PaginationNext({ className = '', label = 'Next', ...props }) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cls('ps-3 pe-2.5', className)}
      {...props}
    >
      <span>{label}</span>
      <ChevronRight />
    </PaginationLink>
  )
}

export function PaginationEllipsis({ className = '', ...props }) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden="true"
      className={cls('flex h-9 w-9 items-center justify-center text-ink-3', className)}
      {...props}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </svg>
      <span className="sr-only">More pages</span>
    </span>
  )
}
