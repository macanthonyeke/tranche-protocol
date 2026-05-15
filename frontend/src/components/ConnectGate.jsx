import { useAccount } from 'wagmi'
import WalletButton from './WalletButton.jsx'

export default function ConnectGate({ children, title = 'Connect your wallet', message = 'Connect your wallet to continue.' }) {
  const { isConnected } = useAccount()
  if (isConnected) return children
  return (
    <div className="card-surface p-10 text-center max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-2 text-text-primary">{title}</h2>
      <p className="text-sm text-text-secondary mb-6">{message}</p>
      <div className="inline-flex justify-center">
        <WalletButton />
      </div>
    </div>
  )
}
