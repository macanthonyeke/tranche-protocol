import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import { arcTestnet } from '../config/wagmi'
import { truncateAddr } from '../utils/format'

export default function WalletButton() {
  // useAccount().chainId, NOT wagmi's useChainId(): useChainId() only syncs
  // when the wallet's real chain is registered in config.chains (wagmi.js
  // registers only arcTestnet), so a wallet on any other chain never syncs
  // and useChainId() keeps reporting the arcTestnet default forever — this
  // would show "Arc Testnet" here even on a mainnet wallet. Same fix as
  // useTx.js's run() and AppShell.jsx's WrongNetworkBanner.
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
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

  const networkLabel = chainId === arcTestnet.id ? 'Arc Testnet' : `Chain ${chainId}`
  const SLIDE = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!isConnected ? (
        <motion.button
          key="disconnected"
          {...SLIDE}
          onClick={onConnect}
          disabled={isPending}
          className="btn-primary text-sm px-4 py-2"
        >
          {isPending ? 'Connecting...' : 'Connect Wallet'}
        </motion.button>
      ) : (
        <motion.div key="connected" {...SLIDE} className="relative" ref={ref}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2
                       border border-rule bg-paper
                       hover:bg-sunk
                       transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <span className="h-2 w-2 rounded-full bg-ok" />
            <span className="font-mono text-sm">{truncateAddr(address)}</span>
          </button>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 card-surface p-4 flex flex-col gap-3"
              >
                <div>
                  <div className="text-xs text-ink-2">Network</div>
                  <div className="text-sm text-ink">{networkLabel}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-2 mb-1">Address</div>
                  <button
                    onClick={copy}
                    className="w-full text-left bg-sunk rounded-md p-2 font-mono text-xs break-all hover:bg-rule transition-colors"
                  >
                    {address}
                    <span className="ml-2 text-clay">{copied ? 'Copied' : 'Copy address'}</span>
                  </button>
                </div>
                <button
                  onClick={() => { disconnect(); setOpen(false) }}
                  className="btn-danger w-full text-sm py-2"
                >
                  Disconnect wallet
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
