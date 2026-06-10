import { useAccount } from 'wagmi'
import WalletButton from './WalletButton.jsx'

export default function ConnectGate({ children, title = 'Wallet not connected', message = 'You need a connected wallet to use this page.' }) {
  const { isConnected } = useAccount()
  if (isConnected) return children
  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-2 text-ink">{title}</h2>
      <p className="text-sm text-ink-2 mb-6">{message}</p>
      <div className="inline-flex justify-center mb-6">
        <WalletButton />
      </div>
      <p className="text-[12.5px] text-ink-3 leading-relaxed">
        Gas on Arc is paid in USDC.{' '}
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="text-clay hover:opacity-80 underline-offset-2 hover:underline"
        >
          Get testnet USDC ↗
        </a>
      </p>
    </div>
  )
}
