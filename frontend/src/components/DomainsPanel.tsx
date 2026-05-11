import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { ESCROW_ADDRESS, CCTP_DOMAINS, chainForDomain } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { useSupportedDomains } from "../hooks/useSupportedDomains";
import { ChainIcon } from "./ChainBadge";
import { ConfirmModal } from "./ConfirmModal";
import { LabelWithTip } from "./InfoTooltip";
import { notifyTxError, useTrackedTx } from "../hooks/useTx";

export function DomainsPanel() {
  const { address } = useAccount();

  const { data: domainManagerRoleHash } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "DOMAIN_MANAGER_ROLE",
  });

  const { data: hasDomainManagerRole } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "hasRole",
    args:
      domainManagerRoleHash && address
        ? [domainManagerRoleHash, address]
        : undefined,
    query: { enabled: !!domainManagerRoleHash && !!address },
  });

  const { domains, isLoading, refetch } = useSupportedDomains();

  const isAuthorized = hasDomainManagerRole === true;

  return (
    <section className="mt-2">
      <div className="mb-6">
        <h2 className="font-display text-2xl text-fg-strong">Supported Domains</h2>
        <p className="text-sm text-muted-soft mt-1">
          Destination chains that are active in the escrow contract. Requires
          DOMAIN_MANAGER_ROLE to make changes.
        </p>
      </div>

      {!isAuthorized && (
        <div className="rounded-xl bg-warn/5 border border-warn/15 p-4 mb-6 text-sm text-warn-soft flex items-start gap-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            Your wallet does not hold DOMAIN_MANAGER_ROLE. You can view the
            current domains but cannot add or remove them.
          </span>
        </div>
      )}

      <div className="glass p-6 mb-6">
        <h3 className="font-display text-lg text-fg-strong mb-4">
          Active domains
        </h3>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 rounded-lg bg-surface/40 animate-pulse"
              />
            ))}
          </div>
        ) : domains.length === 0 ? (
          <p className="text-sm text-muted-soft">
            No domains are currently supported.
          </p>
        ) : (
          <div className="space-y-2">
            {domains.map((c) => (
              <DomainRow
                key={c.id}
                domainId={c.id}
                canRemove={isAuthorized}
                onRemoved={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {isAuthorized && <AddDomainBlock onAdded={refetch} currentDomains={domains.map((c) => c.id)} />}
    </section>
  );
}

function DomainRow({
  domainId,
  canRemove,
  onRemoved,
}: {
  domainId: number;
  canRemove: boolean;
  onRemoved: () => void;
}) {
  const chain = chainForDomain(domainId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: `Domain ${chain.name} removed`,
    onSuccess: () => {
      setConfirmOpen(false);
      onRemoved();
    },
  });

  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface/40 border border-line">
      <div className="flex items-center gap-3">
        <ChainIcon chain={chain} size="sm" />
        <div>
          <span className="text-sm text-fg-strong">{chain.name}</span>
          <span className="ml-2 text-xs text-muted font-mono">ID {domainId}</span>
        </div>
      </div>

      {canRemove && (
        <>
          <button
            type="button"
            className="text-xs text-bad-soft hover:text-bad transition-colors disabled:opacity-50"
            disabled={isPending || tx.isLoading}
            onClick={() => setConfirmOpen(true)}
          >
            {isPending || tx.isLoading ? "Removing…" : "Remove"}
          </button>

          <ConfirmModal
            open={confirmOpen}
            title="Remove supported domain?"
            body={
              <>
                Removing{" "}
                <span className="text-fg-strong">{chain.name}</span> (ID{" "}
                {domainId}) will prevent new escrows from using this destination
                chain. Existing escrows are not affected.
              </>
            }
            confirmLabel="Yes, remove"
            tone="danger"
            busy={isPending || tx.isLoading}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() =>
              writeContract(
                {
                  address: ESCROW_ADDRESS,
                  abi: escrowAbi,
                  functionName: "removeSupportedDomain",
                  args: [domainId],
                },
                { onError: notifyTxError },
              )
            }
          />
        </>
      )}
    </div>
  );
}

function AddDomainBlock({
  onAdded,
  currentDomains,
}: {
  onAdded: () => void;
  currentDomains: number[];
}) {
  const [input, setInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsed = parseInt(input, 10);
  const isValidId = input.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const alreadyAdded = isValidId && currentDomains.includes(parsed);
  const candidate = isValidId ? chainForDomain(parsed) : null;

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: `Domain added`,
    onSuccess: () => {
      setConfirmOpen(false);
      setInput("");
      onAdded();
    },
  });

  return (
    <div className="glass p-6">
      <h3 className="font-display text-lg text-fg-strong mb-1">Add domain</h3>
      <p className="text-sm text-muted-soft mb-4">
        Enter the CCTP domain ID to enable a new destination chain.
      </p>

      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <LabelWithTip tooltip="The numeric CCTP domain ID for the destination chain. Refer to the Circle documentation or the domain mapping in this panel.">
            Domain ID
          </LabelWithTip>
          <input
            className="input"
            type="number"
            min="0"
            placeholder="e.g. 6"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {candidate && (
            <p className="text-xs mt-1 text-muted-soft">
              Chain:{" "}
              <span className="text-fg">{candidate.name}</span>
              {alreadyAdded && (
                <span className="ml-2 text-warn-soft">(already supported)</span>
              )}
            </p>
          )}
        </div>
        <button
          className="btn btn-primary"
          disabled={
            !isValidId ||
            alreadyAdded ||
            isPending ||
            tx.isLoading
          }
          onClick={() => setConfirmOpen(true)}
        >
          {isPending || tx.isLoading ? "Adding…" : "Add domain"}
        </button>
      </div>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-widest text-muted mb-2">
          Known domain IDs
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CCTP_DOMAINS.filter((c) => !currentDomains.includes(c.id)).map((c) => (
            <button
              key={c.id}
              type="button"
              className="px-2 py-1 rounded text-xs bg-surface/40 border border-line text-muted-soft hover:text-fg hover:border-accent/30 transition-colors"
              onClick={() => setInput(String(c.id))}
            >
              {c.id} · {c.name}
            </button>
          ))}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Add supported domain?"
        body={
          candidate ? (
            <>
              Add{" "}
              <span className="text-fg-strong">{candidate.name}</span> (ID{" "}
              {parsed}) as a supported destination chain? Users will be able to
              create escrows targeting this chain.
            </>
          ) : null
        }
        confirmLabel="Yes, add"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          isValidId &&
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "addSupportedDomain",
              args: [parsed],
            },
            { onError: notifyTxError },
          )
        }
      />
    </div>
  );
}
