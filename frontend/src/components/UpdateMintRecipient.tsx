import { useState } from "react";
import { useWriteContract } from "wagmi";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import type { Escrow } from "../lib/types";
import { EscrowState } from "../lib/types";
import { ESCROW_ADDRESS, chainForDomain } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { addressToBytes32, bytes32ToAddress } from "../lib/format";
import { ChainSelect } from "./ChainSelect";
import { ConfirmModal } from "./ConfirmModal";
import { LabelWithTip } from "./InfoTooltip";
import { CopyButton } from "./CopyButton";
import { notifyTxError, useTrackedTx } from "../hooks/useTx";

interface Props {
  escrow: Escrow;
  onUpdated: () => void;
}

/// Recipient-only "Payment Destination" panel. Lets the recipient update
/// where future milestone payouts are minted (e.g. if their wallet was
/// blacklisted or they want to switch chain). Only visible when the escrow
/// is ACTIVE.
export function UpdateMintRecipient({ escrow, onUpdated }: Props) {
  const { address } = useAccount();
  const isRecipient =
    address && address.toLowerCase() === escrow.recipient.toLowerCase();

  const [editing, setEditing] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newDomain, setNewDomain] = useState<number>(escrow.destinationDomain);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Payment destination updated",
    onSuccess: () => {
      setConfirmOpen(false);
      setEditing(false);
      setNewAddress("");
      onUpdated();
    },
  });

  if (!isRecipient || escrow.state !== EscrowState.ACTIVE) return null;

  const currentChain = chainForDomain(escrow.destinationDomain);
  const newChain = chainForDomain(newDomain);
  const currentAddress = bytes32ToAddress(escrow.mintRecipient);
  const valid = isAddress(newAddress) && newAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000";

  return (
    <section className="glass p-6 mt-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="font-display text-xl text-fg-strong">
            Payment Destination
          </h2>
          <p className="text-sm text-muted-soft mt-1">
            The wallet and chain where future milestone payouts will be sent.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setEditing(true)}
          >
            Update
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="label">Current address</div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm text-fg truncate">
              {currentAddress}
            </span>
            <CopyButton value={currentAddress} label="address" />
          </div>
        </div>
        <div>
          <div className="label">Current chain</div>
          <div className="text-sm text-fg">{currentChain.name}</div>
        </div>
      </div>

      {editing && (
        <div className="mt-6 grid gap-4">
          <div>
            <LabelWithTip tooltip="Enter the wallet address that should receive your USDC on the destination chain. Make sure this address is correct and valid on that chain. This cannot be undone.">
              New recipient address on destination chain
            </LabelWithTip>
            <input
              className="input font-mono"
              placeholder="0x…"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value.trim())}
            />
            {newAddress && !isAddress(newAddress) && (
              <p className="text-xs text-bad-soft mt-1">Not a valid address.</p>
            )}
          </div>

          <div>
            <LabelWithTip tooltip="The blockchain where you want future milestone payments sent. Choose Arc Testnet for same-chain payments. Cross-chain choices use the Circle Forwarding Service.">
              Destination chain
            </LabelWithTip>
            <ChainSelect value={newDomain} onChange={setNewDomain} />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!valid || isPending || tx.isLoading}
              onClick={() => setConfirmOpen(true)}
            >
              {isPending || tx.isLoading ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditing(false);
                setNewAddress("");
                setNewDomain(escrow.destinationDomain);
              }}
              disabled={isPending || tx.isLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Update payment destination?"
        body={
          <>
            You are updating the payment destination for this escrow.
            <div className="mt-3 grid gap-1 text-sm">
              <div>
                <span className="text-muted-soft">New address:</span>{" "}
                <span className="font-mono">{newAddress || "..."}</span>
              </div>
              <div>
                <span className="text-muted-soft">New chain:</span>{" "}
                {newChain.name}
              </div>
            </div>
            <p className="mt-3 text-sm">
              This affects all future milestone releases. Are you sure?
            </p>
          </>
        }
        confirmLabel="Yes, update"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "updateMintRecipient",
              args: [
                escrow.id,
                addressToBytes32(newAddress as Address),
                newDomain,
              ],
            },
            { onError: notifyTxError },
          )
        }
      />
    </section>
  );
}
