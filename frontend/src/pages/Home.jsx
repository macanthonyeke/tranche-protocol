import { Link } from 'react-router-dom'
import AddressDisplay from '../components/AddressDisplay.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import WalletButton from '../components/WalletButton.jsx'
import { CONTRACT_ADDRESS } from '../config/wagmi.js'

const STATS = [
  { label: 'Settled on-chain', value: '$1.2M+', sub: 'USDC routed via escrow' },
  { label: 'Cross-chain', value: 'CCTP V2', sub: 'No manual bridging' },
  { label: 'Disputes resolved', value: '100%', sub: 'Evidence required' }
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

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background-primary text-text-primary">
      {/* Marketing top nav */}
      <header className="h-16 border-b border-border-subtle">
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

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center py-20 px-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-background-secondary px-3 py-1 text-xs text-text-secondary mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
          Live on Arc Testnet
        </span>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-text-primary max-w-4xl">
          Get paid. On chain.<br/>Without the chase.
        </h1>
        <p className="mt-6 max-w-2xl text-lg md:text-xl text-text-secondary">
          Milestone-based USDC escrow with built-in dispute resolution.
          No Discord. No trust required.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-3">
          <Link to="/create" className="btn-primary">Create an Escrow</Link>
          <Link to="/dashboard" className="btn-secondary">View Dashboard</Link>
        </div>
        <p className="mt-8 font-mono text-xs text-text-tertiary">
          Deployed on Arc Testnet · Powered by CCTP V2
        </p>

        {/* Stats */}
        <div className="flex flex-col md:flex-row justify-center gap-6 mt-12 w-full max-w-4xl">
          {STATS.map((s) => (
            <div key={s.label} className="card-surface p-6 flex-1 max-w-sm mx-auto md:mx-0">
              <div className="text-3xl font-semibold text-text-primary">{s.value}</div>
              <div className="text-sm text-text-secondary mt-1">{s.label}</div>
              <div className="text-xs text-text-tertiary mt-2">{s.sub}</div>
            </div>
          ))}
        </div>
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
