import { useEffect, useMemo, useState } from "react";
import { useReadContract, useWriteContract } from "wagmi";
import type { Hex } from "viem";
import { motion } from "framer-motion";
import type { Escrow, Milestone } from "../../lib/types";
import { ESCROW_ADDRESS, chainForDomain } from "../../lib/config";
import { escrowAbi } from "../../lib/escrowAbi";
import {
  escrowReference,
  formatUSDC,
  hashString,
  relativeTime,
  shortHash,
} from "../../lib/format";
import { AddressDisplay } from "../../components/AddressDisplay";
import { CopyButton } from "../../components/CopyButton";
import { ConfirmModal } from "../../components/ConfirmModal";
import { fetchForwardFee } from "../../lib/cctpFee";
import { notifyTxError, useTrackedTx } from "../../hooks/useTx";
import { LabelWithTip } from "../../components/InfoTooltip";

interface Props {
  escrow: Escrow;
  milestone: Milestone;
  releaseMode?: boolean;
  onResolved: () => void;
}

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function DisputeCase({ escrow, milestone, releaseMode, onResolved }: Props) {
  const reference = escrowReference(escrow.invoiceHash, escrow.totalAmount);

  const dispute = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "disputes",
    args: [escrow.id, BigInt(milestone.index)],
    query: { enabled: !releaseMode },
  });

  const disp = useMemo(() => {
    if (releaseMode || !dispute.data) return null;
    const arr = dispute.data as unknown as readonly unknown[];
    return {
      disputedBy: arr[0] as `0x${string}`,
      evidenceHash: arr[1] as `0x${string}`,
      evidenceURI: arr[2] as string,
      reason: arr[3] as string,
      counterEvidenceHash: arr[4] as `0x${string}`,
      counterEvidenceURI: arr[5] as string,
      resolutionHash: arr[6] as `0x${string}`,
    };
  }, [dispute.data, releaseMode]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-amber p-6"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted mb-1">
            Escrow #{escrow.id.toString()} · Milestone {milestone.index + 1}
          </div>
          <div className="font-display text-xl text-fg-strong">{reference}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl text-gold-soft mono-amount">
            {formatUSDC(milestone.amount, false)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted">
            milestone amount
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-5 text-sm">
        <Field label="Depositor">
          <AddressDisplay address={escrow.depositor} />
        </Field>
        <Field label="Recipient">
          <AddressDisplay address={escrow.recipient} />
        </Field>
      </div>

      {!releaseMode && disp && (
        <>
          <div className="rounded-xl bg-bg-deep/40 border border-gold/10 p-4 mb-5">
            <div className="text-[11px] uppercase tracking-widest text-muted mb-2">
              Dispute filed by
            </div>
            <div className="flex items-center gap-2 mb-3">
              <AddressDisplay address={disp.disputedBy} />
              <span className="text-xs text-muted">·</span>
              <span className="text-xs text-muted">
                {milestone.conditionMetTimestamp > 0n
                  ? relativeTime(Number(milestone.conditionMetTimestamp))
                  : "recently"}
              </span>
            </div>
            {disp.reason && (
              <div className="text-sm text-fg italic mb-3">"{disp.reason}"</div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <EvField label="Evidence URI" link value={disp.evidenceURI} />
              <EvField
                label="Evidence hash"
                value={shortHash(disp.evidenceHash)}
                copy={disp.evidenceHash}
              />
              {disp.counterEvidenceHash !== ZERO && (
                <>
                  <EvField label="Counter-evidence URI" link value={disp.counterEvidenceURI} />
                  <EvField
                    label="Counter-evidence hash"
                    value={shortHash(disp.counterEvidenceHash)}
                    copy={disp.counterEvidenceHash}
                  />
                </>
              )}
            </div>
          </div>

          <ResolveForm
            escrowId={escrow.id}
            milestoneIndex={milestone.index}
            destinationDomain={escrow.destinationDomain}
            onResolved={onResolved}
          />
        </>
      )}

      {releaseMode && (
        <ReleaseAfterWindowButton
          escrowId={escrow.id}
          milestoneIndex={milestone.index}
          destinationDomain={escrow.destinationDomain}
          milestoneAmount={milestone.amount}
          onResolved={onResolved}
        />
      )}
    </motion.div>
  );
}

function ResolveForm({
  escrowId,
  milestoneIndex,
  destinationDomain,
  onResolved,
}: {
  escrowId: bigint;
  milestoneIndex: number;
  destinationDomain: number;
  onResolved: () => void;
}) {
  // Look up the milestone amount from the parent context via a small read so
  // we can show the precise USDC figure inside the confirmation modal.
  const milestoneRead = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "milestones",
    args: [escrowId, BigInt(milestoneIndex)],
  });
  const milestoneAmount =
    milestoneRead.data
      ? ((milestoneRead.data as unknown as readonly unknown[])[0] as bigint)
      : 0n;
  const escrowRead = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "escrows",
    args: [escrowId],
  });
  const recipientShort = escrowRead.data
    ? ((escrowRead.data as unknown as readonly unknown[])[1] as string)
    : "";

  const [decision, setDecision] = useState<"release" | "refund">("release");
  const [reasoning, setReasoning] = useState("");
  const [customHash, setCustomHash] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Forwarding fee is only relevant when releasing to the recipient. When
  // refunding the depositor we just credit the on-Arc refundBalances mapping
  // so the maxFee is unused on chain (we still pass 0 for safety).
  const [maxFee, setMaxFee] = useState<bigint | null>(null);
  const [feeError, setFeeError] = useState(false);

  useEffect(() => {
    if (decision !== "release") {
      setMaxFee(0n);
      setFeeError(false);
      return;
    }
    let cancelled = false;
    setMaxFee(null);
    setFeeError(false);
    fetchForwardFee(destinationDomain).then((v) => {
      if (cancelled) return;
      if (v === null) setFeeError(true);
      setMaxFee(v ?? 0n);
    });
    return () => {
      cancelled = true;
    };
  }, [decision, destinationDomain]);

  const chain = chainForDomain(destinationDomain);
  const willReceive =
    decision === "release" && maxFee !== null && maxFee < milestoneAmount
      ? milestoneAmount - maxFee
      : null;

  const resolutionHash: Hex | "" = useCustom
    ? /^0x[0-9a-fA-F]{64}$/.test(customHash)
      ? (customHash as Hex)
      : ""
    : reasoning
      ? hashString(reasoning)
      : "";

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Dispute resolved",
    onSuccess: () => {
      setConfirmOpen(false);
      onResolved();
    },
  });

  const valid = !!resolutionHash && maxFee !== null;
  const submit = () =>
    writeContract(
      {
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "resolveDispute",
        args: [
          escrowId,
          BigInt(milestoneIndex),
          decision === "release",
          resolutionHash as Hex,
          maxFee ?? 0n,
        ],
      },
      { onError: notifyTxError },
    );

  return (
    <div className="grid gap-3">
      <div className="text-[11px] uppercase tracking-widest text-gold-soft">
        Resolution
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setDecision("release")}
          className={`p-4 rounded-xl border text-left transition-colors ${
            decision === "release"
              ? "border-ok/40 bg-ok/10"
              : "border-line bg-surface/40"
          }`}
        >
          <div className="text-sm font-medium text-fg-strong mb-1">Release to recipient</div>
          <div className="text-xs text-muted-soft">
            The recipient gets the milestone (minus protocol fee).
          </div>
        </button>
        <button
          type="button"
          onClick={() => setDecision("refund")}
          className={`p-4 rounded-xl border text-left transition-colors ${
            decision === "refund"
              ? "border-bad/40 bg-bad/10"
              : "border-line bg-surface/40"
          }`}
        >
          <div className="text-sm font-medium text-fg-strong mb-1">Refund to depositor</div>
          <div className="text-xs text-muted-soft">
            The full milestone amount is refunded.
          </div>
        </button>
      </div>

      {decision === "release" && (
        <div className="rounded-xl bg-warn/5 border border-warn/15 p-3 text-xs text-warn-soft">
          The release goes to{" "}
          <span className="text-fg-strong">{chain.name}</span> via Circle's
          forwarding service. A small forwarding fee is deducted from the
          minted USDC on the destination chain.
          {maxFee !== null && (
            <div className="mt-1.5 text-muted-soft">
              Estimated fee:{" "}
              <span className="mono-amount text-fg">
                {formatUSDC(maxFee, false)}
              </span>{" "}
              USDC
              {willReceive && (
                <>
                  {" · "}Recipient gets about{" "}
                  <span className="mono-amount text-fg">
                    {formatUSDC(willReceive, false)}
                  </span>{" "}
                  USDC
                </>
              )}
            </div>
          )}
          {feeError && (
            <div className="mt-1.5 text-muted-soft">
              Could not fetch the live fee from Circle. The release will still
              succeed; the actual fee will be deducted on the destination
              chain.
            </div>
          )}
        </div>
      )}

      <div>
        <LabelWithTip tooltip="A hash of your written decision and reasoning. Store your reasoning document somewhere permanent and paste its hash here. This makes your decision auditable on chain.">
          Resolution hash
        </LabelWithTip>
        <div className="flex items-center gap-2 mb-2 text-xs">
          <button
            type="button"
            onClick={() => setUseCustom(false)}
            className={`px-2.5 py-1 rounded ${!useCustom ? "bg-gold/15 text-gold-soft" : "text-muted"}`}
          >
            Hash my reasoning
          </button>
          <button
            type="button"
            onClick={() => setUseCustom(true)}
            className={`px-2.5 py-1 rounded ${useCustom ? "bg-gold/15 text-gold-soft" : "text-muted"}`}
          >
            Paste custom hash
          </button>
        </div>
        {useCustom ? (
          <input
            className="input font-mono"
            placeholder="0x… (64 hex chars)"
            value={customHash}
            onChange={(e) => setCustomHash(e.target.value.trim())}
          />
        ) : (
          <textarea
            className="input min-h-[100px]"
            placeholder="Your written reasoning. Hashed and stored on-chain as the resolution proof."
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
          />
        )}
        {resolutionHash && (
          <div className="text-xs text-muted font-mono mt-2 truncate">
            Resolution hash: {resolutionHash}
          </div>
        )}
      </div>

      <button
        className="btn btn-gold"
        disabled={!valid || isPending || tx.isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending || tx.isLoading
          ? "Submitting…"
          : decision === "release" && maxFee === null
            ? "Fetching fee…"
            : decision === "release"
              ? "Resolve, release to recipient"
              : "Resolve, refund to depositor"}
      </button>

      <ConfirmModal
        open={confirmOpen}
        title={
          decision === "release"
            ? "Release payment to recipient?"
            : "Refund to depositor?"
        }
        body={
          <>
            You are about to{" "}
            {decision === "release" ? (
              <>
                <span className="text-fg-strong">release</span>{" "}
                <span className="mono-amount text-fg-strong">
                  {formatUSDC(milestoneAmount)}
                </span>{" "}
                to the recipient on{" "}
                <span className="text-fg-strong">{chain.name}</span>
                {recipientShort
                  ? ` (${recipientShort.slice(0, 6)}…${recipientShort.slice(-4)})`
                  : ""}
                . Circle's forwarding service will deliver the mint
                automatically; a small forwarding fee
                {maxFee !== null && maxFee > 0n ? (
                  <>
                    {" "}(about{" "}
                    <span className="mono-amount text-fg-strong">
                      {formatUSDC(maxFee, false)}
                    </span>{" "}
                    USDC)
                  </>
                ) : null}{" "}
                is deducted from the minted USDC on the destination chain.
              </>
            ) : (
              <>
                <span className="text-fg-strong">refund</span>{" "}
                <span className="mono-amount text-fg-strong">
                  {formatUSDC(milestoneAmount)}
                </span>{" "}
                to the depositor.
              </>
            )}{" "}
            This action is final and cannot be undone. Proceed?
          </>
        }
        confirmLabel={
          decision === "release" ? "Yes, release payment" : "Yes, refund deposit"
        }
        tone={decision === "release" ? "primary" : "danger"}
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submit}
      />
    </div>
  );
}

function ReleaseAfterWindowButton({
  escrowId,
  milestoneIndex,
  destinationDomain,
  milestoneAmount,
  onResolved,
}: {
  escrowId: bigint;
  milestoneIndex: number;
  destinationDomain: number;
  milestoneAmount: bigint;
  onResolved: () => void;
}) {
  const [maxFee, setMaxFee] = useState<bigint | null>(null);
  const [feeError, setFeeError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMaxFee(null);
    setFeeError(false);
    fetchForwardFee(destinationDomain).then((v) => {
      if (cancelled) return;
      if (v === null) setFeeError(true);
      setMaxFee(v ?? 0n);
    });
    return () => {
      cancelled = true;
    };
  }, [destinationDomain]);

  const chain = chainForDomain(destinationDomain);
  const willReceive =
    maxFee !== null && maxFee < milestoneAmount
      ? milestoneAmount - maxFee
      : null;

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Milestone released",
    onSuccess: onResolved,
  });

  return (
    <div className="rounded-xl bg-bg-deep/40 border border-gold/10 p-4 flex flex-col gap-3">
      <div className="text-sm text-muted-soft">
        The review period expired without a dispute. Trigger the release to{" "}
        <span className="text-fg-strong">{chain.name}</span>.
      </div>
      <div className="text-xs text-muted-soft">
        {maxFee !== null ? (
          <>
            Estimated forwarding fee:{" "}
            <span className="mono-amount text-fg">
              {formatUSDC(maxFee, false)}
            </span>{" "}
            USDC
            {willReceive && (
              <>
                {" · "}Recipient gets about{" "}
                <span className="mono-amount text-fg">
                  {formatUSDC(willReceive, false)}
                </span>{" "}
                USDC
              </>
            )}
          </>
        ) : feeError ? (
          "Could not fetch the live fee. The release will still succeed."
        ) : (
          "Fetching forwarding fee…"
        )}
      </div>
      <button
        className="btn btn-gold self-start"
        disabled={isPending || tx.isLoading || maxFee === null}
        onClick={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "releaseAfterWindow",
              args: [escrowId, BigInt(milestoneIndex), maxFee ?? 0n],
            },
            { onError: notifyTxError },
          )
        }
      >
        {isPending || tx.isLoading
          ? "Releasing…"
          : maxFee === null
            ? "Fetching fee…"
            : "Release Payment"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function EvField({
  label,
  value,
  link,
  copy,
}: {
  label: string;
  value: string;
  link?: boolean;
  copy?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-widest text-[10px] text-muted mb-1">{label}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        {link && value ? (
          <a href={value} target="_blank" rel="noreferrer" className="font-mono text-gold-soft truncate">
            {value}
          </a>
        ) : (
          <span className="font-mono text-fg truncate">{value || "Not set"}</span>
        )}
        {copy && <CopyButton value={copy} label={label} />}
      </div>
    </div>
  );
}
