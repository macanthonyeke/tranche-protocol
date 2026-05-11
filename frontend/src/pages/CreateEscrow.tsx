import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWatchContractEvent,
} from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { isAddress, parseEventLogs, zeroAddress, type Address, type Hex } from "viem";
import { ConnectGate } from "../components/ConnectGate";
import { ChainSelect } from "../components/ChainSelect";
import { CustomSelect } from "../components/CustomSelect";
import { LabelWithTip } from "../components/InfoTooltip";
import {
  DELIVERY_NOTICE_WINDOW_PRESETS,
  DISPUTE_WINDOW_PRESETS,
  ESCROW_ADDRESS,
  MILESTONE_TITLES,
  PROTOCOL_FEE_BPS,
  USDC_ADDRESS,
  chainForDomain,
} from "../lib/config";
import { escrowAbi } from "../lib/escrowAbi";
import { usdcAbi } from "../lib/usdcAbi";
import {
  addressToBytes32,
  formatUSDC,
  hashString,
  parseUSDC,
} from "../lib/format";
import {
  saveMilestoneMeta,
  saveProjectName,
  rememberCreatedAt,
} from "../hooks/useEscrowMeta";
import { useUsdcBalance } from "../hooks/useUsdcBalance";
import { useTrackedTx, notifyTxError } from "../hooks/useTx";

interface MilestoneInput {
  title: string;
  customTitle: string;
  amount: string;
  description: string;
}

const STEPS = ["Basics", "Invoice", "Milestones", "Review"] as const;

export function CreateEscrow() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);

  // Step 1
  const [projectName, setProjectName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [destinationDomain, setDestinationDomain] = useState<number>(26);
  const [deadline, setDeadline] = useState("");
  const [disputeWindow, setDisputeWindow] = useState(72 * 3600);
  const [deliveryNoticeWindow, setDeliveryNoticeWindow] = useState<number>(7 * 86400);

  // Step 2
  const [invoiceURI, setInvoiceURI] = useState("");
  const [invoiceHashCustom, setInvoiceHashCustom] = useState("");
  const [useCustomHash, setUseCustomHash] = useState(false);

  // Step 3
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { title: "Project Kickoff", customTitle: "", amount: "", description: "" },
  ]);

  const totalAmountBig = useMemo(() => {
    try {
      return parseUSDC(totalAmount);
    } catch {
      return 0n;
    }
  }, [totalAmount]);

  const milestoneSum = useMemo(() => {
    let sum = 0n;
    for (const m of milestones) {
      try {
        sum += parseUSDC(m.amount || "0");
      } catch {
        /* ignore */
      }
    }
    return sum;
  }, [milestones]);

  const invoiceHash = useMemo<Hex | null>(() => {
    if (useCustomHash) {
      return /^0x[0-9a-fA-F]{64}$/.test(invoiceHashCustom)
        ? (invoiceHashCustom as Hex)
        : null;
    }
    return invoiceURI ? hashString(invoiceURI) : null;
  }, [invoiceURI, invoiceHashCustom, useCustomHash]);

  const deadlineUnix = useMemo(() => {
    if (!deadline) return 0n;
    const t = Math.floor(new Date(deadline).getTime() / 1000);
    return BigInt(Number.isFinite(t) ? t : 0);
  }, [deadline]);

  const validBasics =
    isAddress(recipient) &&
    totalAmountBig > 0n &&
    deadlineUnix > BigInt(Math.floor(Date.now() / 1000));

  const validInvoice = invoiceURI.length > 0 && !!invoiceHash;

  const validMilestones =
    milestones.length > 0 &&
    milestones.every((m) => parseFloat(m.amount || "0") > 0) &&
    milestoneSum === totalAmountBig;

  const allValid = validBasics && validInvoice && validMilestones;

  // ----- USDC balance + allowance -----

  const { data: usdcBalance } = useUsdcBalance(address);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "allowance",
    args: address ? [address, ESCROW_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const isApproved =
    (allowance as bigint | undefined) !== undefined &&
    (allowance as bigint) >= totalAmountBig &&
    totalAmountBig > 0n;

  const insufficientBalance =
    (usdcBalance as bigint | undefined) !== undefined &&
    totalAmountBig > 0n &&
    (usdcBalance as bigint) < totalAmountBig;

  // ----- Approve + deposit transactions -----

  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: approvePending,
  } = useWriteContract();
  const approveReceipt = useTrackedTx(approveHash, {
    successMessage: "USDC approved",
    onSuccess: () => refetchAllowance(),
  });

  const {
    writeContract: writeDeposit,
    data: depositHash,
    isPending: depositPending,
  } = useWriteContract();

  const [createdEscrowId, setCreatedEscrowId] = useState<bigint | null>(null);

  // Listen for the EscrowCreated event as a primary source of the new id.
  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "EscrowCreated",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as { args: { escrowId: bigint; depositor: Address } })
          .args;
        if (
          address &&
          args.depositor &&
          args.depositor.toLowerCase() === address.toLowerCase()
        ) {
          setCreatedEscrowId(args.escrowId);
        }
      }
    },
  });

  const depositReceipt = useTrackedTx(depositHash, {
    successMessage: "Escrow created!",
  });

  // Fallback: parse the EscrowCreated event from the deposit transaction's
  // own logs. This makes the redirect immediate and resilient even if the
  // websocket subscription misses the event.
  useEffect(() => {
    if (!depositReceipt.isSuccess || !depositReceipt.data) return;
    if (createdEscrowId !== null) return;
    try {
      const parsed = parseEventLogs({
        abi: escrowAbi,
        logs: depositReceipt.data.logs,
        eventName: "EscrowCreated",
      });
      const found = parsed.find(
        (l) =>
          address &&
          (l.args as { depositor: Address }).depositor.toLowerCase() ===
            address.toLowerCase(),
      );
      if (found) {
        const id = (found.args as { escrowId: bigint }).escrowId;
        setCreatedEscrowId(id);
      }
    } catch {
      /* ignore */
    }
  }, [depositReceipt.isSuccess, depositReceipt.data, createdEscrowId, address]);

  // Once we have the new escrow id: persist meta and navigate after a brief
  // success animation.
  useEffect(() => {
    if (!depositReceipt.isSuccess || createdEscrowId === null) return;

    if (projectName.trim()) {
      saveProjectName(createdEscrowId, projectName);
    }
    saveMilestoneMeta(
      createdEscrowId,
      milestones.map((m) => ({
        title:
          m.title === "Custom"
            ? m.customTitle || "Custom milestone"
            : m.title,
        description: m.description,
      })),
    );
    rememberCreatedAt(createdEscrowId, Math.floor(Date.now() / 1000));

    const t = setTimeout(() => {
      navigate(`/escrow/${createdEscrowId.toString()}`);
    }, 1800);
    return () => clearTimeout(t);
  }, [depositReceipt.isSuccess, createdEscrowId, milestones, projectName, navigate]);

  // Hard fallback: 5s after a confirmed deposit with no id, head to dashboard.
  useEffect(() => {
    if (!depositReceipt.isSuccess || createdEscrowId !== null) return;
    const t = setTimeout(() => {
      navigate("/");
    }, 5000);
    return () => clearTimeout(t);
  }, [depositReceipt.isSuccess, createdEscrowId, navigate]);

  if (!isConnected) {
    return <ConnectGate title="Connect to create an escrow" />;
  }

  const onApprove = () => {
    if (totalAmountBig === 0n) return;
    writeApprove(
      {
        address: USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "approve",
        args: [ESCROW_ADDRESS, totalAmountBig],
      },
      { onError: notifyTxError },
    );
  };

  const onDeposit = () => {
    if (!allValid || !address || !invoiceHash) return;
    const milestoneAmounts = milestones.map((m) => parseUSDC(m.amount));

    writeDeposit(
      {
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "deposit",
        args: [
          recipient as Address,
          // refundTo: pass address(0); contract defaults to msg.sender (the
          // depositor) so we no longer expose this as a form field.
          zeroAddress,
          totalAmountBig,
          destinationDomain,
          addressToBytes32(recipient as Address),
          BigInt(disputeWindow),
          BigInt(deliveryNoticeWindow),
          invoiceHash,
          invoiceURI,
          milestoneAmounts,
          deadlineUnix,
          [],
        ],
      },
      { onError: notifyTxError },
    );
  };

  const onSetMax = () => {
    const bal = (usdcBalance as bigint | undefined) ?? 0n;
    if (bal === 0n) return;
    // formatUnits-equivalent without locale formatting
    const units = Number(bal) / 1_000_000;
    setTotalAmount(units.toString());
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-4xl text-fg-strong tracking-tight">
          New escrow
        </h1>
        <p className="text-muted-soft mt-2">
          Lock USDC, define milestones, and let the protocol handle disputes.
        </p>
      </div>

      <Stepper step={step} />

      <div className="glass p-6 md:p-8 mt-8">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="basics"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="font-display text-xl text-fg-strong mb-6">Basics</h2>

              <div className="grid gap-5">
                <div>
                  <LabelWithTip tooltip="A label for your reference only. Not stored on the blockchain. Helps you identify this escrow in your dashboard.">
                    Project name (optional)
                  </LabelWithTip>
                  <input
                    className="input"
                    placeholder="e.g. Logo Design for Acme Co."
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    maxLength={80}
                  />
                </div>

                <div>
                  <LabelWithTip tooltip="The wallet address of the person you are paying. Double-check this. It cannot be changed after the escrow is created.">
                    Recipient address
                  </LabelWithTip>
                  <input
                    className="input font-mono"
                    placeholder="0x…"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value.trim())}
                  />
                  {recipient && !isAddress(recipient) && (
                    <p className="text-xs text-bad-soft mt-1">Not a valid address.</p>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <LabelWithTip
                        className="mb-0"
                        tooltip="The full USDC amount for this project, covering all milestones. This is locked upfront and is fully refundable if the escrow is cancelled."
                      >
                        Total amount (USDC)
                      </LabelWithTip>
                      <button
                        type="button"
                        onClick={onSetMax}
                        disabled={!usdcBalance}
                        className="text-[11px] uppercase tracking-widest text-accent hover:text-accent-soft disabled:text-muted disabled:cursor-not-allowed"
                      >
                        Max
                      </button>
                    </div>
                    <input
                      className="input mono-amount"
                      placeholder="0.00"
                      value={totalAmount}
                      onChange={(e) =>
                        setTotalAmount(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                    />
                    <p className="text-xs text-muted-soft mt-1.5">
                      Balance:{" "}
                      <span className="mono-amount text-fg">
                        {formatUSDC((usdcBalance as bigint) ?? 0n)}
                      </span>
                    </p>
                    {insufficientBalance && (
                      <p className="text-xs text-bad-soft mt-1">
                        Not enough USDC for this amount.
                      </p>
                    )}
                  </div>
                  <div>
                    <LabelWithTip tooltip="The blockchain where the recipient will receive their USDC. Choose Arc Testnet for same-chain payments. For cross-chain payments, choose the recipient's preferred chain.">
                      Destination chain
                    </LabelWithTip>
                    <ChainSelect
                      value={destinationDomain}
                      onChange={setDestinationDomain}
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <LabelWithTip tooltip="The date by which all work should be complete and approved. If you have not approved all milestones by this date, the recipient can escalate to the arbiter.">
                      Deadline
                    </LabelWithTip>
                    <input
                      type="datetime-local"
                      className="input"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </div>
                  <div>
                    <LabelWithTip tooltip="How long the recipient has to raise a dispute after you approve a milestone. Default is 72 hours. The payment releases automatically once this period ends with no dispute.">
                      Dispute window
                    </LabelWithTip>
                    <div className="flex gap-2 flex-wrap">
                      {DISPUTE_WINDOW_PRESETS.map((p) => (
                        <button
                          key={p.seconds}
                          type="button"
                          onClick={() => setDisputeWindow(p.seconds)}
                          className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                            disputeWindow === p.seconds
                              ? "bg-accent/10 text-accent border-accent/30"
                              : "bg-surface/40 text-muted-soft border-line hover:text-fg-strong"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <LabelWithTip tooltip="How long you have to review and respond after the recipient signals that work is ready for a milestone. If you take no action within this window, the payment releases automatically. Default is 7 days.">
                    Delivery Notice Window
                  </LabelWithTip>
                  <CustomSelect
                    value={deliveryNoticeWindow}
                    onChange={setDeliveryNoticeWindow}
                    options={DELIVERY_NOTICE_WINDOW_PRESETS.map((p) => ({
                      label: p.label,
                      value: p.seconds,
                    }))}
                  />
                </div>
              </div>

              <NavButtons
                canNext={validBasics}
                onNext={() => setStep(1)}
                onBack={null}
              />
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="invoice"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="font-display text-xl text-fg-strong mb-2">Invoice</h2>
              <p className="text-sm text-muted-soft mb-6">
                Link this escrow to a specific invoice. The hash proves the
                document hasn't been changed after the fact.
              </p>

              <div className="grid gap-5">
                <div>
                  <LabelWithTip tooltip="A link to your invoice document. Use a stable link such as IPFS or Google Drive. This links your escrow permanently to a specific invoice.">
                    Invoice URI
                  </LabelWithTip>
                  <input
                    className="input"
                    placeholder="https://… or ipfs://…"
                    value={invoiceURI}
                    onChange={(e) => setInvoiceURI(e.target.value.trim())}
                  />
                </div>

                <div>
                  <LabelWithTip tooltip="A fingerprint of your invoice file. Proves the invoice has not been altered. You can generate a keccak256 hash of your file using any online tool.">
                    Invoice hash
                  </LabelWithTip>
                  <div className="flex items-center gap-2 mb-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setUseCustomHash(false)}
                      className={`px-2.5 py-1 rounded ${!useCustomHash ? "bg-accent/10 text-accent" : "text-muted"}`}
                    >
                      Auto from URI
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseCustomHash(true)}
                      className={`px-2.5 py-1 rounded ${useCustomHash ? "bg-accent/10 text-accent" : "text-muted"}`}
                    >
                      Paste custom
                    </button>
                  </div>
                  {useCustomHash ? (
                    <input
                      className="input font-mono"
                      placeholder="0x… (64 hex chars)"
                      value={invoiceHashCustom}
                      onChange={(e) =>
                        setInvoiceHashCustom(e.target.value.trim())
                      }
                    />
                  ) : (
                    <div className="input font-mono text-xs text-muted-soft cursor-not-allowed truncate">
                      {invoiceHash ?? "Enter URI above to generate"}
                    </div>
                  )}
                </div>
              </div>

              <NavButtons
                canNext={validInvoice}
                onNext={() => setStep(2)}
                onBack={() => setStep(0)}
              />
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="milestones"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="font-display text-xl text-fg-strong mb-2">
                Milestones
              </h2>
              <p className="text-sm text-muted-soft mb-6">
                Sequential milestones. Their amounts must add up to the total.
              </p>

              <div className="grid gap-4">
                {milestones.map((m, i) => (
                  <MilestoneRow
                    key={i}
                    index={i}
                    value={m}
                    onChange={(next) =>
                      setMilestones((arr) =>
                        arr.map((x, j) => (j === i ? next : x)),
                      )
                    }
                    onRemove={
                      milestones.length > 1
                        ? () =>
                            setMilestones((arr) =>
                              arr.filter((_, j) => j !== i),
                            )
                        : null
                    }
                  />
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setMilestones((arr) => [
                      ...arr,
                      {
                        title: "Final Delivery",
                        customTitle: "",
                        amount: "",
                        description: "",
                      },
                    ])
                  }
                  className="btn btn-ghost"
                >
                  + Add milestone
                </button>

                <div className="mt-2 p-4 rounded-xl bg-surface/40 border border-line">
                  <div className="flex justify-between text-xs uppercase tracking-widest text-muted mb-2">
                    <span>Allocated</span>
                    <span
                      className={
                        milestoneSum === totalAmountBig
                          ? "text-ok-soft"
                          : milestoneSum > totalAmountBig
                            ? "text-bad-soft"
                            : "text-warn-soft"
                      }
                    >
                      {formatUSDC(milestoneSum)} of {formatUSDC(totalAmountBig)}
                    </span>
                  </div>
                  <div className="h-2 bg-surface/70 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        milestoneSum === totalAmountBig ? "bg-ok" : "bg-accent"
                      }`}
                      style={{
                        width: `${
                          totalAmountBig > 0n
                            ? Math.min(
                                100,
                                Number(
                                  (milestoneSum * 10000n) / totalAmountBig,
                                ) / 100,
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <NavButtons
                canNext={validMilestones}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
              />
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="review"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="font-display text-xl text-fg-strong mb-6">
                Review and deposit
              </h2>

              <div className="grid gap-3 mb-6">
                {projectName && (
                  <ReviewRow label="Project name" value={projectName} />
                )}
                <ReviewRow label="Recipient" value={recipient} mono />
                <ReviewRow
                  label="Total amount"
                  value={formatUSDC(totalAmountBig)}
                />
                <ReviewRow
                  label="Destination"
                  value={chainForDomain(destinationDomain).name}
                />
                <ReviewRow
                  label="Deadline"
                  value={new Date(deadline).toLocaleString()}
                />
                <ReviewRow
                  label="Dispute window"
                  value={
                    DISPUTE_WINDOW_PRESETS.find(
                      (p) => p.seconds === disputeWindow,
                    )?.label ?? `${disputeWindow}s`
                  }
                />
                <ReviewRow
                  label="Delivery notice window"
                  value={
                    DELIVERY_NOTICE_WINDOW_PRESETS.find(
                      (p) => p.seconds === deliveryNoticeWindow,
                    )?.label ?? `${deliveryNoticeWindow}s`
                  }
                />
                <ReviewRow label="Invoice URI" value={invoiceURI} />
                <ReviewRow label="Invoice hash" value={invoiceHash ?? ""} mono />
                <ReviewRow
                  label="Milestones"
                  value={`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`}
                />
              </div>

              <div className="rounded-xl bg-warn/5 border border-warn/15 p-4 mb-6 text-sm text-warn-soft">
                A {(PROTOCOL_FEE_BPS / 100).toFixed(2)}% protocol fee is
                deducted from each milestone when the payment is released. Your
                full deposit of{" "}
                <span className="mono-amount">
                  {formatUSDC(totalAmountBig)}
                </span>{" "}
                is locked and fully refundable if the escrow is cancelled or
                refunded.
              </div>

              <div className="grid gap-3">
                <TxStep
                  index={1}
                  title="Approve USDC"
                  description="Allow the escrow contract to pull your USDC for this deposit."
                  status={
                    isApproved
                      ? "done"
                      : approvePending || approveReceipt.isLoading
                        ? "pending"
                        : "ready"
                  }
                />

                <TxStep
                  index={2}
                  title="Create Escrow"
                  description="Lock your USDC and emit the on-chain escrow."
                  status={
                    depositReceipt.isSuccess
                      ? "done"
                      : depositPending || depositReceipt.isLoading
                        ? "pending"
                        : isApproved
                          ? "ready"
                          : "blocked"
                  }
                />
              </div>

              <div className="flex justify-between mt-8">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setStep(2)}
                  disabled={depositPending || depositReceipt.isLoading}
                >
                  Back
                </button>

                <div className="flex gap-3">
                  {!isApproved ? (
                    <button
                      type="button"
                      onClick={onApprove}
                      disabled={
                        approvePending ||
                        approveReceipt.isLoading ||
                        insufficientBalance
                      }
                      className="btn btn-primary"
                    >
                      {approvePending || approveReceipt.isLoading
                        ? "Approving…"
                        : "Approve USDC"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onDeposit}
                      disabled={depositPending || depositReceipt.isLoading}
                      className="btn btn-primary"
                    >
                      {depositPending || depositReceipt.isLoading
                        ? "Creating…"
                        : "Create Escrow"}
                    </button>
                  )}
                </div>
              </div>

              {depositReceipt.isSuccess && (
                <SuccessPanel
                  hasId={createdEscrowId !== null}
                  totalAmount={totalAmountBig}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SuccessPanel({
  hasId,
  totalAmount,
}: {
  hasId: boolean;
  totalAmount: bigint;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-xl border border-ok/30 bg-ok/10 p-5"
    >
      <div className="flex items-center gap-3">
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
          className="w-9 h-9 rounded-full bg-ok/20 text-ok flex items-center justify-center"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </motion.span>
        <div>
          <div className="font-display text-fg-strong">
            Escrow created successfully!
          </div>
          <div className="text-sm text-muted-soft">
            {formatUSDC(totalAmount)} locked.{" "}
            {hasId ? "Redirecting to your escrow…" : "Redirecting…"}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-3">
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1 flex items-center gap-3">
          <div
            className={`flex items-center gap-2 ${i <= step ? "text-fg-strong" : "text-muted"}`}
          >
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
                i < step
                  ? "bg-accent text-accent-fg"
                  : i === step
                    ? "bg-accent/20 text-accent border border-accent/30"
                    : "bg-surface/70 text-muted"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span className="hidden sm:inline text-xs font-medium uppercase tracking-widest">
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="flex-1 h-px bg-surface/70 relative">
              <div
                className="absolute inset-y-0 left-0 bg-accent/60"
                style={{ width: i < step ? "100%" : "0%" }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NavButtons({
  canNext,
  onNext,
  onBack,
}: {
  canNext: boolean;
  onNext: () => void;
  onBack: (() => void) | null;
}) {
  return (
    <div className="flex justify-between mt-8">
      {onBack ? (
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        className="btn btn-primary"
        onClick={onNext}
        disabled={!canNext}
      >
        Continue
      </button>
    </div>
  );
}

function MilestoneRow({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: MilestoneInput;
  onChange: (v: MilestoneInput) => void;
  onRemove: (() => void) | null;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface/40 p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[11px] uppercase tracking-widest text-muted">
          Milestone {index + 1}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-muted hover:text-bad-soft"
          >
            Remove
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <LabelWithTip tooltip="A label for this payment stage. Choose the option that best describes what the recipient is delivering.">
            Title
          </LabelWithTip>
          <select
            className="input"
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          >
            {MILESTONE_TITLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {value.title === "Custom" && (
            <input
              className="input mt-2"
              placeholder="Custom milestone title"
              value={value.customTitle}
              onChange={(e) =>
                onChange({ ...value, customTitle: e.target.value })
              }
            />
          )}
        </div>
        <div>
          <LabelWithTip tooltip="The USDC amount for this specific stage. All milestone amounts must add up exactly to the total escrow amount.">
            Amount
          </LabelWithTip>
          <input
            className="input mono-amount"
            placeholder="0.00"
            value={value.amount}
            onChange={(e) =>
              onChange({
                ...value,
                amount: e.target.value.replace(/[^0-9.]/g, ""),
              })
            }
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Description (optional)</label>
        <input
          className="input"
          placeholder="What needs to happen for this milestone"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-line last:border-0">
      <span className="text-xs uppercase tracking-widest text-muted">
        {label}
      </span>
      <span
        className={`text-sm text-fg truncate max-w-[60%] text-right ${mono ? "font-mono" : ""}`}
      >
        {value || "Not set"}
      </span>
    </div>
  );
}

function TxStep({
  index,
  title,
  description,
  status,
}: {
  index: number;
  title: string;
  description: string;
  status: "ready" | "pending" | "done" | "blocked";
}) {
  const dot =
    status === "done"
      ? "bg-ok"
      : status === "pending"
        ? "bg-accent animate-pulse"
        : status === "ready"
          ? "bg-accent/40"
          : "bg-surface";

  const label =
    status === "done"
      ? "Confirmed"
      : status === "pending"
        ? "Confirming…"
        : status === "ready"
          ? "Ready"
          : "Waiting";

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-surface/40 border border-line">
      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-surface/70 text-sm font-mono text-muted">
        {index}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-fg-strong">{title}</div>
        <div className="text-xs text-muted-soft">{description}</div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-fg">{label}</span>
      </div>
    </div>
  );
}

