import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import ThemeToggle from '../components/ThemeToggle.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { CONTRACT_ADDRESS, arcTestnet } from '../config/wagmi.js'
import { truncateAddr } from '../utils/format'

const ExternalLinkIcon = (props) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </svg>
)

function ContractPill({ address }) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Contract address copied!')
    } catch {
      toast.error('Copy failed')
    }
  }
  const explorerUrl = `${arcTestnet.blockExplorers.default.url}/address/${address}`
  return (
    <div className="flex items-center gap-2 bg-background-tertiary border border-border-subtle rounded-full p-1 pl-4">
      <button
        type="button"
        onClick={onCopy}
        title="Copy contract address"
        className="flex items-center gap-2 hover:text-text-primary text-text-secondary transition-colors cursor-pointer bg-transparent border-0 p-0 font-inherit"
      >
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Contract</span>
        <span className="font-mono text-xs">{truncateAddr(address)}</span>
      </button>
      <span aria-hidden className="w-px h-4 bg-border-subtle mx-1" />
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="View on Arc Explorer"
        className="group w-8 h-8 flex items-center justify-center rounded-full bg-background-secondary hover:bg-accent-blue/10 hover:text-accent-blue text-text-tertiary transition-[background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
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

const CoinsIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="m16.71 13.88.7.71-2.82 2.82" />
  </svg>
)
const ShieldCheckIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
const FileSearchIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <circle cx="11.5" cy="14.5" r="2.5" />
    <path d="M13.25 16.25 15 18" />
  </svg>
)
const TimerIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <line x1="10" x2="14" y1="2" y2="2" />
    <line x1="12" x2="15" y1="14" y2="11" />
    <circle cx="12" cy="14" r="8" />
  </svg>
)
const GlobeIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" x2="22" y1="12" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)
const WalletIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
)

const LEAD_FEATURE = {
  title: 'One asset, the whole way through',
  text: 'On most chains you need ETH just to touch your USDC. Arc uses USDC as the gas token, so a contractor anywhere can lock funds, approve milestones, and withdraw payment without ever managing a separate gas token. Every transaction cost is a predictable dollar amount.',
  Icon: CoinsIcon
}

const FEATURES = [
  { title: 'Payment release is actually final', text: 'Every action inside the escrow confirms on Arc in under a second and cannot be reversed. Locking funds, approving a milestone, raising a dispute, the contract state is always certain.', Icon: ShieldCheckIcon },
  { title: 'Disputes need evidence', text: 'You can\'t open a dispute without a reason and a link to your evidence. The other side must submit counter-evidence before the arbiter can rule.', Icon: FileSearchIcon },
  { title: 'No more chasing payers', text: 'If the payer goes silent after a milestone is marked delivered, a timer starts. Once it expires, the payment auto-releases.', Icon: TimerIcon },
  { title: 'Get paid on your chain', text: 'Freelancers can receive payment on a completely different chain from where the payer locked funds. Arc is a native USDC issuance chain.', Icon: GlobeIcon },
  { title: 'Refunds you can actually access', text: 'If an escrow is cancelled or a dispute resolves in your favor, your refund goes into a balance you withdraw yourself. You choose the destination address.', Icon: WalletIcon }
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

function HeroVisual() {
  const [destIndex, setDestIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setDestIndex((i) => (i + 1) % DESTINATIONS.length)
    }, 3000)
    return () => clearInterval(id)
  }, [])

  const destination = DESTINATIONS[destIndex]

  return (
    <motion.div
      animate={{ y: [-8, 8, -8] }}
      transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
      className="bg-background-secondary border border-border-subtle rounded-2xl p-6 w-full max-w-md mx-auto"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-status-success animate-pulse" />
          <span className="font-mono text-xs text-text-secondary">ESCROW #1042</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary px-2 py-1 rounded-md bg-background-tertiary border border-border-subtle">
          Locked
        </span>
      </div>

      <div className="text-xs text-text-secondary uppercase tracking-widest mb-2">Locked amount</div>
      <div className="mb-6 flex items-baseline">
        <span className="font-mono text-4xl font-bold text-text-primary">25,000.00</span>
        <span className="text-xl text-text-secondary font-sans ml-2">USDC</span>
      </div>

      {/* Route */}
      <div className="bg-background-tertiary border border-border-subtle rounded-xl p-5 flex flex-col gap-3 relative overflow-hidden mb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">From</span>
            <div className="h-7 mt-1 flex items-center gap-2">
              <img
                src="/icons/arc.svg"
                alt="Arc"
                className="w-5 h-5 object-contain pointer-events-none select-none flex-shrink-0"
                draggable="false"
              />
              <span className="font-medium text-text-primary">Arc</span>
            </div>
          </div>

          <div className="flex-1 relative h-7 flex items-center">
            <div className="bg-gradient-to-r from-transparent via-black/20 dark:via-white/20 to-transparent w-full h-[1px]" />
            <motion.div
              initial={{ left: '5%', opacity: 0 }}
              animate={{ left: ['5%', '50%', '95%'], opacity: [0, 1, 0] }}
              transition={{ duration: 2, times: [0, 0.5, 1], repeat: Infinity, repeatDelay: 1, ease: 'easeInOut' }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 bg-accent-blue rounded-full shadow-glow-accent z-10"
            />
          </div>

          <div className="flex flex-col items-end">
            <span className="text-xs text-text-secondary uppercase tracking-wider">To</span>
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
                  <span className="font-medium text-text-primary">{destination.name}</span>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="border-l border-black/10 dark:border-white/10 ml-2 pl-4 flex flex-col gap-3 mt-6">
        {[
          { label: 'Milestone 1', state: 'Released', tone: 'success' },
          { label: 'Milestone 2', state: 'In review', tone: 'pending' },
          { label: 'Milestone 3', state: 'Pending', tone: 'idle' }
        ].map((m) => (
          <div key={m.label} className="relative flex items-center justify-between text-sm text-text-secondary">
            <div className="absolute -left-[21px] top-2 w-2 h-2 rounded-full bg-black/20 dark:bg-white/20" />
            <span>{m.label}</span>
            <span
              className={
                m.tone === 'success'
                  ? 'text-status-success font-medium'
                  : m.tone === 'pending'
                  ? 'text-status-warning font-medium'
                  : 'text-text-tertiary'
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
  const loop = [...TICKER_ITEMS, ...TICKER_ITEMS]
  return (
    <section className="bg-background-secondary border-y border-border-subtle py-3 overflow-hidden">
      <motion.div
        className="flex gap-10 whitespace-nowrap"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ repeat: Infinity, duration: 40, ease: 'linear' }}
      >
        {loop.map((item, i) => (
          <span key={i} className="font-mono text-sm text-text-secondary flex items-center gap-10">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-blue/70" />
              {item}
            </span>
            <span className="text-text-tertiary">•</span>
          </span>
        ))}
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------
   DEVELOPER FLEX: mock code editor with Solidity snippet
   ------------------------------------------------------------ */
function CodeEditor() {
  return (
    <div className="bg-background-primary border border-border-subtle rounded-xl overflow-hidden max-w-4xl mx-auto">
      {/* macOS terminal header */}
      <div className="h-10 bg-background-secondary border-b border-border-subtle flex items-center px-4 gap-2">
        <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
        <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
        <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
        <span className="ml-4 font-mono text-xs text-text-tertiary">CrossChainEscrow.sol</span>
      </div>

      {/* Code body */}
      <pre className="font-mono text-sm leading-relaxed text-text-primary p-6 overflow-x-auto">
        <code>
          <span className="text-text-tertiary">{'// Lock USDC into a milestone-bound, dispute-aware escrow'}</span>
          {'\n'}
          <span className="text-accent-blue">function</span>{' '}
          <span className="text-text-primary">createEscrow</span>
          <span className="text-text-secondary">(</span>
          {'\n    '}
          <span className="text-accent-blue">address</span>{' '}
          <span className="text-text-primary">freelancer</span>
          <span className="text-text-secondary">,</span>
          {'\n    '}
          <span className="text-accent-blue">uint256</span>{' '}
          <span className="text-text-primary">amount</span>
          <span className="text-text-secondary">,</span>
          {'\n    '}
          <span className="text-accent-blue">uint32</span>{' '}
          <span className="text-text-primary">destinationDomain</span>
          <span className="text-text-secondary">,</span>
          {'\n    '}
          <span className="text-accent-blue">bytes32</span>{' '}
          <span className="text-text-primary">receivingAddress</span>
          <span className="text-text-secondary">,</span>
          {'\n    '}
          <span className="text-accent-blue">uint64</span>{' '}
          <span className="text-text-primary">deadline</span>
          <span className="text-text-secondary">,</span>
          {'\n    '}
          <span className="text-accent-blue">uint256</span>
          <span className="text-text-secondary">[]</span>{' '}
          <span className="text-accent-blue">calldata</span>{' '}
          <span className="text-text-primary">milestoneAmounts</span>
          {'\n'}
          <span className="text-text-secondary">{')'}</span>{' '}
          <span className="text-accent-blue">external</span>{' '}
          <span className="text-accent-blue">returns</span>{' '}
          <span className="text-text-secondary">(</span>
          <span className="text-accent-blue">uint256</span>{' '}
          <span className="text-text-primary">escrowId</span>
          <span className="text-text-secondary">{') {'}</span>
          {'\n    '}
          <span className="text-text-primary">require</span>
          <span className="text-text-secondary">(</span>
          <span className="text-text-primary">amount </span>
          <span className="text-text-secondary">{'>'}</span>
          <span className="text-status-warning"> 0</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-status-success">"zero amount"</span>
          <span className="text-text-secondary">);</span>
          {'\n    '}
          <span className="text-text-primary">require</span>
          <span className="text-text-secondary">(</span>
          <span className="text-text-primary">deadline </span>
          <span className="text-text-secondary">{'>'}</span>
          <span className="text-text-primary"> block</span>
          <span className="text-text-secondary">.</span>
          <span className="text-text-primary">timestamp</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-status-success">"past deadline"</span>
          <span className="text-text-secondary">);</span>
          {'\n\n    '}
          <span className="text-text-tertiary">{'// Pull USDC from the payer into the escrow'}</span>
          {'\n    '}
          <span className="text-text-primary">USDC</span>
          <span className="text-text-secondary">.</span>
          <span className="text-text-primary">safeTransferFrom</span>
          <span className="text-text-secondary">(</span>
          <span className="text-text-primary">msg</span>
          <span className="text-text-secondary">.</span>
          <span className="text-text-primary">sender</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-accent-blue">address</span>
          <span className="text-text-secondary">(</span>
          <span className="text-accent-blue">this</span>
          <span className="text-text-secondary">),</span>{' '}
          <span className="text-text-primary">amount</span>
          <span className="text-text-secondary">);</span>
          {'\n\n    '}
          <span className="text-text-primary">escrowId </span>
          <span className="text-text-secondary">=</span>{' '}
          <span className="text-text-primary">_storeEscrow</span>
          <span className="text-text-secondary">(</span>
          <span className="text-text-primary">freelancer</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-text-primary">milestoneAmounts</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-text-primary">deadline</span>
          <span className="text-text-secondary">);</span>
          {'\n    '}
          <span className="text-text-primary">emit </span>
          <span className="text-text-primary">EscrowCreated</span>
          <span className="text-text-secondary">(</span>
          <span className="text-text-primary">escrowId</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-text-primary">msg</span>
          <span className="text-text-secondary">.</span>
          <span className="text-text-primary">sender</span>
          <span className="text-text-secondary">,</span>{' '}
          <span className="text-text-primary">freelancer</span>
          <span className="text-text-secondary">);</span>
          {'\n'}
          <span className="text-text-secondary">{'}'}</span>
        </code>
      </pre>
    </div>
  )
}

/* ------------------------------------------------------------
   LANDING PAGE
   ------------------------------------------------------------ */
export default function Home() {
  return (
    <div className="flex flex-col min-h-screen w-full max-w-full overflow-x-hidden bg-background-primary text-text-primary transition-colors duration-300">
      {/* Marketing top nav */}
      <header className="h-16 border-b border-border-subtle relative z-10">
        <div className="max-w-content mx-auto h-full flex items-center justify-between px-4 md:px-8">
          <Link to="/" className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-accent text-white font-semibold">C</span>
            <span className="font-semibold tracking-tight">CrossChainEscrow</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/dashboard" className="hidden sm:inline-flex btn-secondary text-sm px-4 py-2">Open app</Link>
            <WalletButton />
          </div>
        </div>
      </header>

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
            <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-background-secondary px-3 py-1 text-xs text-text-secondary mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              Live on Arc Testnet
            </span>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-text-primary">
              USDC escrow that enforces the agreement.
            </h1>
            <p className="mt-6 max-w-xl text-lg md:text-xl text-text-secondary">
              Lock funds into milestones. The contract holds them until work is approved, a dispute is resolved, or both sides agree to cancel. No trust required on either side.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3">
              <Link
                to="/create"
                className="inline-flex items-center justify-center rounded-xl px-6 py-3 font-medium bg-accent-blue text-white shadow-lift-md hover:shadow-lift-lg hover:-translate-y-0.5 transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
              >
                Create an Escrow
              </Link>
              <Link to="/dashboard" className="btn-secondary">View Dashboard</Link>
            </div>
            <p className="mt-8 font-mono text-xs text-text-tertiary">
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
      <section className="max-w-content mx-auto w-full px-4 md:px-8 py-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Built so neither side has to trust the other</h2>
          <p className="mt-3 text-text-secondary max-w-2xl mx-auto">
            Every escrow is a single on-chain record. Milestone amounts, deadlines, and dispute rules are set at the start and cannot be changed mid-way.
          </p>
        </div>
        <CodeEditor />
      </section>

      {/* How it works — horizontal numbered stepper.
          No cards. Each step is anchored by a display-scale numeral; thin
          hairline connectors thread between them on desktop. Mobile collapses
          to a single vertical column where the numerals stay oversized so the
          rhythm survives the breakpoint. */}
      <section className="max-w-content mx-auto w-full px-4 md:px-8 pt-12 pb-24">
        <div className="flex items-baseline justify-between gap-6 flex-wrap mb-14">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">How it works</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
            Three on-chain steps
          </span>
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-y-10 md:gap-x-10">
          {STEPS.map((s, i) => (
            <li key={s.n} className="relative flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <span className="font-mono text-text-primary text-5xl md:text-6xl font-semibold tabular-nums tracking-tight leading-none">
                  {s.n}
                </span>
                {/* Hairline connector to the next step. Hidden on the last item
                    and on mobile (the stepper collapses to a vertical stack). */}
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="hidden md:flex flex-1 h-px bg-border-subtle" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-text-primary">{s.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed max-w-prose">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features — asymmetric editorial.
          The lead feature lives un-carded at hero scale, breathing on the page
          background. The remaining five become a typographic 2-column list
          with small inline icons. No card grid; whitespace and weight carry
          hierarchy. */}
      <section className="max-w-content mx-auto w-full px-4 md:px-8 pt-12 pb-24">
        <div className="flex flex-col gap-3 mb-12 md:mb-16">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-blue">
            Built for Arc
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight max-w-2xl">
            Built for how Arc is designed to work
          </h2>
        </div>

        {/* Lead feature: no card wrapper, hero-scale headline, generous air. */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 items-start mb-16 md:mb-20">
          <div className="md:col-span-1 flex md:justify-center">
            <div className="w-14 h-14 flex items-center justify-center rounded-xl bg-accent-muted text-accent-blue">
              <LEAD_FEATURE.Icon />
            </div>
          </div>
          <div className="md:col-span-11 md:pl-2">
            <h3 className="text-2xl md:text-3xl lg:text-[2.5rem] font-semibold text-text-primary leading-tight tracking-tight max-w-3xl">
              {LEAD_FEATURE.title}
            </h3>
            <p className="mt-4 text-base md:text-lg text-text-secondary leading-relaxed max-w-2xl">
              {LEAD_FEATURE.text}
            </p>
          </div>
        </div>

        {/* Supporting features: typographic two-column list, rows separated by
            hairlines instead of card chrome. */}
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 md:gap-x-16 border-t border-border-subtle">
          {FEATURES.map(({ title, text, Icon }) => (
            <li
              key={title}
              className="flex gap-4 py-7 border-b border-border-subtle md:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
            >
              <span className="shrink-0 mt-1 text-accent-blue">
                <Icon />
              </span>
              <div className="flex flex-col gap-2 min-w-0">
                <h4 className="text-base font-semibold text-text-primary">{title}</h4>
                <p className="text-sm text-text-secondary leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Footer */}
      <footer className="mt-auto">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-border-medium to-transparent opacity-50" />
        <div className="max-w-content mx-auto px-4 md:px-8 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <ContractPill address={CONTRACT_ADDRESS} />
          <div className="flex gap-6">
            <Link to="/dashboard" className="text-sm text-text-secondary font-medium hover:text-text-primary transition-colors">Dashboard</Link>
            <Link to="/create" className="text-sm text-text-secondary font-medium hover:text-text-primary transition-colors">Create</Link>
            <Link to="/settings" className="text-sm text-text-secondary font-medium hover:text-text-primary transition-colors">Settings</Link>
          </div>
          <div className="text-sm text-text-tertiary">© CrossChainEscrow</div>
        </div>
      </footer>
    </div>
  )
}
