import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { motion } from "framer-motion";
import { isAddress, type Address } from "viem";
import { useRefundBalance } from "../hooks/useEscrows";
import { ConnectGate } from "../components/ConnectGate";
import { LabelWithTip } from "../components/InfoTooltip";
import { ESCROW_ADDRESS } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { formatUSDC } from "../lib/format";
import { notifyTxError, useTrackedTx } from "../hooks/useTx";

export function Withdraw() {
  const { address, isConnected } = useAccount();
  const { data: balance, refetch } = useRefundBalance(address);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Refund withdrawn",
    onSuccess: () => refetch(),
  });

  const [destination, setDestination] = useState<string>(address ?? "");

  // Pre-fill destination with the connected wallet whenever it changes.
  useEffect(() => {
    if (address) setDestination(address);
  }, [address]);

  if (!isConnected) return <ConnectGate title="Connect to view your refunds" />;

  const amount = (balance as bigint | undefined) ?? 0n;
  const has = amount > 0n;
  const destinationValid = isAddress(destination);

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="font-display text-4xl text-fg-strong tracking-tight mb-2">
        Refunds
      </h1>
      <p className="text-muted-soft mb-8">
        When a milestone is refunded, by mutual cancellation or arbiter ruling,
        the amount accumulates here and is yours to claim at any time.
      </p>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass p-8"
      >
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-3">
          Pending refund balance
        </div>
        <div className="font-display text-5xl text-fg-strong mono-amount mb-6">
          {formatUSDC(amount, false)}{" "}
          <span className="text-base text-muted-soft font-sans">USDC</span>
        </div>

        {has ? (
          <div className="grid gap-4">
            <div>
              <LabelWithTip tooltip="Your refund goes to your connected wallet by default. Change this only if your wallet has issues receiving USDC.">
                Send refund to
              </LabelWithTip>
              <input
                className="input font-mono"
                placeholder="0x…"
                value={destination}
                onChange={(e) => setDestination(e.target.value.trim())}
              />
              {destination && !destinationValid && (
                <p className="text-xs text-bad-soft mt-1">
                  Not a valid address.
                </p>
              )}
            </div>

            <button
              className="btn btn-primary w-full"
              disabled={
                isPending || tx.isLoading || !destinationValid
              }
              onClick={() =>
                writeContract(
                  {
                    address: ESCROW_ADDRESS,
                    abi: escrowAbi,
                    functionName: "withdrawRefund",
                    args: [destination as Address],
                  },
                  { onError: notifyTxError },
                )
              }
            >
              {isPending || tx.isLoading
                ? "Withdrawing…"
                : `Withdraw ${formatUSDC(amount, false)} USDC`}
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-surface/40 border border-line p-4 text-sm text-muted-soft text-center">
            No pending refunds for this wallet.
          </div>
        )}
      </motion.div>
    </div>
  );
}
