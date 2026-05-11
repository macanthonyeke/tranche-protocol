import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import { useEscrow, useMilestones } from "../hooks/useEscrows";
import { useEscrowMeta, rememberCreatedAt } from "../hooks/useEscrowMeta";
import { ConnectGate } from "../components/ConnectGate";
import { CardSkeleton } from "../components/CardSkeleton";
import { EscrowStateBadge, RoleBadge } from "../components/StateBadge";
import { ChainBadge } from "../components/ChainBadge";
import { MilestoneTimeline } from "../components/MilestoneTimeline";
import { ActionPanel } from "../components/ActionPanel";
import { AddressDisplay } from "../components/AddressDisplay";
import { CopyButton } from "../components/CopyButton";
import { UpdateMintRecipient } from "../components/UpdateMintRecipient";
import {
  escrowReference,
  formatUSDC,
  relativeTime,
  timeUntil,
} from "../lib/format";
import { EscrowState, getRole } from "../lib/types";

export function EscrowDetail() {
  const { id } = useParams();
  const escrowId = useMemo(() => {
    try {
      return id ? BigInt(id) : undefined;
    } catch {
      return undefined;
    }
  }, [id]);

  const { address, isConnected } = useAccount();
  const { escrow, isLoading, refetch } = useEscrow(escrowId);
  const { milestones, refetch: refetchMs } = useMilestones(
    escrowId,
    escrow?.milestoneCount,
  );
  const { meta, projectName, milestones: milestoneMeta, createdAt, setName } =
    useEscrowMeta(escrowId);

  // Stamp first-seen timestamp so we always have a "Created X ago" label.
  useEffect(() => {
    if (escrowId === undefined) return;
    if (!createdAt) {
      rememberCreatedAt(escrowId, Math.floor(Date.now() / 1000));
    }
  }, [escrowId, createdAt]);

  if (!isConnected) return <ConnectGate title="Connect to view this escrow" />;
  if (!escrowId) return <NotFoundBlock />;
  if (isLoading && !escrow) return <CardSkeleton count={2} />;
  if (!escrow) return <NotFoundBlock />;

  const role = getRole(escrow, address);
  const counterparty =
    role === "depositor" ? escrow.recipient : escrow.depositor;
  const fallbackRef = escrowReference(escrow.invoiceHash, escrow.totalAmount);
  const headline = projectName ?? fallbackRef;

  const deadline =
    escrow.state === EscrowState.ACTIVE && escrow.deadline > 0n
      ? timeUntil(escrow.deadline)
      : null;

  const onAction = () => {
    refetch();
    refetchMs();
  };

  const titles = milestones.map(
    (m) => milestoneMeta[m.index]?.title ?? `Milestone ${m.index + 1}`,
  );
  const descs = milestones.map(
    (m) => milestoneMeta[m.index]?.description ?? "",
  );

  const isDepositor = role === "depositor" || role === "both";

  return (
    <div>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg mb-4"
      >
        ← Back
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="glass p-6 md:p-8 mb-8"
      >
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {role !== "none" && (
                <RoleBadge role={role === "both" ? "both" : role} />
              )}
              <EscrowStateBadge state={escrow.state} />
            </div>

            <ProjectNameHeading
              headline={headline}
              canEdit={isDepositor}
              currentName={projectName ?? ""}
              onSave={(v) => setName(v)}
            />

            <div className="text-sm text-muted-soft mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Working with{" "}
                <AddressDisplay address={counterparty} className="text-fg" />
              </span>
              <span className="text-muted">·</span>
              <span>
                {createdAt
                  ? `Created ${relativeTime(createdAt)}`
                  : "Recently created"}
              </span>
              {!projectName && (
                <>
                  <span className="text-muted">·</span>
                  <span className="text-muted font-mono">
                    {fallbackRef.split(" · ")[0]}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-widest text-muted">
              Total locked
            </div>
            <div className="font-display text-3xl text-fg-strong mono-amount">
              {formatUSDC(escrow.totalAmount, false)}
            </div>
            <div className="text-xs text-muted-soft">USDC</div>
          </div>
        </div>

        <div className="divider-soft my-6" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
          <Field label="Depositor">
            <AddressDisplay address={escrow.depositor} />
          </Field>
          <Field label="Recipient">
            <AddressDisplay address={escrow.recipient} />
          </Field>
          <Field label="Refund destination">
            <AddressDisplay address={escrow.refundTo} />
          </Field>
          <Field label="Destination">
            <ChainBadge domain={escrow.destinationDomain} size="sm" />
          </Field>
          <Field label="Review period">
            <span className="text-fg">
              {(Number(escrow.disputeWindow) / 3600).toFixed(0)} hours
            </span>
          </Field>
          <Field label="Deadline">
            <span
              className={
                deadline
                  ? deadline.expired
                    ? "text-bad-soft"
                    : "text-fg"
                  : "text-muted"
              }
            >
              {escrow.deadline > 0n
                ? new Date(Number(escrow.deadline) * 1000).toLocaleString()
                : "Not set"}
            </span>
          </Field>
          <Field label="Contract reference">
            <span className="text-muted-soft font-mono">
              #{escrow.id.toString()}
            </span>
          </Field>
        </div>

        <div className="divider-soft my-6" />

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="label">Invoice URI</div>
            <a
              href={escrow.invoiceURI}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm text-accent break-all"
            >
              {escrow.invoiceURI}
            </a>
          </div>
          <div>
            <div className="label">Invoice hash</div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-sm text-fg truncate">
                {escrow.invoiceHash}
              </span>
              <CopyButton value={escrow.invoiceHash} label="invoice hash" />
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <section>
          <h2 className="font-display text-2xl text-fg-strong mb-4">Milestones</h2>
          {milestones.length > 0 ? (
            <MilestoneTimeline
              escrow={escrow}
              milestones={milestones}
              metaTitles={titles}
              metaDescriptions={descs}
            />
          ) : (
            <CardSkeleton count={2} />
          )}
        </section>

        <aside className="space-y-4">
          <h2 className="font-display text-2xl text-fg-strong">Actions</h2>
          <ActionPanel
            escrow={escrow}
            milestones={milestones}
            role={role}
            onAction={onAction}
          />

          <div className="text-xs text-muted text-center">
            Last activity:{" "}
            {milestones.length > 0 &&
            milestones.some((m) => m.conditionMetTimestamp > 0n)
              ? relativeTime(
                  Number(
                    milestones.reduce(
                      (acc, m) =>
                        m.conditionMetTimestamp > acc
                          ? m.conditionMetTimestamp
                          : acc,
                      0n,
                    ),
                  ),
                )
              : "no activity yet"}
          </div>
        </aside>
      </div>

      <UpdateMintRecipient escrow={escrow} onUpdated={onAction} />
    </div>
  );

  // Suppress unused warning
  void meta;
}

function ProjectNameHeading({
  headline,
  canEdit,
  currentName,
  onSave,
}: {
  headline: string;
  canEdit: boolean;
  currentName: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);

  useEffect(() => setDraft(currentName), [currentName]);

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <input
          autoFocus
          className="input max-w-md"
          placeholder="Project name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={80}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(draft);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(currentName);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onSave(draft);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setEditing(false);
            setDraft(currentName);
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <h1 className="font-display text-3xl md:text-4xl text-fg-strong tracking-tight">
        {headline}
      </h1>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-muted hover:text-accent inline-flex items-center gap-1"
          title="Rename this escrow"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          {currentName ? "Rename" : "Add project name"}
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function NotFoundBlock() {
  return (
    <div className="glass p-12 text-center">
      <div className="font-display text-2xl text-fg-strong mb-2">
        Escrow not found
      </div>
      <div className="text-muted-soft mb-6">
        This escrow doesn't exist or hasn't been indexed yet.
      </div>
      <Link to="/" className="btn btn-primary">
        Back to Dashboard
      </Link>
    </div>
  );
}
