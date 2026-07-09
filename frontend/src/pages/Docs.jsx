import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo.jsx'
import PageTransition from '../components/PageTransition.jsx'
import IconButton from '../components/IconButton.jsx'

// ---------------------------------------------------------------------------
// Content — plain-language copy, no crypto jargon. Edit here, not in JSX below.
// ---------------------------------------------------------------------------

const NAV_SECTIONS = [
  { id: 's1',  label: 'What is Tranche' },
  { id: 's2',  label: 'How it works' },
  { id: 's3',  label: 'Key terms' },
  { id: 's4',  label: 'For payers',        group: 'Guides' },
  { id: 's5',  label: 'For recipients',    group: 'Guides' },
  { id: 's6',  label: 'Cross-chain payouts', group: 'Guides' },
  { id: 's7',  label: 'Disputes',          group: 'Guides' },
  { id: 's8',  label: 'Fees',              group: 'Reference' },
  { id: 's9',  label: 'FAQ',               group: 'Reference' },
  { id: 's10', label: 'Trust & security',  group: 'Reference' },
  { id: 's11', label: 'About',             group: 'Reference' },
]

const HOW_IT_WORKS = [
  { n: '1', title: 'Lock funds', text: 'The payer deposits the full project amount up front. It sits on hold until milestones are met.' },
  { n: '2', title: 'Define milestones', text: 'The project is split into milestones, each with its own amount and review period.' },
  { n: '3', title: 'Recipient delivers', text: 'When a milestone is done, the recipient marks it delivered.' },
  { n: '4', title: 'Review window', text: 'The payer has a set window to review the work and approve it, or raise a concern.' },
  { n: '5', title: 'Funds release', text: 'If the payer approves, or the window passes without objection, the milestone pays out automatically.' },
]

const DISPUTE_STEPS = [
  { n: '1', title: 'Raise a dispute', text: 'Either side can raise a dispute on a milestone, along with a reason and supporting evidence.' },
  { n: '2', title: 'Submit evidence', text: 'The other side gets a chance to respond with their own evidence before anything is decided.' },
  { n: '3', title: 'Arbiter reviews', text: 'A neutral arbiter looks at both sides’ evidence.' },
  { n: '4', title: 'Ruling + release', text: 'The arbiter decides how the milestone funds are split, and the release happens immediately.' },
]

const GLOSSARY = [
  { term: 'Escrow', def: 'The on-chain holding account created for a project. It holds the funds until they’re released.' },
  { term: 'Milestone', def: 'One piece of a project with its own payment amount and its own review period.' },
  { term: 'Review window', def: 'The time the payer has to check delivered work before it automatically pays out.' },
  { term: 'Silent approval', def: 'If the payer doesn’t respond within the review window, the milestone releases anyway. Nobody can hold a payment hostage by going quiet.' },
  { term: 'Split recipient', def: 'A project can pay out to more than one recipient, each on their own chain, from a single escrow.' },
  { term: 'Arbiter', def: 'A neutral third party who steps in only if a dispute is raised, and rules based on evidence from both sides.' },
]

const PAYER_ITEMS = [
  { title: 'Creating an escrow', text: 'Set the total amount, the milestones, the deadline, and attach an invoice describing the work. Funds lock in as soon as you create it.' },
  { title: 'Acknowledgment step', text: 'The recipient reviews and acknowledges your invoice terms before work starts. If the terms are wrong, they can decline instead, so nothing locks in without agreement on scope.' },
  { title: 'Marking work fulfilled', text: 'The recipient marks a milestone as delivered. That starts your review window.' },
  { title: 'Extending a deadline', text: 'If a project needs more time, you can extend the deadline. It won’t happen without your action.' },
  { title: 'If you go silent', text: 'If you don’t respond inside the review window, the milestone releases to the recipient. This protects recipients from payers who disappear after work is delivered.' },
  { title: 'Mutual settlement / cancel', text: 'Both sides can agree at any point to settle for a different split, or cancel the remaining escrow and return unreleased funds to you.' },
  { title: 'Refunds', text: 'Funds returned to you, from a cancellation or a dispute, go into a refund balance you withdraw yourself, to whichever address you choose.' },
]

const RECIPIENT_ITEMS = [
  { title: 'Acknowledging an invoice (and declining)', text: 'Before work starts, review the invoice terms and acknowledge them on-chain. If something’s off, you can decline instead of starting work you haven’t agreed to.' },
  { title: 'Claiming delivery', text: 'Once a milestone is done, mark it delivered. That starts the payer’s review window.' },
  { title: 'What “silent approval” means for you', text: 'If the payer doesn’t respond in time, your payment releases automatically. You’re never stuck waiting indefinitely on someone who’s gone quiet.' },
  { title: 'Disputing', text: 'If the payer raises a concern about your delivery, you can submit evidence for your side. A neutral arbiter reviews before anything is decided.' },
  { title: 'Receiving cross-chain', text: 'You choose which chain you want to be paid on when the escrow is set up. Payment arrives there automatically when a milestone releases.' },
]

const FAQ_ITEMS = [
  { q: 'Is this audited?', a: 'Yes. Tranche has been through six rounds of independent security review, with zero critical or high-severity findings.' },
  { q: 'Is my money safe if the other party disappears?', a: 'Yes. If a payer goes silent, the milestone releases automatically after the review window. If a recipient disappears, unreleased funds can be refunded once the project deadline passes.' },
  { q: 'What if I send to the wrong chain?', a: 'A recipient’s payout chain is set inside the app, not typed by hand, so this isn’t something you configure manually. If a payment ever looks stuck, reach out: funds are recoverable, never lost.' },
  { q: 'Can I cancel?', a: 'Yes, if both sides agree. You can also let a milestone’s deadline pass, which opens a refund path for unreleased funds.' },
]

const STEP_GRID_COLS = { 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' }

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function ChevronIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 12 8" width="12" height="8" fill="none" aria-hidden="true" className={className}>
      <path d="M1 1.5 6 6.5 11 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Section({ id, eyebrow, title, description, children, variant = 'default' }) {
  return (
    <section id={id} className="mb-16 scroll-mt-20">
      {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
      {title && variant === 'hero' && (
        <h2 className="display text-2xl md:text-3xl text-ink mb-2">{title}</h2>
      )}
      {title && variant === 'default' && (
        <h2 className="text-lg font-bold uppercase tracking-[0.04em] text-ink pb-3 mb-5 border-b border-rule">
          {title}
        </h2>
      )}
      {description && <p className="text-sm text-ink-2 mb-6 max-w-prose leading-relaxed">{description}</p>}
      {children}
    </section>
  )
}

function StepGrid({ steps }) {
  const colsClass = STEP_GRID_COLS[steps.length] || ''
  return (
    <ol className={`grid grid-cols-1 gap-y-8 gap-x-6 ${colsClass}`}>
      {steps.map((s, i) => (
        <li key={s.n} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="display text-3xl text-clay leading-none">{s.n}</span>
            {i < steps.length - 1 && (
              <span aria-hidden className="hidden md:block flex-1 h-px bg-rule" />
            )}
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-ink tracking-[-0.005em]">{s.title}</h3>
            <p className="mt-1 text-sm text-ink-2 leading-relaxed">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function AccordionRow({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-rule first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-clay rounded-sm"
      >
        <span className="text-[15px] font-medium text-ink tracking-[-0.005em]">{title}</span>
        <ChevronIcon className={`shrink-0 text-ink-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <p className="pb-4 text-sm text-ink-2 leading-relaxed max-w-prose">{children}</p>
        </div>
      </div>
    </div>
  )
}

function Accordion({ items, defaultOpenIndex = -1 }) {
  return (
    <div>
      {items.map((item, i) => (
        <AccordionRow key={item.title || item.q} title={item.title || item.q} defaultOpen={i === defaultOpenIndex}>
          {item.text || item.a}
        </AccordionRow>
      ))}
    </div>
  )
}

function Callout({ title, children }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-clay/35 bg-clay-soft/40 p-4">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-clay text-clay text-xs font-semibold">?</span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-2 leading-relaxed">{children}</p>
      </div>
    </div>
  )
}

function LedgerRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-3.5 last:border-b-0">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="num text-sm font-medium text-ink">{value}</span>
    </div>
  )
}

function StatPill({ value, label }) {
  return (
    <div className="flex min-w-[110px] flex-col items-center gap-1 rounded-md border border-rule bg-paper px-5 py-4">
      <span className="num text-2xl font-semibold text-ink">{value}</span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar navigation — desktop sticky + scroll-spy, mobile slide-in drawer
// ---------------------------------------------------------------------------

function SidebarNav({ activeId, onNavigate }) {
  let lastGroup = null
  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      {NAV_SECTIONS.map((s) => {
        const showGroup = s.group && s.group !== lastGroup
        lastGroup = s.group ?? lastGroup
        return (
          <div key={s.id}>
            {showGroup && <div className="eyebrow mt-4 mb-1 px-2.5">{s.group}</div>}
            <a
              href={`#${s.id}`}
              onClick={(e) => onNavigate(e, s.id)}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors duration-150 ${
                activeId === s.id ? 'bg-clay text-paper font-medium' : 'text-ink-2 hover:bg-sunk hover:text-ink'
              }`}
            >
              <span className={`num text-[11px] ${activeId === s.id ? 'text-paper/75' : 'text-ink-3'}`}>
                {s.id.replace('s', '').padStart(2, '0')}
              </span>
              {s.label}
            </a>
          </div>
        )
      })}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Docs() {
  const [activeId, setActiveId] = useState('s1')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const observerRef = useRef(null)

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        })
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    )
    NAV_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observerRef.current.observe(el)
    })
    return () => observerRef.current?.disconnect()
  }, [])

  useEffect(() => {
    document.body.style.overflow = isDrawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isDrawerOpen])

  const handleNavigate = useCallback((e, id) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    setActiveId(id)
    setIsDrawerOpen(false)
  }, [])

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Mobile topbar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-rule bg-paper/90 px-4 py-3 backdrop-blur-md md:hidden">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Tranche Protocol home">
          <Logo variant="nav-tile" />
          <span className="display text-lg leading-none">Docs</span>
        </Link>
        <IconButton label="Open section menu" tone="bordered" onClick={() => setIsDrawerOpen(true)}>
          <MenuIcon />
        </IconButton>
      </div>

      {/* Scrim (mobile drawer) */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 md:hidden"
          onClick={() => setIsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="mx-auto flex w-full max-w-page">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[82%] max-w-[320px] flex-col gap-6 overflow-y-auto border-r border-rule bg-paper p-6 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]
            md:sticky md:top-0 md:z-auto md:h-screen md:w-[260px] md:max-w-none md:translate-x-0 md:shrink-0
            ${isDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        >
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5" aria-label="Tranche Protocol home">
              <Logo variant="nav-tile" />
              <span className="display text-lg leading-none">Tranche</span>
            </Link>
            <IconButton
              label="Close section menu"
              tone="bordered"
              size="sm"
              className="md:hidden"
              onClick={() => setIsDrawerOpen(false)}
            >
              <CloseIcon />
            </IconButton>
          </div>

          <Link to="/dashboard" className="btn-secondary w-full text-sm">Open app</Link>

          {/* Visual only — not wired to a search index. Confirm scope before hooking up. */}
          <input type="text" disabled placeholder="Search docs…" className="input text-sm" />

          <SidebarNav activeId={activeId} onNavigate={handleNavigate} />
        </aside>

        {/* Main content */}
        <main className="w-full min-w-0 max-w-[1000px] px-5 py-12 md:px-12 md:py-16">
          <PageTransition>
            <Section
              id="s1"
              eyebrow="Payment protection"
              title="Your payment sits somewhere neither of you controls, until the work is done."
              variant="hero"
            >
              <p className="text-[15px] text-ink-2 leading-relaxed max-w-prose">
                Tranche is where a payer and a recipient put money on hold for a project. The payer locks the
                funds up front. The recipient delivers the agreed work. The money only moves when both sides
                agree it’s done, a review period passes without objection, or a neutral third party settles
                a disagreement. Neither side can take the money back or release it early on their own.
              </p>
            </Section>

            <Section id="s2" title="How it works" description="The core loop, in five steps.">
              <StepGrid steps={HOW_IT_WORKS} />
              <p className="mt-6 text-sm text-ink-2">
                <span aria-hidden>↳</span>{' '}or a dispute: if either side raises a concern before release, it goes to arbitration instead.
              </p>
            </Section>

            <Section id="s3" title="Key terms" description="Short glossary, plain language.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {GLOSSARY.map((g) => (
                  <div key={g.term}>
                    <div className="text-[15px] font-medium text-ink tracking-[-0.005em]">{g.term}</div>
                    <div className="mt-1 text-sm text-ink-2 leading-relaxed">{g.def}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              id="s4"
              title="For payers / For recipients"
              description="Two audiences, side by side. Skim past what doesn’t apply to you."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-md border border-rule bg-paper p-6">
                  <div className="flex items-baseline gap-2.5 mb-1">
                    <span className="eyebrow text-clay">Payer</span>
                    <h3 className="text-base font-medium text-ink">For payers</h3>
                  </div>
                  <Accordion items={PAYER_ITEMS} defaultOpenIndex={0} />
                </div>
                <div id="s5" className="rounded-md border border-rule bg-paper p-6 scroll-mt-20">
                  <div className="flex items-baseline gap-2.5 mb-1">
                    <span className="eyebrow text-clay">Recipient</span>
                    <h3 className="text-base font-medium text-ink">For recipients</h3>
                  </div>
                  <Accordion items={RECIPIENT_ITEMS} defaultOpenIndex={0} />
                </div>
              </div>
            </Section>

            <Section id="s6" title="Cross-chain payouts">
              <p className="text-[15px] text-ink-2 leading-relaxed max-w-prose mb-4">
                If you’re set up to receive on a different chain than where the funds are held, the protocol
                converts and forwards the payment automatically. A small network fee is deducted from the
                payout to cover it. It’s never hidden, always shown before you confirm.
              </p>
              <Callout title="What to do if a payment seems stuck">
                Cross-chain transfers sometimes take a few extra minutes to finish arriving. If it’s been
                longer than that, reach out and we’ll get it released to you manually. Your funds are never
                at risk of being lost, only delayed.
              </Callout>
            </Section>

            <Section id="s7" title="Disputes, plainly explained">
              <StepGrid steps={DISPUTE_STEPS} />
              <p className="mt-6 text-sm text-ink-2 max-w-prose leading-relaxed">
                <span className="font-medium text-ink">Timeout protection:</span> if the arbiter doesn’t rule
                within a set window, the dispute settles automatically so funds never get stuck waiting on a
                third party.
              </p>
            </Section>

            <Section id="s8" title="Fees">
              <div className="rounded-md border border-rule bg-paper overflow-hidden">
                <LedgerRow label="Protocol fee" value="1.99%" />
                <LedgerRow label="Taken when" value="On milestone release" />
                <LedgerRow label="Cross-chain fee" value="Small, quoted live at payout" />
              </div>
            </Section>

            <Section id="s9" title="FAQ">
              <Accordion items={FAQ_ITEMS} />
            </Section>

            <Section id="s10" title="Trust & security">
              <div className="flex flex-wrap gap-3 mb-5">
                <StatPill value="6" label="Audit rounds" />
                <StatPill value="0" label="Critical" />
                <StatPill value="0" label="High severity" />
              </div>
              <p className="text-sm text-ink-2 max-w-prose leading-relaxed mb-3">
                Tranche has gone through six independent security audit rounds covering the full contract.
                All findings were resolved before each redeploy, and the current version carries zero open
                critical or high-severity issues.
              </p>
              <a
                href="https://github.com/macanthonyeke/tranche-protocol/tree/main/audit"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-clay hover:text-clay-hover underline-clay"
              >
                View audit reports
              </a>
            </Section>

            <Section id="s11" title="About">
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <span>Built by <span className="font-medium text-ink">MacAnthony Eke</span></span>
                <span aria-hidden>·</span>
                <a
                  href="https://x.com/macanthonyeke"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-clay hover:text-clay-hover underline-clay"
                >
                  x.com/macanthonyeke
                </a>
              </div>
            </Section>
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
