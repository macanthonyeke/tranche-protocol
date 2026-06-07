import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion, useInView } from 'framer-motion'
import { ContainerScroll } from '../components/ui/container-scroll-animation.jsx'
import { toast } from 'sonner'
import ThemeToggle from '../components/ThemeToggle.jsx'
import WalletButton from '../components/WalletButton.jsx'
import PageTransition from '../components/PageTransition.jsx'
import { Logo } from '../components/Logo.jsx'
import { CONTRACT_ADDRESS, arcTestnet } from '../config/wagmi.js'
import { truncateAddr } from '../utils/format'

const ExternalLinkIcon = (props) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </svg>
)

function ContractPill({ address }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Contract address copied')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed')
    }
  }
  const explorerUrl = `${arcTestnet.blockExplorers.default.url}/address/${address}`
  return (
    <div className="flex items-center gap-2 bg-sunk border border-rule rounded-full p-1 pl-4">
      <button
        type="button"
        onClick={onCopy}
        title="Copy contract address"
        className="flex items-center gap-2 hover:text-ink text-ink-2 transition-colors cursor-pointer bg-transparent border-0 p-0 font-sans"
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span key="check" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }} className="text-[10px] uppercase tracking-[0.18em] text-ok">
              ✓ Copied
            </motion.span>
          ) : (
            <motion.span key="label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
              Contract
            </motion.span>
          )}
        </AnimatePresence>
        <span className="num text-xs">{truncateAddr(address)}</span>
      </button>
      <span aria-hidden className="w-px h-4 bg-rule mx-1" />
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="View on Arc Explorer"
        className="group w-8 h-8 flex items-center justify-center rounded-full bg-paper hover:bg-clay-soft hover:text-clay text-ink-3 transition-[background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <ExternalLinkIcon />
      </a>
    </div>
  )
}

const TICKER_ITEMS = [
  'Escrow #1042 Locked on Arbitrum',
  'Escrow #1039 Released on Optimism',
  'Dispute Resolved on Base',
  'Escrow #1037 Funded on Ethereum',
  'Milestone Approved on Polygon',
  'Escrow #1034 Released on Arbitrum',
  'Auto-release Claimed on Base',
  'Escrow #1031 Locked on Optimism'
]

const STEPS = [
  { n: '01', title: 'Payer locks USDC', text: 'Set milestones, a deadline, and the chain where the freelancer wants to be paid. The funds go into the contract and stay there until work gets approved.' },
  { n: '02', title: 'Freelancer signals delivery', text: 'When a milestone is done, the freelancer marks it. The payer reviews and either approves or opens a dispute with evidence.' },
  { n: '03', title: 'Payment goes out', text: 'Approved milestones release via Circle CCTP to whichever chain the freelancer set. Disputed milestones go to a neutral arbiter who reviews both sides.' }
]

// Why Arc — one uniform spec list. The gas-token point leads as 01 because
// it's the strongest differentiator, but it's the same row shape as the rest
// so the set reads as a single sheet, not a headline plus five footnotes.
const STAGGER_CONTAINER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}
const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

const REASONS = [
  { title: 'One asset, the whole way through', text: 'On most chains you need ETH just to touch your USDC. Arc uses USDC as the gas token, so a contractor anywhere can lock funds, approve milestones, and withdraw payment without ever managing a separate gas token. Every transaction cost is a predictable dollar amount.' },
  { title: 'Payment release is actually final', text: 'Every action inside the escrow confirms on Arc in under a second and cannot be reversed. Locking funds, approving a milestone, raising a dispute, the contract state is always certain.' },
  { title: 'Disputes need evidence', text: 'You can\'t open a dispute without a reason and a link to your evidence. The other side must submit counter-evidence before the arbiter can rule.' },
  { title: 'No more chasing payers', text: 'If the payer goes silent after a milestone is marked delivered, a timer starts. Once it expires, the payment auto-releases.' },
  { title: 'Get paid on your chain', text: 'Freelancers can receive payment on a completely different chain from where the payer locked funds. Arc is a native USDC issuance chain.' },
  { title: 'Refunds you can actually access', text: 'If an escrow is cancelled or a dispute resolves in your favor, your refund goes into a balance you withdraw yourself. You choose the destination address.' }
]

/* ------------------------------------------------------------
   HERO: floating mock escrow card (right column visual)
   ------------------------------------------------------------ */
const DESTINATIONS = [
  { name: 'Arbitrum', icon: 'https://cryptologos.cc/logos/arbitrum-arb-logo.svg?v=029' },
  { name: 'Base', icon: '/icons/base.svg' },
  { name: 'Ethereum', icon: 'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=029' },
  { name: 'Monad', icon: '/icons/monad.svg' }
]

function HeroAmount() {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = useState('0.00')
  useEffect(() => {
    if (reduceMotion) { setDisplay('25,000.00'); return }
    const target = 25000
    const dur = 2400
    let raf
    let timeout

    const run = () => {
      const start = performance.now()
      const tick = (now) => {
        const t = Math.min(1, (now - start) / dur)
        const eased = 1 - Math.pow(1 - t, 4)
        setDisplay((target * eased).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        if (t < 1) raf = requestAnimationFrame(tick)
        else timeout = setTimeout(run, 10000)
      }
      setDisplay('0.00')
      raf = requestAnimationFrame(tick)
    }

    run()
    return () => { cancelAnimationFrame(raf); clearTimeout(timeout) }
  }, [reduceMotion])
  return <span className="num text-5xl text-ink">{display}</span>
}

function HeroVisual() {
  const reduceMotion = useReducedMotion()
  const [destIndex, setDestIndex] = useState(0)

  useEffect(() => {
    if (reduceMotion) return
    let id
    const start = () => {
      if (id || document.visibilityState !== 'visible') return
      id = setInterval(() => {
        setDestIndex((i) => (i + 1) % DESTINATIONS.length)
      }, 3000)
    }
    const stop = () => { if (id) { clearInterval(id); id = undefined } }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reduceMotion])

  const destination = DESTINATIONS[destIndex]

  return (
    <motion.div
      animate={reduceMotion ? undefined : { y: [-8, 8, -8] }}
      transition={reduceMotion ? undefined : { repeat: Infinity, duration: 5, ease: 'easeInOut' }}
      className="bg-paper border border-rule rounded-md p-6 w-full max-w-md mx-auto"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
          <span className="num text-xs text-ink-2">ESCROW #1042</span>
        </div>
        <span className="num text-[10px] uppercase tracking-[0.18em] text-ink-3 px-2 py-1 rounded-sm bg-sunk border border-rule">
          Locked
        </span>
      </div>

      <div className="eyebrow mb-2">Locked amount</div>
      <div className="mb-6 flex items-baseline">
        <HeroAmount />
        <span className="display text-xl text-ink-2 font-sans ml-2">USDC</span>
      </div>

      {/* Route */}
      <div className="bg-sunk border border-rule rounded-md p-5 flex flex-col gap-3 relative overflow-hidden mb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-ink-3 uppercase tracking-[0.18em]">From</span>
            <div className="h-7 mt-1 flex items-center gap-2">
              <img
                src="/icons/arc.svg"
                alt="Arc"
                className="w-5 h-5 object-contain pointer-events-none select-none flex-shrink-0"
                draggable="false"
              />
              <span className="font-medium text-ink">Arc</span>
            </div>
          </div>

          <div className="flex-1 relative h-7 flex items-center">
            <div className="bg-rule-2 w-full h-[1px]" />
            {!reduceMotion && (
              <motion.div
                initial={{ left: '5%', opacity: 0 }}
                animate={{ left: ['5%', '50%', '95%'], opacity: [0, 1, 0] }}
                transition={{ duration: 2, times: [0, 0.5, 1], repeat: Infinity, repeatDelay: 1, ease: 'easeInOut' }}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 bg-clay rounded-full shadow-glow-clay z-10"
              />
            )}
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[10px] text-ink-3 uppercase tracking-[0.18em]">To</span>
            <div className="relative h-7 mt-1 min-w-[7rem] flex justify-end items-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={destination.name}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-2"
                >
                  <img
                    src={destination.icon}
                    alt={destination.name}
                    className="w-5 h-5 object-contain pointer-events-none select-none flex-shrink-0"
                    draggable="false"
                  />
                  <span className="font-medium text-ink">{destination.name}</span>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="border-l border-rule ml-2 pl-4 flex flex-col gap-3 mt-6">
        {[
          { label: 'Milestone 1', state: 'Released', tone: 'success' },
          { label: 'Milestone 2', state: 'In review', tone: 'pending' },
          { label: 'Milestone 3', state: 'Pending', tone: 'idle' }
        ].map((m) => (
          <div key={m.label} className="relative flex items-center justify-between text-sm text-ink-2">
            <div className="absolute -left-[21px] top-2 w-2 h-2 rounded-full bg-rule-2" />
            <span>{m.label}</span>
            <span
              className={
                m.tone === 'success'
                  ? 'text-ok font-medium'
                  : m.tone === 'pending'
                  ? 'text-warn font-medium'
                  : 'text-ink-3'
              }
            >
              {m.state}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------
   LIVE PROTOCOL TICKER: infinite auto-scrolling marquee
   ------------------------------------------------------------ */
function ProtocolTicker() {
  const reduceMotion = useReducedMotion()
  const marqueeRef = useRef(null)
  const loop = reduceMotion ? TICKER_ITEMS : [...TICKER_ITEMS, ...TICKER_ITEMS]

  const pause = () => marqueeRef.current?.getAnimations().forEach((a) => a.pause())
  const play  = () => marqueeRef.current?.getAnimations().forEach((a) => a.play())

  return (
    <section
      className="bg-sunk border-y border-rule py-3 overflow-hidden"
      onMouseEnter={reduceMotion ? undefined : pause}
      onMouseLeave={reduceMotion ? undefined : play}
    >
      <motion.div
        ref={marqueeRef}
        className="flex gap-10 whitespace-nowrap"
        animate={reduceMotion ? undefined : { x: ['0%', '-50%'] }}
        transition={reduceMotion ? undefined : { repeat: Infinity, duration: 40, ease: 'linear' }}
      >
        {loop.map((item, i) => (
          <span key={i} className="num text-sm text-ink-2 flex items-center gap-10">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay/70" />
              {item}
            </span>
            <span className="text-ink-3">•</span>
          </span>
        ))}
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------
   DEVELOPER FLEX: mock code editor with Solidity snippet
   ------------------------------------------------------------ */
const CODE_LINES = [
  <><span className="text-ink-3">{'// Lock USDC into a milestone-bound, dispute-aware escrow'}</span></>,
  <><span className="text-clay">{'function'}</span>{' '}<span className="text-ink">{'createEscrow'}</span><span className="text-ink-2">{'('}</span></>,
  <>{'    '}<span className="text-clay">{'address'}</span>{' '}<span className="text-ink">{'freelancer'}</span><span className="text-ink-2">{','}</span></>,
  <>{'    '}<span className="text-clay">{'uint256'}</span>{' '}<span className="text-ink">{'amount'}</span><span className="text-ink-2">{','}</span></>,
  <>{'    '}<span className="text-clay">{'uint32'}</span>{' '}<span className="text-ink">{'destinationDomain'}</span><span className="text-ink-2">{','}</span></>,
  <>{'    '}<span className="text-clay">{'bytes32'}</span>{' '}<span className="text-ink">{'receivingAddress'}</span><span className="text-ink-2">{','}</span></>,
  <>{'    '}<span className="text-clay">{'uint64'}</span>{' '}<span className="text-ink">{'deadline'}</span><span className="text-ink-2">{','}</span></>,
  <>{'    '}<span className="text-clay">{'uint256'}</span><span className="text-ink-2">{'[]'}</span>{' '}<span className="text-clay">{'calldata'}</span>{' '}<span className="text-ink">{'milestoneAmounts'}</span></>,
  <><span className="text-ink-2">{')'}</span>{' '}<span className="text-clay">{'external'}</span>{' '}<span className="text-clay">{'returns'}</span>{' '}<span className="text-ink-2">{'('}</span><span className="text-clay">{'uint256'}</span>{' '}<span className="text-ink">{'escrowId'}</span><span className="text-ink-2">{') {'}</span></>,
  <>{'    '}<span className="text-ink">{'require'}</span><span className="text-ink-2">{'('}</span><span className="text-ink">{'amount '}</span><span className="text-ink-2">{'>'}</span><span className="text-warn">{' 0'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-ok">{'"zero amount"'}</span><span className="text-ink-2">{');'}</span></>,
  <>{'    '}<span className="text-ink">{'require'}</span><span className="text-ink-2">{'('}</span><span className="text-ink">{'deadline '}</span><span className="text-ink-2">{'>'}</span><span className="text-ink">{' block'}</span><span className="text-ink-2">{'.'}</span><span className="text-ink">{'timestamp'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-ok">{'"past deadline"'}</span><span className="text-ink-2">{');'}</span></>,
  <>{' '}</>,
  <>{'    '}<span className="text-ink-3">{'// Pull USDC from the payer into the escrow'}</span></>,
  <>{'    '}<span className="text-ink">{'USDC'}</span><span className="text-ink-2">{'.'}</span><span className="text-ink">{'safeTransferFrom'}</span><span className="text-ink-2">{'('}</span><span className="text-ink">{'msg'}</span><span className="text-ink-2">{'.'}</span><span className="text-ink">{'sender'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-clay">{'address'}</span><span className="text-ink-2">{'('}</span><span className="text-clay">{'this'}</span><span className="text-ink-2">{'),'}</span>{' '}<span className="text-ink">{'amount'}</span><span className="text-ink-2">{');'}</span></>,
  <>{' '}</>,
  <>{'    '}<span className="text-ink">{'escrowId '}</span><span className="text-ink-2">{'='}</span>{' '}<span className="text-ink">{'_storeEscrow'}</span><span className="text-ink-2">{'('}</span><span className="text-ink">{'freelancer'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-ink">{'milestoneAmounts'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-ink">{'deadline'}</span><span className="text-ink-2">{');'}</span></>,
  <>{'    '}<span className="text-ink">{'emit '}</span><span className="text-ink">{'EscrowCreated'}</span><span className="text-ink-2">{'('}</span><span className="text-ink">{'escrowId'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-ink">{'msg'}</span><span className="text-ink-2">{'.'}</span><span className="text-ink">{'sender'}</span><span className="text-ink-2">{','}</span>{' '}<span className="text-ink">{'freelancer'}</span><span className="text-ink-2">{');'}</span></>,
  <><span className="text-ink-2">{'}'}</span></>,
]

const LINE_DELAY = 0.055
const LINE_DURATION = 0.28

function CodeEditor() {
  const containerRef = useRef(null)
  const isInView = useInView(containerRef, { once: true, margin: '-80px' })
  const reduceMotion = useReducedMotion()

  const shouldAnimate = isInView && !reduceMotion
  const cursorDelay = (CODE_LINES.length - 1) * LINE_DELAY + LINE_DURATION

  return (
    <motion.div
      ref={containerRef}
      className="bg-paper border border-rule rounded-md overflow-hidden max-w-4xl mx-auto"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: 10 }}
      animate={isInView ? { opacity: 1, scale: 1, y: 0 } : {}}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* macOS terminal header */}
      <div className="h-10 bg-sunk border-b border-rule flex items-center px-4 gap-2">
        <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
        <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
        <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
        <span className="ml-4 num text-xs text-ink-3">TrancheProtocol.sol</span>
      </div>

      {/* Code body — each line reveals with stagger as editor enters view */}
      <pre className="font-mono text-sm leading-relaxed text-ink p-6 overflow-x-auto">
        <code>
          {CODE_LINES.map((line, i) => (
            <motion.span
              key={i}
              className="block"
              initial={reduceMotion ? false : { opacity: 0, y: 7 }}
              animate={shouldAnimate ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: LINE_DURATION, ease: [0.22, 1, 0.36, 1], delay: i * LINE_DELAY }}
            >
              {line}
              {i === CODE_LINES.length - 1 && (
                <motion.span
                  aria-hidden
                  className="inline-block w-0.5 h-[0.85em] bg-clay align-middle ml-0.5"
                  initial={{ opacity: 0 }}
                  animate={shouldAnimate ? { opacity: [0, 1, 1, 0, 0] } : reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={shouldAnimate ? {
                    delay: cursorDelay,
                    duration: 0.9,
                    times: [0, 0.01, 0.5, 0.51, 1],
                    ease: 'linear',
                    repeat: Infinity,
                  } : {}}
                />
              )}
            </motion.span>
          ))}
        </code>
      </pre>
    </motion.div>
  )
}

/* ------------------------------------------------------------
   LANDING PAGE
   ------------------------------------------------------------ */
export default function Home() {
  return (
    <div className="flex flex-col min-h-screen w-full max-w-full overflow-x-clip text-ink transition-colors duration-300">
      {/* Marketing top nav — sticky to match the in-app shell header.
          The root uses overflow-x-clip (not -hidden) so it doesn't become a
          scroll container and silently break this header's sticky positioning. */}
      <header className="sticky top-0 z-50 h-16 border-b border-rule bg-paper/85 backdrop-blur-md">
        <div className="max-w-content mx-auto h-full flex items-center justify-between px-4 md:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Tranche Protocol home">
            <Logo variant="nav-tile" />
            <span className="hidden sm:inline display text-[22px] leading-none tracking-tightest">Tranche</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/dashboard" className="hidden sm:inline-flex btn-secondary text-sm">Open app</Link>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Entrance animation lives here, not around the whole page, so the
          sticky header above stays free of a transformed ancestor. flex-1 +
          flex-col preserves the footer's mt-auto bottom-pin. */}
      <PageTransition className="flex flex-col flex-1">
      {/* Hero (split layout) */}
      <section className="relative">
        <div className="relative lg:grid lg:grid-cols-2 lg:gap-12 lg:items-center py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-[1200px] mx-auto w-full">
          {/* Left: copy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-start text-left"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-paper px-3 py-1 text-xs text-ink-2 mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              Live on Arc Testnet
            </span>
            <h1 className="display text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] text-ink">
              USDC escrow that <span className="underline-clay">enforces</span> the agreement.
            </h1>
            <p className="mt-6 max-w-xl text-lg md:text-xl text-ink-2 leading-relaxed">
              Lock funds into milestones. The contract holds them until work is approved, a dispute is resolved, or both sides agree to cancel. No trust required on either side.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3">
              <Link to="/create" className="btn-primary btn-lg">Create an Escrow</Link>
              <Link to="/dashboard" className="btn-secondary btn-lg">View Dashboard</Link>
            </div>
            <p className="mt-8 num text-xs text-ink-3">
              Live on Arc Testnet · Powered by Circle CCTP V2
            </p>
          </motion.div>

          {/* Right: floating visual */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            className="mt-16 lg:mt-0"
          >
            <HeroVisual />
          </motion.div>
        </div>
      </section>

      {/* Live protocol ticker */}
      <ProtocolTicker />

      {/* Developer flex */}
      <section className="w-full">
        <ContainerScroll
          titleComponent={
            <>
              <h2 className="display text-4xl md:text-5xl text-ink">Built so neither side has to trust the other</h2>
              <p className="mt-3 text-ink-2 max-w-2xl mx-auto leading-relaxed">
                Every escrow is a single on-chain record. Milestone amounts, deadlines, and dispute rules are set at the start and cannot be changed mid-way.
              </p>
            </>
          }
        >
          <CodeEditor />
        </ContainerScroll>
      </section>

      {/* How it works — horizontal numbered stepper.
          No cards. Each step is anchored by a display-scale numeral; thin
          hairline connectors thread between them on desktop. Mobile collapses
          to a single vertical column where the numerals stay oversized so the
          rhythm survives the breakpoint. */}
      <section className="max-w-content mx-auto w-full px-4 md:px-8 pt-12 pb-24">
        <motion.div
          className="flex items-baseline justify-between gap-6 flex-wrap mb-14"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2 className="display text-4xl md:text-5xl text-ink">How it works</h2>
          <span className="eyebrow">Three on-chain steps</span>
        </motion.div>
        <motion.ol
          className="grid grid-cols-1 md:grid-cols-3 gap-y-10 md:gap-x-10"
          variants={STAGGER_CONTAINER}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          {STEPS.map((s, i) => (
            <motion.li key={s.n} variants={STAGGER_ITEM} className="relative flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <span className="display text-ink text-6xl md:text-7xl leading-none">
                  {s.n}
                </span>
                {i < STEPS.length - 1 && (
                  <motion.span
                    aria-hidden
                    className="hidden md:flex flex-1 h-px bg-rule origin-left"
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.35 + i * 0.08 }}
                  />
                )}
              </div>
              <h3 className="text-lg font-medium text-ink">{s.title}</h3>
              <p className="text-sm text-ink-2 leading-relaxed max-w-prose">{s.text}</p>
            </motion.li>
          ))}
        </motion.ol>
      </section>

      {/* Why Arc — one uniform spec sheet. Every reason is the same row: a
          small Fraunces index in the left rail, title + body on the right,
          hairline rules between. The gas-token point leads as 01 but earns no
          special chrome, so the six read as a single ledger of properties
          rather than a hero claim with five footnotes. Header mirrors the
          "How it works" section above for cross-section rhythm; the indices
          stay smaller than that section's display numerals so they read as
          spec markers, not a second on-chain sequence. No icons: the shared
          column grid and whitespace carry the hierarchy. */}
      <section
        className="max-w-content mx-auto w-full px-4 md:px-8 pt-12 pb-24"
        aria-labelledby="why-arc-heading"
      >
        <motion.div
          className="flex items-baseline justify-between gap-6 flex-wrap mb-14"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2 id="why-arc-heading" className="display text-4xl md:text-5xl text-ink">Why Arc</h2>
          <span className="eyebrow text-ink-3">Six things that hold up</span>
        </motion.div>
        <motion.ol
          className="border-b border-rule"
          variants={STAGGER_CONTAINER}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
        >
          {REASONS.map(({ title, text }, idx) => {
            const n = String(idx + 1).padStart(2, '0')
            return (
              <motion.li
                key={title}
                variants={STAGGER_ITEM}
                className="grid grid-cols-1 md:grid-cols-[7rem_minmax(0,1fr)] lg:grid-cols-[10rem_minmax(0,1fr)] gap-y-3 md:gap-x-8 lg:gap-x-12 py-8 md:py-10 border-t border-rule"
              >
                <div className="md:pt-1.5 lg:pt-2 flex items-baseline gap-3 md:block">
                  <span
                    aria-hidden
                    className="display text-ink-2 text-[26px] md:text-[28px] leading-none"
                  >
                    {n}
                  </span>
                  <span className="sr-only">{`Reason ${idx + 1} of ${REASONS.length}.`}</span>
                </div>
                <div className="max-w-2xl">
                  <h3 className="text-base md:text-lg font-medium text-ink leading-snug">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm md:text-[15px] text-ink-2 leading-relaxed">
                    {text}
                  </p>
                </div>
              </motion.li>
            )
          })}
        </motion.ol>
      </section>

      {/* Footer */}
      <footer className="mt-auto">
        <div className="rule" />
        <div className="max-w-content mx-auto px-4 md:px-8 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <ContractPill address={CONTRACT_ADDRESS} />
          <div className="flex gap-6">
            <Link to="/dashboard" className="text-sm text-ink-2 font-medium hover:text-ink transition-colors">Dashboard</Link>
            <Link to="/create" className="text-sm text-ink-2 font-medium hover:text-ink transition-colors">Create</Link>
            <Link to="/settings" className="text-sm text-ink-2 font-medium hover:text-ink transition-colors">Settings</Link>
          </div>
          <div className="text-sm text-ink-3">© Tranche Protocol</div>
        </div>
      </footer>
      </PageTransition>
    </div>
  )
}
