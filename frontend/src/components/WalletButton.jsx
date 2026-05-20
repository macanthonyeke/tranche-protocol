import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useChainId } from 'wagmi'
import { arcTestnet } from '../config/wagmi'
import { truncateAddr } from '../utils/format'

export default function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const onConnect = () => {
    const injected = connectors.find((c) => c.id === 'injected') || connectors[0]
    if (injected) connect({ connector: injected })
  }

  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }

  if (!isConnected) {
    return (
      <button
        onClick={onConnect}
        disabled={isPending}
        className="btn-primary text-sm px-4 py-2"
      >
        {isPending ? 'Connecting...' : 'Connect Wallet'}
      </button>
    )
  }

  const networkLabel = chainId === arcTestnet.id ? 'Arc Testnet' : `Chain ${chainId}`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2
                   border border-border-subtle bg-background-secondary
                   hover:bg-background-tertiary
                   transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary"
      >
        <span className="h-2 w-2 rounded-full bg-status-success" />
        <span className="font-mono text-sm">{truncateAddr(address)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 card-surface p-4 flex flex-col gap-3">
          <div>
            <div className="text-xs text-text-secondary">Network</div>
            <div className="text-sm text-text-primary">{networkLabel}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary mb-1">Address</div>
            <button
              onClick={copy}
              className="w-full text-left bg-background-tertiary rounded-md p-2 font-mono text-xs break-all hover:bg-border-subtle transition-colors"
            >
              {address}
              <span className="ml-2 text-accent">{copied ? 'Copied' : 'Copy address'}</span>
            </button>
          </div>
          <button
            onClick={() => { disconnect(); setOpen(false) }}
            className="btn-danger w-full text-sm py-2"
          >
            Disconnect wallet
          </button>
        </div>
      )}
    </div>
  )
}
