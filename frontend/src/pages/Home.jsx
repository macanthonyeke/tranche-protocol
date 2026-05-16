import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import AddressDisplay from '../components/AddressDisplay.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { CONTRACT_ADDRESS } from '../config/wagmi.js'

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
  { n: '01', title: 'Payer locks USDC', text: 'Set milestones, a deadline, and the freelancer\'s payment chain. Funds sit safely in escrow until they\'re released.' },
  { n: '02', title: 'Freelancer delivers', text: 'Mark each milestone as delivered. The payer reviews, then approves or opens a dispute.' },
  { n: '03', title: 'Funds release', text: 'Approved milestones pay out via CCTP to the freelancer\'s chosen chain. Disputed work goes to a neutral arbiter.' }
]

const FEATURES = [
  { title: 'Evidence-required disputes', text: 'Disputes can\'t be opened without a stated reason and on-chain evidence reference. Counter-evidence is mandatory before resolution.' },
  { title: 'Silent approval protection', text: 'If the payer goes quiet after delivery, anyone can claim auto-release once the notice window expires. No more chasing.' },
  { title: 'Cross-chain payouts', text: 'Get paid on the chain you actually use. Circle CCTP V2 forwards your release to any supported destination — no manual bridging.' },
  { title: 'Pull-pattern refunds', text: 'Refunds go to a balance you withdraw at your convenience — to whichever address you control, so a frozen wallet can\'t trap your funds.' }
]

/* ------------------------------------------------------------
   HERO: floating mock escrow card (right column visual)
   ------------------------------------------------------------ */
function HeroVisual() {
  return (
    <motion.div
      animate={{ y: [-8, 8, -8] }}
      transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
      className="bg-background-secondary border border-border-subtle shadow-xl rounded-2xl p-6 w-full max-w-md mx-auto"
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

      <div className="text-text-tertiary text-xs uppercase tracking-wider mb-1">Locked amount</div>
      <div className="text-3xl font-semibold text-text-primary mb-6">
        25,000.00 <span className="text-base font-mono text-text-secondary">USDC</span>
      </div>

      {/* Route */}
      <div className="rounded-xl bg-background-tertiary border border-border-subtle p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-text-tertiary mb-1">From</div>
            <div className="text-sm font-medium text-text-primary">Arbitrum</div>
          </div>
          <div className="flex-1 mx-4 relative">
            <div className="h-px bg-border-medium" />
            <motion.div
              animate={{ x: ['-30%', '130%'] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
              className="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-accent-blue shadow-[0_0_12px_2px_var(--accent-blue)]"
            />
          </div>
          <div className="text-right">
            <div className="text-xs text-text-tertiary mb-1">To</div>
            <div className="text-sm font-medium text-text-primary">Optimism</div>
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="space-y-2">
        {[
          { label: 'Milestone 1', state: 'Released', tone: 'success' },
          { label: 'Milestone 2', state: 'In review', tone: 'pending' },
          { label: 'Milestone 3', state: 'Pending', tone: 'idle' }
        ].map((m) => (
          <div key={m.label} className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{m.label}</span>
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
    <div className="bg-background-tertiary rounded-xl border border-border-subtle overflow-hidden shadow-2xl max-w-3xl mx-auto">
      {/* Mac header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-background-secondary">
        <span className="h-3 w-3 rounded-full bg-status-error/80" />
        <span className="h-3 w-3 rounded-full bg-status-warning/80" />
        <span className="h-3 w-3 rounded-full bg-status-success/80" />
        <span className="ml-4 font-mono text-xs text-text-tertiary">CrossChainEscrow.sol</span>
      </div>

      {/* Code body */}
      <pre className="font-mono text-sm leading-relaxed text-text-primary px-6 py-5 overflow-x-auto">
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
    <div className="flex flex-col min-h-screen bg-background-primary text-text-primary transition-colors duration-300">
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
      <section className="relative overflow-hidden">
        {/* Premium radial glow */}
        <div
          aria-hidden
          className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-accent-blue/10 dark:bg-accent-blue/20 blur-3xl rounded-full pointer-events-none"
        />

        <div className="relative lg:grid lg:grid-cols-2 lg:gap-12 lg:items-center py-24 px-8 max-w-[1200px] mx-auto">
          {/* Left: copy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="flex flex-col items-start text-left"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-background-secondary px-3 py-1 text-xs text-text-secondary mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              Live on Arc Testnet
            </span>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-text-primary">
              Trustless Cross-Chain Payments.
            </h1>
            <p className="mt-6 max-w-xl text-lg md:text-xl text-text-secondary">
              Milestone-based USDC escrow with built-in dispute resolution and CCTP V2 routing.
              No Discord. No trust required.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3">
              <Link
                to="/create"
                className="inline-flex items-center justify-center rounded-xl px-6 py-3 font-medium bg-accent-blue text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
              >
                Create an Escrow
              </Link>
              <Link to="/dashboard" className="btn-secondary">View Dashboard</Link>
            </div>
            <p className="mt-8 font-mono text-xs text-text-tertiary">
              Deployed on Arc Testnet · Powered by CCTP V2
            </p>
          </motion.div>

          {/* Right: floating visual */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.15 }}
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
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Engineered for Certainty</h2>
          <p className="mt-3 text-text-secondary max-w-2xl mx-auto">
            Auditable, minimal, and verifiable on-chain. Every escrow is one immutable record — locked, milestone-tracked, and CCTP-routable.
          </p>
        </div>
        <CodeEditor />
      </section>

      {/* How it works */}
      <section className="max-w-content mx-auto w-full px-4 md:px-8 py-16">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-10">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((s) => (
            <div key={s.n} className="card-surface p-6 flex flex-col gap-3">
              <div className="font-mono text-accent text-sm">{s.n}</div>
              <h3 className="text-xl font-semibold">{s.title}</h3>
              <p className="text-sm text-text-secondary">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-content mx-auto w-full px-4 md:px-8 py-16">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-10">Why it's different</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="card-surface p-6 flex flex-col gap-2">
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="text-sm text-text-secondary">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border-subtle py-8">
        <div className="max-w-content mx-auto px-4 md:px-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="text-xs text-text-tertiary mb-1">Contract</div>
            <AddressDisplay address={CONTRACT_ADDRESS} full size="sm" />
          </div>
          <div className="flex gap-6">
            <Link to="/dashboard" className="text-sm text-text-secondary hover:text-text-primary">Dashboard</Link>
            <Link to="/create" className="text-sm text-text-secondary hover:text-text-primary">Create</Link>
            <Link to="/settings" className="text-sm text-text-secondary hover:text-text-primary">Settings</Link>
          </div>
          <div className="text-xs text-text-tertiary">© CrossChainEscrow</div>
        </div>
      </footer>
    </div>
  )
}
