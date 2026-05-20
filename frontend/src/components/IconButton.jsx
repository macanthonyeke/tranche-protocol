import React, { forwardRef } from 'react'

/* IconButton — a 44px-by-default hit area for icon-only triggers and links.
   The visual size of the icon stays as authored; padding around it produces
   the full hit target. Use this anywhere an `aria-label` is the only label,
   so touch-target requirements (WCAG 2.5.5 / 2.5.8) hold by construction.

   - `as`     : 'button' (default) or 'a'. Anchors must pass `href`.
   - `size`   : 'md' (44px, default) or 'sm' (36px — for popovers / dense UIs).
   - `tone`   : 'ghost' (default), 'bordered', 'danger'.
   - `label`  : sets the accessible name; required. */
const SIZE = {
  md: 'h-11 w-11',
  sm: 'h-9 w-9'
}

const TONE = {
  ghost:
    'text-text-tertiary hover:text-text-primary hover:bg-background-tertiary',
  bordered:
    'border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-background-tertiary',
  danger:
    'text-status-error hover:bg-status-error/10'
}

const BASE =
  'inline-flex items-center justify-center rounded-xl ' +
  'transition-[color,background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'active:scale-[0.96] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary'

const IconButton = forwardRef(function IconButton(
  { as = 'button', label, size = 'md', tone = 'ghost', className = '', children, ...rest },
  ref
) {
  const cls = `${BASE} ${SIZE[size] ?? SIZE.md} ${TONE[tone] ?? TONE.ghost} ${className}`

  if (as === 'a') {
    return (
      <a ref={ref} aria-label={label} className={cls} {...rest}>
        {children}
      </a>
    )
  }

  const { type = 'button', ...buttonRest } = rest
  return (
    <button ref={ref} type={type} aria-label={label} className={cls} {...buttonRest}>
      {children}
    </button>
  )
})

export default IconButton
