import { ConnectButton } from "@rainbow-me/rainbowkit";

export function ConnectGate({
  title = "Connect your wallet",
  hint = "Connect to interact with the CrossChainEscrow protocol on Arc Testnet.",
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className="glass p-12 text-center max-w-xl mx-auto mt-10">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-accent">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
        </svg>
      </div>
      <h2 className="font-display text-2xl text-fg-strong mb-2">{title}</h2>
      <p className="text-sm text-muted-soft mb-6 max-w-md mx-auto">{hint}</p>
      <div className="flex justify-center">
        <ConnectButton showBalance={false} chainStatus="icon" />
      </div>
    </div>
  );
}
