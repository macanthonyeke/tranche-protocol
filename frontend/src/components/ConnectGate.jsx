import { useAccount } from 'wagmi'
import WalletButton from './WalletButton.jsx'

export default function ConnectGate({ children, title = 'Wallet not connected', message = 'You need a connected wallet to use this page.' }) {
  const { isConnected } = useAccount()
  if (isConnected) return children
  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-2 text-ink">{title}</h2>
      <p className="text-sm text-ink-2 mb-6">{message}</p>
      <div className="inline-flex justify-center">
        <WalletButton />
      </div>
    </div>
  )
}
