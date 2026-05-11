import { useEffect, useState } from "react";
import { useWriteContract } from "wagmi";
import { motion } from "framer-motion";
import type { Hex } from "viem";
import type { Escrow, Milestone } from "../lib/types";
import { EscrowState, MilestoneState } from "../lib/types";
import { ESCROW_ADDRESS, chainForDomain } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { formatUSDC, hashString, timeUntil } from "../lib/format";
import { fetchForwardFee } from "../lib/cctpFee";
import { notifyTxError, useTrackedTx } from "../hooks/useTx";
import { ConfirmModal } from "./ConfirmModal";
import { LabelWithTip } from "./InfoTooltip";

type Role = "depositor" | "recipient" | "both" | "none";

interface Props {
  escrow: Escrow;
  milestones: Milestone[];
  role: Role;
  onAction: () => void;
}

export function ActionPanel({ escrow, milestones, role, onAction }: Props) {
  if (escrow.state !== EscrowState.ACTIVE) {
    return (
      <div className="glass p-6 text-sm text-muted-soft">
        This escrow is{" "}
        <span
          className={
            escrow.state === EscrowState.COMPLETED
              ? "text-ok-soft"
              : "text-bad-soft"
          }
        >
          {escrow.state === EscrowState.COMPLETED ? "completed" : "cancelled"}
        </span>
        . No further actions are available.
      </div>
    );
  }

  if (role === "none") {
    return (
      <ReleaseAfterWindowOnly
        escrow={escrow}
        milestones={milestones}
        onAction={onAction}
      />
    );
  }

  const cancelPending =
    escrow.depositorApproveCancel && escrow.recipientApproveCancel;
  const myCancelFlagged =
    role === "depositor"
      ? escrow.depositorApproveCancel
      : escrow.recipientApproveCancel;

  const nextActionableIdx = milestones.findIndex(
    (m) =>
      m.state === MilestoneState.PENDING ||
      m.state === MilestoneState.FULFILLED ||
      m.state === MilestoneState.DISPUTED,
  );
  const target = nextActionableIdx === -1 ? null : milestones[nextActionableIdx];

  return (
    <div className="space-y-4">
      {target && (
        <PrimaryActions
          escrow={escrow}
          milestone={target}
          role={role}
          onAction={onAction}
        />
      )}
      <CancelBlock
        escrow={escrow}
        role={role}
        myCancelFlagged={myCancelFlagged}
        cancelPending={cancelPending}
        onAction={onAction}
      />
    </div>
  );
}

function PrimaryActions({
  escrow,
  milestone,
  role,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  role: Role;
  onAction: () => void;
}) {
  if (milestone.state === MilestoneState.PENDING) {
    const signaled = milestone.deliveredAt > 0n;
    const noticeEndsAt = signaled
      ? Number(milestone.deliveredAt + escrow.deliveryNoticeWindow)
      : null;
    const noticeStatus = noticeEndsAt ? timeUntil(noticeEndsAt) : null;

    if (signaled) {
      // The recipient has signaled delivery. Two branches:
      // - Window still open: depositor can approve / dispute, recipient waits.
      // - Window expired: anyone can claim silent approval.
      if (noticeStatus?.expired) {
        return (
          <ClaimSilentApprovalCard
            escrow={escrow}
            milestone={milestone}
            onAction={onAction}
          />
        );
      }
      if (role === "depositor" || role === "both") {
        return (
          <DeliverySignaledDepositorCard
            escrow={escrow}
            milestone={milestone}
            onAction={onAction}
          />
        );
      }
      return (
        <DeliverySignaledRecipientCard
          escrow={escrow}
          milestone={milestone}
        />
      );
    }

    if (role === "depositor" || role === "both") {
      return (
        <FulfillCard escrow={escrow} milestone={milestone} onAction={onAction} />
      );
    }
    // Recipient on a not-yet-signaled milestone: signal delivery card. If the
    // deadline has passed and they didn't signal, they can also escalate.
    return (
      <RecipientPendingCard
        escrow={escrow}
        milestone={milestone}
        onAction={onAction}
      />
    );
  }

  if (milestone.state === MilestoneState.FULFILLED) {
    const dispWindow = timeUntil(
      Number(milestone.conditionMetTimestamp + escrow.disputeWindow),
    );

    return (
      <div className="space-y-4">
        {/* Both depositor and recipient may raise a dispute while the
            review window is open. */}
        {!dispWindow.expired && (
          <DisputeCard
            escrow={escrow}
            milestone={milestone}
            role={role}
            onAction={onAction}
          />
        )}
        {dispWindow.expired && (
          <ReleaseCard
            escrow={escrow}
            milestone={milestone}
            onAction={onAction}
          />
        )}
      </div>
    );
  }

  if (milestone.state === MilestoneState.DISPUTED) {
    return (
      <CounterEvidenceCard
        escrow={escrow}
        milestone={milestone}
        onAction={onAction}
      />
    );
  }

  return null;
}

// =============== Action subcomponents ===============

function FulfillCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Milestone approved",
    onSuccess: () => {
      setConfirmOpen(false);
      onAction();
    },
  });

  return (
    <Card title="Approve milestone" tone="cyan">
      <p className="text-sm text-muted-soft mb-4">
        As the depositor, you confirm that the recipient has fulfilled this
        milestone. The review period will start, after which the payment
        releases automatically if no one disputes.
      </p>
      <button
        className="btn btn-primary"
        disabled={isPending || tx.isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending || tx.isLoading
          ? "Approving…"
          : `Approve milestone ${milestone.index + 1}`}
      </button>

      <ConfirmModal
        open={confirmOpen}
        title={`Approve milestone ${milestone.index + 1}?`}
        body={
          <>
            You're about to approve milestone {milestone.index + 1} for{" "}
            <span className="mono-amount text-fg-strong">
              {formatUSDC(milestone.amount)}
            </span>
            . This starts the review period of{" "}
            {(Number(escrow.disputeWindow) / 3600).toFixed(0)} hours, after
            which the payment will release to the recipient automatically if no
            one raises a dispute.
          </>
        }
        confirmLabel="Yes, approve"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "fulfillCondition",
              args: [escrow.id, BigInt(milestone.index)],
            },
            { onError: notifyTxError },
          )
        }
      />
    </Card>
  );
}

function DisputeCard({
  escrow,
  milestone,
  role,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  role: Role;
  onAction: () => void;
}) {
  const [reason, setReason] = useState("");
  const [evidenceURI, setEvidenceURI] = useState("");
  const evidenceHash: Hex | "" = evidenceURI ? hashString(evidenceURI) : "";

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Dispute raised",
    onSuccess: onAction,
  });

  const valid = reason.trim().length > 0 && evidenceURI.trim().length > 0;

  const description =
    role === "depositor"
      ? "Disagree with what was delivered? Raise a dispute before the review period closes. An arbiter will review your evidence and decide."
      : "Need to dispute something on this milestone? Raise it before the review period closes. An arbiter will review your evidence and decide.";

  return (
    <Card title="Raise a dispute" tone="warn">
      <p className="text-sm text-muted-soft mb-4">{description}</p>
      <div className="grid gap-3">
        <div>
          <LabelWithTip tooltip="A brief explanation of the dispute. Be specific about what the issue is.">
            Reason
          </LabelWithTip>
          <textarea
            className="input min-h-[80px]"
            placeholder="Briefly describe the problem"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div>
          <LabelWithTip tooltip="A link to your evidence file. Use a stable, permanent link.">
            Evidence URI
          </LabelWithTip>
          <input
            className="input"
            placeholder="Evidence URI (https:// or ipfs://)"
            value={evidenceURI}
            onChange={(e) => setEvidenceURI(e.target.value.trim())}
          />
        </div>
        {evidenceHash && (
          <div className="text-xs text-muted font-mono truncate">
            <LabelWithTip tooltip="A hash of your evidence file. Proves your evidence existed at the time of the dispute and has not been changed.">
              Evidence hash
            </LabelWithTip>
            {evidenceHash}
          </div>
        )}
        <button
          className="btn btn-warn self-start"
          disabled={!valid || isPending || tx.isLoading}
          onClick={() =>
            writeContract(
              {
                address: ESCROW_ADDRESS,
                abi: escrowAbi,
                functionName: "raiseDispute",
                args: [
                  escrow.id,
                  BigInt(milestone.index),
                  reason,
                  evidenceHash as Hex,
                  evidenceURI,
                ],
              },
              { onError: notifyTxError },
            )
          }
        >
          {isPending || tx.isLoading ? "Submitting…" : "Raise Dispute"}
        </button>
      </div>
    </Card>
  );
}

function CounterEvidenceCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  const [uri, setURI] = useState("");
  const hash: Hex | "" = uri ? hashString(uri) : "";

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const tx = useTrackedTx(txHash, {
    successMessage: "Response submitted",
    onSuccess: onAction,
  });

  return (
    <Card title="Submit your response" tone="warn">
      <p className="text-sm text-muted-soft mb-4">
        A dispute is open on this milestone. The arbiter is reviewing the
        evidence. You can submit your response (one time, optional).
      </p>
      <div className="grid gap-3">
        <div>
          <LabelWithTip tooltip="A link to your response document.">
            Counter-evidence URI
          </LabelWithTip>
          <input
            className="input"
            placeholder="Response URI"
            value={uri}
            onChange={(e) => setURI(e.target.value.trim())}
          />
        </div>
        {hash && (
          <div className="text-xs text-muted font-mono truncate">
            <LabelWithTip tooltip="A hash of your response document. Same purpose as the evidence hash.">
              Counter-evidence hash
            </LabelWithTip>
            {hash}
          </div>
        )}
        <button
          className="btn btn-warn self-start"
          disabled={!uri || isPending || tx.isLoading}
          onClick={() =>
            writeContract(
              {
                address: ESCROW_ADDRESS,
                abi: escrowAbi,
                functionName: "submitCounterEvidence",
                args: [escrow.id, BigInt(milestone.index), hash as Hex, uri],
              },
              { onError: notifyTxError },
            )
          }
        >
          {isPending || tx.isLoading ? "Submitting…" : "Submit Response"}
        </button>
      </div>
    </Card>
  );
}

function EscalateCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  const deadlinePassed =
    BigInt(Math.floor(Date.now() / 1000)) > escrow.deadline;

  const [reason, setReason] = useState("");
  const [uri, setURI] = useState("");
  const hash: Hex | "" = uri ? hashString(uri) : "";

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const tx = useTrackedTx(txHash, {
    successMessage: "Milestone escalated",
    onSuccess: onAction,
  });

  if (!deadlinePassed) {
    return (
      <Card title="Waiting on the depositor" tone="muted">
        <p className="text-sm text-muted-soft">
          The depositor needs to approve this milestone. If they don't act
          before the deadline, you'll be able to escalate it for an arbiter to
          review.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Escalate to Arbiter" tone="warn">
      <p className="text-sm text-muted-soft mb-4">
        The deadline has passed and this milestone is still unapproved. You can
        escalate it for an arbiter to decide.
      </p>
      <div className="grid gap-3">
        <textarea
          className="input min-h-[80px]"
          placeholder="Reason for escalating"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <input
          className="input"
          placeholder="Evidence URI"
          value={uri}
          onChange={(e) => setURI(e.target.value.trim())}
        />
        <button
          className="btn btn-warn self-start"
          disabled={!reason || !uri || isPending || tx.isLoading}
          onClick={() =>
            writeContract(
              {
                address: ESCROW_ADDRESS,
                abi: escrowAbi,
                functionName: "escalateAfterDeadline",
                args: [
                  escrow.id,
                  BigInt(milestone.index),
                  reason,
                  hash as Hex,
                  uri,
                ],
              },
              { onError: notifyTxError },
            )
          }
        >
          {isPending || tx.isLoading ? "Escalating…" : "Escalate to Arbiter"}
        </button>
      </div>
    </Card>
  );
}

function ReleaseCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Payment released",
    onSuccess: onAction,
  });

  // Circle's forwarding service deducts a small fee from the minted USDC on
  // the destination chain. We fetch the suggested fee once so the user knows
  // roughly how much will arrive.
  const [maxFee, setMaxFee] = useState<bigint | null>(null);
  const [feeError, setFeeError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFeeError(false);
    fetchForwardFee(escrow.destinationDomain).then((v) => {
      if (cancelled) return;
      if (v === null) setFeeError(true);
      setMaxFee(v ?? 0n);
    });
    return () => {
      cancelled = true;
    };
  }, [escrow.destinationDomain]);

  const chain = chainForDomain(escrow.destinationDomain);
  const willReceive =
    maxFee !== null && maxFee < milestone.amount
      ? milestone.amount - maxFee
      : null;

  return (
    <Card title="Release Payment" tone="ok">
      <p className="text-sm text-muted-soft mb-4">
        The review period has ended without a dispute. Anyone can now trigger
        the payment release for this milestone.
      </p>

      <div className="rounded-xl bg-warn/5 border border-warn/15 p-3 mb-4 text-xs text-warn-soft">
        Circle's forwarding service automatically delivers this payment to{" "}
        <span className="text-fg-strong">{chain.name}</span>. A small forwarding
        fee is deducted from the amount the recipient receives.
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
            succeed; the actual fee will be deducted on the destination chain.
          </div>
        )}
      </div>

      <button
        className="btn btn-primary"
        disabled={isPending || tx.isLoading || maxFee === null}
        onClick={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "releaseAfterWindow",
              args: [escrow.id, BigInt(milestone.index), maxFee ?? 0n],
            },
            { onError: notifyTxError },
          )
        }
      >
        {isPending || tx.isLoading
          ? "Releasing…"
          : maxFee === null
            ? "Fetching fee…"
            : `Release ${formatUSDC(milestone.amount, false)} USDC`}
      </button>
    </Card>
  );
}

function ReleaseAfterWindowOnly({
  escrow,
  milestones,
  onAction,
}: {
  escrow: Escrow;
  milestones: Milestone[];
  onAction: () => void;
}) {
  const releasable = milestones.find(
    (m) =>
      m.state === MilestoneState.FULFILLED &&
      timeUntil(Number(m.conditionMetTimestamp + escrow.disputeWindow)).expired,
  );
  if (releasable) {
    return (
      <ReleaseCard escrow={escrow} milestone={releasable} onAction={onAction} />
    );
  }

  // Allow any caller to trigger silent-approval release if the notice window
  // has expired but the depositor never acted.
  const silentReady = milestones.find(
    (m) =>
      m.state === MilestoneState.PENDING &&
      m.deliveredAt > 0n &&
      timeUntil(Number(m.deliveredAt + escrow.deliveryNoticeWindow)).expired,
  );
  if (silentReady) {
    return (
      <ClaimSilentApprovalCard
        escrow={escrow}
        milestone={silentReady}
        onAction={onAction}
      />
    );
  }
  return null;
}

// =============== New: signalDelivery / claimSilentApproval ===============

function RecipientPendingCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const deadlinePassed = nowSec > escrow.deadline;

  // Late-signal protection mirrors the contract: now + deliveryNoticeWindow
  // must be <= deadline to call signalDelivery.
  const signalCutoff = escrow.deadline - escrow.deliveryNoticeWindow;
  const canSignal =
    !deadlinePassed && nowSec <= signalCutoff && milestone.deliveredAt === 0n;

  if (deadlinePassed) {
    return (
      <EscalateCard escrow={escrow} milestone={milestone} onAction={onAction} />
    );
  }

  return (
    <SignalDeliveryCard
      escrow={escrow}
      milestone={milestone}
      canSignal={canSignal}
      onAction={onAction}
    />
  );
}

function SignalDeliveryCard({
  escrow,
  milestone,
  canSignal,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  canSignal: boolean;
  onAction: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Delivery signaled. The depositor has been notified.",
    onSuccess: () => {
      setConfirmOpen(false);
      onAction();
    },
  });

  const noticeDays = Math.round(Number(escrow.deliveryNoticeWindow) / 86400);

  return (
    <Card title="Signal Delivery" tone="cyan">
      <p className="text-sm text-muted-soft mb-4">
        Mark this milestone as ready for the depositor's review. They will have{" "}
        {noticeDays} days to approve or raise a dispute. If they take no action
        within that window, the payment releases automatically.
      </p>
      {!canSignal && (
        <div className="rounded-xl bg-warn/5 border border-warn/15 p-3 mb-4 text-xs text-warn-soft">
          Too close to the deadline to signal delivery for this milestone. If
          the deadline passes without approval, you can escalate to the arbiter
          instead.
        </div>
      )}
      <button
        className="btn btn-primary"
        disabled={!canSignal || isPending || tx.isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending || tx.isLoading ? "Signaling…" : "Signal Delivery"}
      </button>

      <ConfirmModal
        open={confirmOpen}
        title={`Signal delivery on milestone ${milestone.index + 1}?`}
        body={
          <>
            Are you sure you want to signal delivery on this milestone? This
            notifies the depositor that work is ready for review. They will
            have {noticeDays} days to approve or raise a dispute. If they take
            no action, the payment releases automatically.
          </>
        }
        confirmLabel="Yes, signal"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "signalDelivery",
              args: [escrow.id, BigInt(milestone.index)],
            },
            { onError: notifyTxError },
          )
        }
      />
    </Card>
  );
}

function DeliverySignaledDepositorCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  // Window is open and we are the depositor: offer Approve, plus a dispute
  // explainer.
  return (
    <div className="space-y-4">
      <FulfillCard escrow={escrow} milestone={milestone} onAction={onAction} />
      <DisputeOnPendingCard escrow={escrow} milestone={milestone} />
    </div>
  );
}

function DeliverySignaledRecipientCard({
  escrow,
  milestone,
}: {
  escrow: Escrow;
  milestone: Milestone;
}) {
  const endsAt = Number(milestone.deliveredAt + escrow.deliveryNoticeWindow);
  const cd = timeUntil(endsAt);

  return (
    <Card title="Awaiting depositor review" tone="warn">
      <p className="text-sm text-muted-soft mb-3">
        You signaled delivery on this milestone. The depositor has time to
        approve or raise a dispute.
      </p>
      <div className="rounded-xl bg-warn/5 border border-warn/15 p-3 text-xs text-warn-soft">
        Depositor review window ends in{" "}
        <span className="text-fg-strong">{cd.label}</span>. If they take no
        action, the payment releases automatically when the window closes.
      </div>
    </Card>
  );
}

/// Depositor-side dispute card available while the milestone is still PENDING
/// after a recipient signal. The on-chain raiseDispute path requires FULFILLED
/// state, so this submits via the same fulfillCondition path with disputed
/// flow — actually, the contract requires FULFILLED for raiseDispute. To keep
/// this consistent with the contract, we treat "Raise dispute" during a signal
/// window as "approve then dispute": here we surface it as a clear secondary
/// action that approves first (state goes to FULFILLED) and immediately opens
/// the dispute UI. Because that's two transactions, we keep it simple: surface
/// the signal context, but only show the Approve button. If the depositor
/// believes the work is wrong, they should approve first then dispute, or wait
/// for the window to expire and dispute during the review period.
function DisputeOnPendingCard({
  escrow,
  milestone,
}: {
  escrow: Escrow;
  milestone: Milestone;
}) {
  // The contract only allows raiseDispute on FULFILLED milestones, so during
  // the silent-approval window the depositor's "raise dispute" path is to
  // approve first (the FulfillCard rendered above this one), then raise the
  // dispute during the standard review period.
  const endsAt = Number(milestone.deliveredAt + escrow.deliveryNoticeWindow);
  const cd = timeUntil(endsAt);
  const lessThanADay =
    !cd.expired && endsAt - Math.floor(Date.now() / 1000) < 86400;

  return (
    <Card title="Delivery signaled" tone="warn">
      <p className="text-sm text-muted-soft mb-3">
        The recipient has marked work ready for your review. Use{" "}
        <span className="text-fg-strong">Approve milestone</span> above to start
        the formal review period (during which a dispute can still be raised).
        If you take no action, the payment releases automatically when the
        notice window closes.
      </p>
      <div className="rounded-xl bg-warn/5 border border-warn/15 p-3 text-xs text-warn-soft">
        Notice window ends in{" "}
        <span className="text-fg-strong">{cd.label}</span>.
      </div>
      {lessThanADay && (
        <div className="mt-3 rounded-xl bg-bad/5 border border-bad/15 p-3 text-xs text-bad-soft">
          Less than 24 hours left to respond. Payment releases automatically if
          no action is taken.
        </div>
      )}
    </Card>
  );
}

function ClaimSilentApprovalCard({
  escrow,
  milestone,
  onAction,
}: {
  escrow: Escrow;
  milestone: Milestone;
  onAction: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Payment released successfully.",
    onSuccess: () => {
      setConfirmOpen(false);
      onAction();
    },
  });

  return (
    <Card title="Release Payment" tone="ok">
      <p className="text-sm text-muted-soft mb-4">
        The delivery notice window has expired without a response from the
        depositor. Anyone can now trigger the automatic payment release for
        this milestone.
      </p>
      <button
        className="btn btn-primary"
        disabled={isPending || tx.isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending || tx.isLoading
          ? "Releasing…"
          : `Release ${formatUSDC(milestone.amount, false)} USDC`}
      </button>
      <ConfirmModal
        open={confirmOpen}
        title="Trigger silent-approval release?"
        body={
          <>
            The delivery notice window has expired. The depositor did not
            respond in time. You can now trigger the automatic payment release.
            Proceed?
          </>
        }
        confirmLabel="Yes, release"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "claimSilentApproval",
              args: [escrow.id, BigInt(milestone.index)],
            },
            { onError: notifyTxError },
          )
        }
      />
    </Card>
  );
}

function CancelBlock({
  escrow,
  role,
  myCancelFlagged,
  cancelPending,
  onAction,
}: {
  escrow: Escrow;
  role: Role;
  myCancelFlagged: boolean;
  cancelPending: boolean;
  onAction: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: cancelPending ? "Escrow cancelled" : "Cancellation requested",
    onSuccess: () => {
      setConfirmOpen(false);
      onAction();
    },
  });

  if (role === "none") return null;

  return (
    <Card title="Request Cancellation" tone="muted">
      <p className="text-sm text-muted-soft mb-4">
        Both parties must agree to cancel. Once both have flagged this, all
        non-disputed milestones are refunded to the depositor.
      </p>
      <div className="text-xs text-muted-soft mb-4 grid gap-1">
        <div className="flex justify-between">
          <span>Depositor agreed</span>
          <span
            className={
              escrow.depositorApproveCancel ? "text-ok-soft" : "text-muted"
            }
          >
            {escrow.depositorApproveCancel ? "Yes" : "Not yet"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Recipient agreed</span>
          <span
            className={
              escrow.recipientApproveCancel ? "text-ok-soft" : "text-muted"
            }
          >
            {escrow.recipientApproveCancel ? "Yes" : "Not yet"}
          </span>
        </div>
      </div>
      <button
        className="btn btn-ghost"
        disabled={myCancelFlagged || isPending || tx.isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {myCancelFlagged
          ? "You've requested cancellation"
          : isPending || tx.isLoading
            ? "Submitting…"
            : "Request Cancellation"}
      </button>

      <ConfirmModal
        open={confirmOpen}
        title="Request to cancel this escrow?"
        body={
          <>
            Are you sure you want to request cancellation? The other party also
            has to agree before the escrow is cancelled. Once both parties
            agree, all non-disputed milestones are refunded to the depositor.
          </>
        }
        confirmLabel="Yes, request"
        tone="warn"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "mutualCancel",
              args: [escrow.id],
            },
            { onError: notifyTxError },
          )
        }
      />
    </Card>
  );
}

function Card({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "cyan" | "warn" | "ok" | "muted";
  children: React.ReactNode;
}) {
  const ring =
    tone === "cyan"
      ? "border-accent/15"
      : tone === "warn"
        ? "border-warn/20"
        : tone === "ok"
          ? "border-ok/20"
          : "border-line";
  const dot =
    tone === "cyan"
      ? "bg-accent"
      : tone === "warn"
        ? "bg-warn"
        : tone === "ok"
          ? "bg-ok"
          : "bg-muted";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`glass border ${ring} p-5`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="font-display text-sm uppercase tracking-widest text-fg-strong/90">
          {title}
        </span>
      </div>
      {children}
    </motion.div>
  );
}
