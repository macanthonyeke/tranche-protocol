import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { isAddress, type Address } from "viem";
import { ESCROW_ADDRESS } from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { formatUSDC } from "../lib/format";
import { ConfirmModal } from "./ConfirmModal";
import { LabelWithTip } from "./InfoTooltip";
import { CustomSelect } from "./CustomSelect";
import { notifyTxError, useTrackedTx } from "../hooks/useTx";

const ZERO_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/// Admin-only controls. Visible only to wallets that hold DEFAULT_ADMIN_ROLE.
export function AdminPanel() {
  const { address } = useAccount();
  const { data: hasAdmin } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "hasRole",
    args: address ? [ZERO_ROLE, address] : undefined,
    query: { enabled: !!address },
  });

  if (!hasAdmin) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl text-fg-strong mb-4">
        Admin controls
      </h2>
      <div className="grid gap-6">
        <CctpForwardFeeBlock />
        <GrantRoleBlock />
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------
// CCTP forward fee
// ----------------------------------------------------------------------

function CctpForwardFeeBlock() {
  const { data: current, refetch } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "cctpForwardFee",
    query: { refetchInterval: 12_000 },
  });

  const [input, setInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "CCTP forwarding fee updated",
    onSuccess: () => {
      setConfirmOpen(false);
      setInput("");
      refetch();
    },
  });

  const currentRaw = (current as bigint | undefined) ?? 0n;
  const newRaw = parseUsdcInput(input);

  return (
    <div className="glass p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h3 className="font-display text-lg text-fg-strong">
            CCTP Forwarding Fee
          </h3>
          <p className="text-sm text-muted-soft mt-1">
            The fee Circle's Forwarding Service charges to auto-deliver
            cross-chain milestone payments.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-widest text-muted">
            Current
          </div>
          <div className="font-mono text-2xl text-fg-strong mono-amount">
            {formatUSDC(currentRaw, false)} USDC
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <LabelWithTip tooltip="The Circle Forwarding Service charges a gas-based fee to automatically complete cross-chain transfers on the destination chain. This fee fluctuates based on destination chain gas prices. Query https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/{destinationDomain}?forward=true for the current fee before updating. Use the med forwardFee value.">
            CCTP Forwarding Fee (USDC)
          </LabelWithTip>
          <input
            className="input mono-amount"
            placeholder="0.21"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={
            !input || newRaw === null || isPending || tx.isLoading
          }
          onClick={() => setConfirmOpen(true)}
        >
          {isPending || tx.isLoading ? "Updating…" : "Update Fee"}
        </button>
      </div>

      <p className="text-xs text-muted mt-3">
        This fee is required for cross-chain milestone payments to be delivered
        automatically. Same-chain (Arc Testnet) payments do not require this
        fee. Set to 0 only if all escrows are same-chain.
      </p>

      <ConfirmModal
        open={confirmOpen}
        title="Update CCTP forwarding fee?"
        body={
          <>
            You are updating the CCTP forwarding fee to{" "}
            <span className="mono-amount text-fg-strong">
              {input || "0"}
            </span>{" "}
            USDC. This affects all future cross-chain milestone releases. Make
            sure this matches the current Circle API fee. Proceed?
          </>
        }
        confirmLabel="Yes, update"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          newRaw !== null &&
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "setCctpForwardFee",
              args: [newRaw],
            },
            { onError: notifyTxError },
          )
        }
      />
    </div>
  );
}

function parseUsdcInput(input: string): bigint | null {
  if (!input) return null;
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) return null;
  return BigInt(Math.round(num * 1_000_000));
}

// ----------------------------------------------------------------------
// Grant / revoke roles (lightweight panel)
// ----------------------------------------------------------------------

const ROLES: { label: string; fn: "ARBITER_ROLE" | "PAUSER_ROLE" | "DOMAIN_MANAGER_ROLE" }[] = [
  { label: "Arbiter", fn: "ARBITER_ROLE" },
  { label: "Pauser", fn: "PAUSER_ROLE" },
  { label: "Domain manager", fn: "DOMAIN_MANAGER_ROLE" },
];

function GrantRoleBlock() {
  const [roleFn, setRoleFn] = useState(ROLES[0].fn);
  const [target, setTarget] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: roleHash } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: roleFn,
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const tx = useTrackedTx(hash, {
    successMessage: "Role granted",
    onSuccess: () => {
      setConfirmOpen(false);
      setTarget("");
    },
  });

  const valid = isAddress(target) && !!roleHash;

  // Force a re-fetch of role hash when role changes.
  useEffect(() => {
    /* roleHash refetches automatically via the function name dep above */
  }, [roleFn]);

  return (
    <div className="glass p-6">
      <h3 className="font-display text-lg text-fg-strong mb-1">
        Grant a role
      </h3>
      <p className="text-sm text-muted-soft mb-4">
        Use this to onboard a new arbiter, pauser, or domain manager.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <LabelWithTip tooltip="Which role you're granting. Each role grants different powers on the contract.">
            Role
          </LabelWithTip>
          <CustomSelect
            value={roleFn}
            onChange={(v) => setRoleFn(v)}
            options={ROLES.map((r) => ({ label: r.label, value: r.fn }))}
          />
        </div>
        <div>
          <LabelWithTip tooltip="The wallet address you want to give this role to. Double-check this address. Role grants take effect immediately and can only be reversed by the admin.">
            Address
          </LabelWithTip>
          <input
            className="input font-mono"
            placeholder="0x…"
            value={target}
            onChange={(e) => setTarget(e.target.value.trim())}
          />
        </div>
      </div>

      <button
        className="btn btn-primary mt-4"
        disabled={!valid || isPending || tx.isLoading}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending || tx.isLoading ? "Granting…" : "Grant role"}
      </button>

      <ConfirmModal
        open={confirmOpen}
        title="Grant role?"
        body={
          <>
            Grant the{" "}
            <span className="text-fg-strong">
              {ROLES.find((r) => r.fn === roleFn)?.label}
            </span>{" "}
            role to{" "}
            <span className="font-mono text-fg-strong">{target}</span>?
          </>
        }
        confirmLabel="Yes, grant"
        tone="primary"
        busy={isPending || tx.isLoading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          roleHash &&
          writeContract(
            {
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "grantRole",
              args: [roleHash as `0x${string}`, target as Address],
            },
            { onError: notifyTxError },
          )
        }
      />
    </div>
  );
}
