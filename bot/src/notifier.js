// Translates contract events into rich Telegram notifications.
// Every event emits separate messages tailored to each party (depositor,
// recipient, arbiter). No two parties receive the same text.

import { getAddress } from 'viem';
import * as db from './db.js';
import { logger } from './logger.js';

const ARCSCAN_BASE = 'https://testnet.arcscan.app';

export function createNotifier({ bot, getEscrow, getMilestone, arbiterTelegramId }) {
  // ---------- low-level send helpers ----------

  async function sendToTelegramId(chatId, text) {
    if (!chatId) return;
    try {
      await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
    } catch (err) {
      logger.warn('telegram sendMessage failed', { chatId, message: err.message });
    }
  }

  async function notifyWallet(wallet, text) {
    if (!wallet) return;
    const ids = db.getTelegramIdsForWallet(wallet);
    if (ids.length === 0) {
      logger.debug('no telegram ids linked for wallet', {
        wallet,
        text: snippet(text),
      });
      return;
    }
    await Promise.all(ids.map((id) => sendToTelegramId(id, text)));
  }

  async function notifyArbiter(text) {
    if (!arbiterTelegramId) {
      logger.debug('arbiter telegram id not configured, skipping arbiter notify');
      return;
    }
    await sendToTelegramId(Number(arbiterTelegramId), text);
  }

  // ---------- event handlers ----------

  async function onEscrowCreated({ args }) {
    const { escrowId, depositor, recipient, amount, deadline } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const milestoneCount = Number(escrow.milestoneCount);
    const disputeWindow = Number(escrow.disputeWindow);
    const deliveryNoticeWindow = Number(escrow.deliveryNoticeWindow ?? 0);
    const reviewHours = Math.round(disputeWindow / 3600);
    const noticeDays = Math.round(deliveryNoticeWindow / 86400);

    const depositorMessage = [
      `You just locked ${formatUSDC(amount)} USDC into escrow.`,
      '',
      `Recipient: ${truncateAddress(recipient)}`,
      `Milestones: ${milestoneCount}`,
      `Deadline: ${formatDate(deadline)}`,
      `Review period: ${reviewHours} hours per milestone`,
      `Delivery window: ${noticeDays} days`,
      '',
      `Everything is set. When the recipient signals that work is ready, you will get a notification. You then have ${noticeDays} days to approve or raise a dispute. If you take no action, the payment releases automatically.`,
    ].join('\n');

    const recipientMessage = [
      'You have a new escrow payment waiting for you.',
      '',
      `From: ${truncateAddress(depositor)}`,
      `Total: ${formatUSDC(amount)} USDC across ${milestoneCount} milestone(s)`,
      `Deadline: ${formatDate(deadline)}`,
      `Review period per milestone: ${reviewHours} hours`,
      '',
      `The money is already locked. Start the work, and when you are ready for review, signal delivery in the app. The depositor has ${noticeDays} days to respond before the payment releases automatically.`,
    ].join('\n');

    await Promise.all([
      notifyWallet(depositor, depositorMessage),
      notifyWallet(recipient, recipientMessage),
    ]);
  }

  async function onDeliverySignaled({ args }) {
    const { escrowId, milestoneIndex } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const noticeDays = Math.round(Number(escrow.deliveryNoticeWindow ?? 0) / 86400);
    const human = ordinal(milestoneIndex);

    const depositorMessage = [
      'The recipient has marked work as ready for your review.',
      '',
      `Milestone: ${human}`,
      '',
      `You have ${noticeDays} days to respond. Open the app and either approve the milestone or raise a dispute. If you do not respond in time, the payment will release automatically.`,
    ].join('\n');

    const recipientMessage = [
      `You have signaled delivery on the ${human} milestone.`,
      '',
      `The depositor has ${noticeDays} days to review and respond. If they approve, the review period starts. If they raise a dispute, an arbiter steps in. If they take no action, the payment releases automatically when the window closes.`,
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onConditionFulfilled({ args }) {
    const { escrowId, milestoneIndex } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);
    const reviewHours = Math.round(Number(escrow.disputeWindow) / 3600);

    const depositorMessage = [
      `You approved the ${human} milestone.`,
      '',
      `Amount: ${formatUSDC(milestone.amount)} USDC`,
      `The ${reviewHours}-hour review period has started. If no dispute is raised, the payment releases automatically. No further action needed from you.`,
    ].join('\n');

    const recipientMessage = [
      `The depositor has approved your ${human} milestone.`,
      '',
      `Amount: ${formatUSDC(milestone.amount)} USDC`,
      `You have ${reviewHours} hours to raise a dispute if there is an issue. If everything is correct, the payment releases automatically when the review period ends.`,
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onSilentApprovalClaimed({ args }) {
    const { escrowId, milestoneIndex } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);

    const depositorMessage = [
      `The ${human} milestone payment was released automatically because the delivery notice window expired without a response from you.`,
      '',
      `Amount: ${formatUSDC(milestone.amount)} USDC`,
      'The review period is now active. If you believe the deliverable was not completed correctly, you can still raise a dispute in the app before the review period ends.',
    ].join('\n');

    const recipientMessage = [
      `Your ${human} milestone payment was released automatically.`,
      '',
      `Amount: ${formatUSDCAfterFee(milestone.amount)} USDC (after 1.99% protocol fee)`,
      'The depositor did not respond within the delivery window. The payment was triggered automatically and is on its way to your wallet via the Circle Forwarding Service.',
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onDisputeRaised({ args }) {
    const { escrowId, raisedBy, milestoneIndex, reason, evidenceHash } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);
    const disputedBy = getAddress(raisedBy);
    const reasonLine = reason && reason.trim() ? reason.trim() : 'No reason provided';

    const depositorMessage = [
      `A dispute has been opened on the ${human} milestone.`,
      '',
      `Amount at stake: ${formatUSDC(milestone.amount)} USDC`,
      `Raised by: ${truncateAddress(disputedBy)}`,
      `Reason: ${reasonLine}`,
      '',
      'An arbiter will review the evidence. If you have documents or context that support your position, submit counter-evidence in the app now.',
    ].join('\n');

    const recipientMessage = [
      `A dispute has been opened on the ${human} milestone.`,
      '',
      `Amount at stake: ${formatUSDC(milestone.amount)} USDC`,
      `Raised by: ${truncateAddress(disputedBy)}`,
      `Reason: ${reasonLine}`,
      '',
      'An arbiter has been notified. Submit your response in the app now if you have not already. Your evidence will be reviewed before the arbiter decides.',
    ].join('\n');

    const arbiterMessage = [
      'New dispute needs your attention.',
      '',
      `Parties: ${truncateAddress(escrow.depositor)} (depositor) and ${truncateAddress(escrow.recipient)} (recipient)`,
      `Milestone: ${human} ${formatUSDC(milestone.amount)} USDC`,
      `Raised by: ${truncateAddress(disputedBy)}`,
      `Evidence hash: ${evidenceHash}`,
      `Reason: ${reasonLine}`,
      '',
      'Open the arbiter panel to review and resolve.',
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
      notifyArbiter(arbiterMessage),
    ]);
  }

  async function onCounterEvidenceSubmitted({ args }) {
    const { escrowId, counteredBy, milestoneIndex, counterEvidenceHash } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const human = ordinal(milestoneIndex);
    const submitter = getAddress(counteredBy);
    const submitterIsRecipient =
      submitter.toLowerCase() === escrow.recipient.toLowerCase();

    // The party who DID NOT submit gets the "the other side responded" note.
    const depositorMessage = submitterIsRecipient
      ? [
          `The recipient has submitted their response to the dispute on the ${human} milestone.`,
          '',
          `Counter-evidence hash: ${counterEvidenceHash}`,
          '',
          'The arbiter now has both sides and will make a decision. You will be notified when the dispute is resolved.',
        ].join('\n')
      : null;

    const recipientMessage = !submitterIsRecipient
      ? [
          `The depositor has submitted their response to the dispute on the ${human} milestone.`,
          '',
          `Counter-evidence hash: ${counterEvidenceHash}`,
          '',
          'The arbiter now has both sides and will make a decision. You will be notified when the dispute is resolved.',
        ].join('\n')
      : null;

    const arbiterMessage = [
      `Counter-evidence submitted for the dispute on the ${human} milestone.`,
      '',
      `Escrow: ${truncateAddress(escrow.depositor)} and ${truncateAddress(escrow.recipient)}`,
      `Counter-evidence hash: ${counterEvidenceHash}`,
      '',
      'Both parties have submitted evidence. This dispute is ready for your resolution.',
    ].join('\n');

    const sends = [];
    if (depositorMessage) sends.push(notifyWallet(escrow.depositor, depositorMessage));
    if (recipientMessage) sends.push(notifyWallet(escrow.recipient, recipientMessage));
    sends.push(notifyArbiter(arbiterMessage));
    await Promise.all(sends);
  }

  async function onEscrowReleasedWithoutDispute({ args }) {
    const { escrowId, milestoneIndex } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);
    const totalMilestones = Number(escrow.milestoneCount);
    const progress = await summarizeProgress(escrowId, escrow);
    const completedMilestones = progress.completed;
    const remainingMilestones = totalMilestones - completedMilestones;

    const depositorTail =
      remainingMilestones > 0
        ? `${completedMilestones} of ${totalMilestones} milestones complete.`
        : 'All milestones are complete. This escrow is now finished.';

    const recipientTail =
      remainingMilestones > 0
        ? `${completedMilestones} of ${totalMilestones} milestones done. Keep going.`
        : 'All milestones complete. Well done.';

    const depositorMessage = [
      `The ${human} milestone payment has been released to the recipient.`,
      '',
      `Amount: ${formatUSDC(milestone.amount)} USDC`,
      'The review period ended with no dispute raised.',
      '',
      depositorTail,
    ].join('\n');

    const recipientMessage = [
      `Your ${human} milestone payment has been released.`,
      '',
      `Amount: ${formatUSDCAfterFee(milestone.amount)} USDC (after 1.99% protocol fee)`,
      'The review period ended with no dispute and the payment went through automatically.',
      '',
      recipientTail,
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onEscrowReleased({ args }) {
    // Arbiter-mediated release in favor of the recipient.
    const { escrowId, milestoneIndex, resolutionHash } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);

    const depositorMessage = [
      `The arbiter reviewed the dispute on the ${human} milestone and ruled in favor of the recipient.`,
      '',
      `Amount released: ${formatUSDC(milestone.amount)} USDC`,
      `Resolution hash: ${resolutionHash}`,
      '',
      'This decision is final and recorded on chain.',
    ].join('\n');

    const recipientMessage = [
      `The arbiter ruled in your favor on the ${human} milestone.`,
      '',
      `Amount: ${formatUSDCAfterFee(milestone.amount)} USDC (after 1.99% protocol fee)`,
      'The payment is on its way to your wallet.',
      `Resolution hash: ${resolutionHash}`,
    ].join('\n');

    const arbiterMessage = [
      `You resolved the dispute on the ${human} milestone in favor of the recipient.`,
      '',
      `Amount released: ${formatUSDC(milestone.amount)} USDC`,
      `Resolution hash: ${resolutionHash}`,
      `Escrow: ${truncateAddress(escrow.depositor)} and ${truncateAddress(escrow.recipient)}`,
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
      notifyArbiter(arbiterMessage),
    ]);
  }

  async function onEscrowRefunded({ args }) {
    // Arbiter-mediated refund in favor of the depositor.
    const { escrowId, milestoneIndex, resolutionHash } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);

    const depositorMessage = [
      `The arbiter ruled in your favor on the ${human} milestone.`,
      '',
      `Amount: ${formatUSDC(milestone.amount)} USDC added to your refund balance.`,
      `Resolution hash: ${resolutionHash}`,
      '',
      'Open the app and go to Withdraw to claim your funds.',
    ].join('\n');

    const recipientMessage = [
      `The arbiter reviewed the dispute on the ${human} milestone and ruled in favor of the depositor.`,
      '',
      `Amount: ${formatUSDC(milestone.amount)} USDC has been refunded.`,
      `Resolution hash: ${resolutionHash}`,
      '',
      'Keep the resolution hash as a reference if you need it.',
    ].join('\n');

    const arbiterMessage = [
      `You resolved the dispute on the ${human} milestone in favor of the depositor.`,
      '',
      `Amount refunded: ${formatUSDC(milestone.amount)} USDC`,
      `Resolution hash: ${resolutionHash}`,
      `Escrow: ${truncateAddress(escrow.depositor)} and ${truncateAddress(escrow.recipient)}`,
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.refundTo || escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
      notifyArbiter(arbiterMessage),
    ]);
  }

  async function onEscrowRefundedViaMutualCancel({ args }) {
    const { escrowId } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const depositorMessage = [
      'The escrow has been cancelled by mutual agreement.',
      '',
      'Your refund balance has been updated with the remaining milestone amounts. Open the app and go to Withdraw to claim your funds.',
    ].join('\n');

    const recipientMessage = [
      'The escrow has been cancelled by mutual agreement.',
      '',
      'Any milestone payments that were already released have been sent to your wallet. No further payments will come from this escrow.',
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onEscalatedAfterDeadline({ args }) {
    const { escrowId, milestoneIndex, evidenceHash } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;

    const human = ordinal(milestoneIndex);

    const depositorMessage = [
      `The ${human} milestone has been escalated to the arbiter by the recipient.`,
      '',
      `Amount at stake: ${formatUSDC(milestone.amount)} USDC`,
      'The project deadline passed without you approving this milestone.',
      '',
      'An arbiter will review the evidence. Submit your counter-evidence in the app now if you have a reason for not approving.',
    ].join('\n');

    const recipientMessage = [
      `You have escalated the ${human} milestone to the arbiter.`,
      '',
      `Amount at stake: ${formatUSDC(milestone.amount)} USDC`,
      'The arbiter has been notified and will review your evidence. You will be notified when a decision is made.',
    ].join('\n');

    const arbiterMessage = [
      'A deadline escalation needs your attention.',
      '',
      `Parties: ${truncateAddress(escrow.depositor)} (depositor) and ${truncateAddress(escrow.recipient)} (recipient)`,
      `Milestone: ${human} ${formatUSDC(milestone.amount)} USDC`,
      'The project deadline passed and the depositor never approved this milestone.',
      `Evidence hash: ${evidenceHash}`,
      '',
      'Open the arbiter panel to review and resolve.',
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
      notifyArbiter(arbiterMessage),
    ]);
  }

  async function onRefundWithdrawn({ args, transactionHash }) {
    // Event signature: RefundWithdrawn(address indexed depositor, uint256 amount)
    // The first arg is the destination address (named `recipient` in the new
    // contract, but the indexed slot is still where the wallet that received
    // the funds shows up).
    const recipient = args.recipient ?? args.depositor;
    const amount = args.amount;

    const message = [
      'Your withdrawal was successful.',
      '',
      `Amount: ${formatUSDC(amount)} USDC sent to ${truncateAddress(recipient)}`,
      `Transaction: ${transactionHash}`,
      transactionHash ? `${ARCSCAN_BASE}/tx/${transactionHash}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    // Goes to whichever wallet actually received the funds.
    await notifyWallet(recipient, message);
  }

  async function onMintRecipientUpdated({ args }) {
    const { escrowId, newMintRecipient } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const newAddress = bytes32ToAddress(newMintRecipient);

    const depositorMessage = [
      'The recipient has updated their payment destination for this escrow.',
      '',
      `New address: ${truncateAddress(newAddress)}`,
      '',
      'Future milestone payments will now be sent to this address. If you did not expect this change, contact the recipient directly.',
    ].join('\n');

    const recipientMessage = [
      'Your payment destination has been updated successfully.',
      '',
      `New address: ${truncateAddress(newAddress)}`,
      'All future milestone payments from this escrow will go to this address.',
    ].join('\n');

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  // ---------- helpers ----------

  async function safeGetEscrow(escrowId) {
    try {
      return await getEscrow(escrowId);
    } catch (err) {
      logger.warn('failed to read escrow', {
        escrowId: String(escrowId),
        message: err.message,
      });
      return null;
    }
  }

  async function safeGetMilestone(escrowId, milestoneIndex) {
    try {
      return await getMilestone(escrowId, milestoneIndex);
    } catch (err) {
      logger.warn('failed to read milestone', {
        escrowId: String(escrowId),
        milestoneIndex: String(milestoneIndex),
        message: err.message,
      });
      return null;
    }
  }

  async function summarizeProgress(escrowId, escrow) {
    const total = Number(escrow.milestoneCount);
    let completed = 0;
    for (let i = 0; i < total; i++) {
      const m = await safeGetMilestone(escrowId, i);
      if (!m) continue;
      // RELEASED=3, REFUNDED=4 both count as "complete"
      if (Number(m.state) === 3 || Number(m.state) === 4) completed += 1;
    }
    return { completed, total };
  }

  return {
    sendToTelegramId,
    notifyWallet,
    notifyArbiter,
    handlers: {
      EscrowCreated: onEscrowCreated,
      DeliverySignaled: onDeliverySignaled,
      ConditionFulfilled: onConditionFulfilled,
      SilentApprovalClaimed: onSilentApprovalClaimed,
      DisputeRaised: onDisputeRaised,
      CounterEvidenceSubmitted: onCounterEvidenceSubmitted,
      EscrowReleased: onEscrowReleased,
      EscrowReleasedWithoutDispute: onEscrowReleasedWithoutDispute,
      EscrowRefunded: onEscrowRefunded,
      EscrowRefundedViaMutualCancel: onEscrowRefundedViaMutualCancel,
      EscalatedAfterDeadline: onEscalatedAfterDeadline,
      RefundWithdrawn: onRefundWithdrawn,
      MintRecipientUpdated: onMintRecipientUpdated,
    },
  };
}

// ---------- formatting (per spec) ----------

function truncateAddress(address) {
  if (!address || String(address).length < 10) return String(address ?? 'unknown');
  const a = String(address);
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function formatUSDC(rawAmount) {
  const amount = Number(rawAmount ?? 0n) / 1_000_000;
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUSDCAfterFee(rawAmount) {
  const amount = Number(rawAmount ?? 0n) / 1_000_000;
  const net = amount - amount * 0.0199;
  return net.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(timestamp) {
  return new Date(Number(timestamp) * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ordinal(n) {
  const num = Number(n) + 1;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = num % 100;
  return num + (s[(v - 20) % 10] || s[v] || s[0]);
}

function bytes32ToAddress(b32) {
  if (!b32) return '0x';
  const hex = String(b32).toLowerCase();
  // bytes32 mintRecipient packs an EVM address in the low-order 20 bytes.
  if (hex.length === 66) return '0x' + hex.slice(-40);
  return hex;
}

function snippet(s) {
  return String(s).slice(0, 80);
}
