import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    // Inert the rest of the app so screen readers and keyboard focus stay
    // inside the dialog. The dialog is portalled to document.body and lives
    // outside #root, so marking #root inert leaves it reachable.
    const root = document.getElementById('root')
    const hadInert = root?.hasAttribute('inert')
    const prevAriaHidden = root?.getAttribute('aria-hidden')
    root?.setAttribute('inert', '')
    root?.setAttribute('aria-hidden', 'true')

    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key !== 'Tab') return
      const container = ref.current
      if (!container) return
      const nodes = Array.from(container.querySelectorAll(FOCUSABLE))
      if (nodes.length === 0) { e.preventDefault(); container.focus(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const prevFocus = document.activeElement
    setTimeout(() => {
      const container = ref.current
      const firstFocusable = container?.querySelector(FOCUSABLE)
      ;(firstFocusable ?? container)?.focus()
    }, 0)

    return () => {
      document.removeEventListener('keydown', onKey)
      if (!hadInert) root?.removeAttribute('inert')
      if (prevAriaHidden === null || prevAriaHidden === undefined) {
        root?.removeAttribute('aria-hidden')
      } else {
        root?.setAttribute('aria-hidden', prevAriaHidden)
      }
      try { prevFocus?.focus?.() } catch {}
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 backdrop-blur-[2px]"
            style={{ background: 'color-mix(in oklch, var(--ink) 35%, transparent)' }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : 'Dialog'}
            tabIndex={-1}
            ref={ref}
            className={`relative panel w-full ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'} z-10`}
          >
            {title && (
              <>
                <div className="px-5 pt-5 pb-3">
                  <h2 id={titleId} className="display text-[24px] leading-tight text-ink">{title}</h2>
                </div>
                <div className="rule" />
              </>
            )}
            <div className="px-5 py-4">{children}</div>
            {footer && (
              <>
                <div className="rule" />
                <div className="px-5 py-3 flex items-center justify-end gap-2">{footer}</div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
