// Translates contract events into plain-English Telegram notifications.
// Every event emits separate messages tailored to each party. Each message:
//   1. Says what happened in human language.
//   2. Names whose escrow it is (escrow id always present).
//   3. Ends with a clear next step when one is needed.

import { getAddress } from 'viem';
import * as db from './db.js';
import { logger } from './logger.js';

const ARCSCAN_BASE = 'https://testnet.arcscan.app';

const CCTP_CHAIN_NAMES = {
  0: 'Ethereum Sepolia',
  1: 'Avalanche Fuji',
  2: 'OP Sepolia',
  3: 'Arbitrum Sepolia',
  6: 'Base Sepolia',
  7: 'Polygon Amoy',
  11: 'Linea Sepolia',
  19: 'Scroll Sepolia',
  21: 'Sui Testnet',
  22: 'Aptos Testnet',
  23: 'Unichain Sepolia',
  24: 'Sonic Blaze',
  25: 'Ink Sepolia',
  26: 'Arc Testnet',
  27: 'World Chain Sepolia',
  28: 'ZKSync Sepolia',
  29: 'Berachain bArtio',
  30: 'Corn Testnet',
  31: 'Codex Testnet',
};

function chainName(domain) {
  if (domain === undefined || domain === null) return 'unknown chain';
  return CCTP_CHAIN_NAMES[Number(domain)] || `domain ${Number(domain)}`;
}

export function createNotifier({ bot, getEscrow, getMilestone, arbiterTelegramId }) {
  // ---------- low-level send helpers ----------

  async function sendToTelegramId(chatId, text) {
    if (!chatId) return;
    try {
      await bot.sendMessage(chatId, text, {
        disable_web_page_preview: true,
        parse_mode: 'Markdown',
      });
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

  async function onEscrowCreated({ args, transactionHash }) {
    const { escrowId, depositor, recipient, amount, deadline } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const noticeDays = Math.round(Number(escrow.deliveryNoticeWindow ?? 0) / 86400);
    const milestones = Number(escrow.milestoneCount);

    const depositorMessage = [
      `Escrow #${escrowId}: you locked ${formatUSDC(amount)} USDC for ${addr(recipient)} across ${milestones} milestone(s), due ${formatDate(deadline)}.`,
      `When the freelancer signals delivery you have ${noticeDays} days to approve or dispute, otherwise the milestone releases automatically.`,
      txLink(transactionHash),
    ].filter(Boolean).join('\n\n');

    const recipientMessage = [
      `Escrow #${escrowId}: ${addr(depositor)} has locked ${formatUSDC(amount)} USDC for you across ${milestones} milestone(s), due ${formatDate(deadline)}.`,
      `Start the work. When a milestone is ready, signal delivery in the app so the ${noticeDays}-day review window can begin.`,
    ].join('\n\n');

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

    const depositorMessage =
      `Escrow #${escrowId}: the freelancer says the ${ordinal(milestoneIndex)} milestone is ready. ` +
      `You have ${noticeDays} days to approve or dispute it in the app. ` +
      `If you do nothing, the milestone releases automatically.`;

    const recipientMessage =
      `Escrow #${escrowId}: your delivery signal for the ${ordinal(milestoneIndex)} milestone is in. ` +
      `The payer now has ${noticeDays} days to approve or dispute. No action needed from you right now.`;

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
    const reviewHours = Math.round(Number(escrow.disputeWindow) / 3600);

    const depositorMessage =
      `Escrow #${escrowId}: you approved the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC). ` +
      `The ${reviewHours}-hour review window has started and the payment releases automatically when it ends. No further action needed.`;

    const recipientMessage =
      `Escrow #${escrowId}: the payer approved your ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC). ` +
      `Payment releases automatically in ${reviewHours} hours. No action needed unless you spot an issue.`;

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

    const depositorMessage =
      `Escrow #${escrowId}: the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC) was auto-released because the delivery review window passed without a response from you. ` +
      `If you believe the work wasn't done, you can still raise a dispute before the dispute window closes.`;

    const recipientMessage =
      `Escrow #${escrowId}: your ${ordinal(milestoneIndex)} milestone was auto-released. ` +
      `${formatUSDCAfterFee(milestone.amount)} USDC (after the 1.99% fee) is on its way to your wallet via Circle.`;

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
    const reasonText = reason && reason.trim() ? md(reason.trim()) : 'no reason given';

    const depositorMessage =
      `Escrow #${escrowId}: a dispute was opened on the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC at stake). ` +
      `Reason: ${reasonText}. ` +
      `Submit any counter-evidence in the app now so the arbiter can see your side.`;

    const recipientMessage =
      `Escrow #${escrowId}: a dispute was opened on the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC at stake). ` +
      `Reason: ${reasonText}. ` +
      `If you have anything to add, submit it in the app — the arbiter will review both sides.`;

    const arbiterMessage =
      `Escrow #${escrowId}: new dispute on the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC). ` +
      `Raised by ${addr(getAddress(raisedBy))}; evidence ${code(evidenceHash)}. ` +
      `Open the arbiter panel to review.`;

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
    const submitter = getAddress(counteredBy);
    const submitterIsRecipient = submitter.toLowerCase() === escrow.recipient.toLowerCase();

    const otherPartyMessage =
      `Escrow #${escrowId}: the other side has submitted their response to the dispute on the ${ordinal(milestoneIndex)} milestone. ` +
      `The arbiter now has both sides and will make a decision. No action needed from you.`;

    const arbiterMessage =
      `Escrow #${escrowId}: counter-evidence is in for the dispute on the ${ordinal(milestoneIndex)} milestone (${code(counterEvidenceHash)}). ` +
      `Both sides are now on record. Ready for your decision.`;

    const sends = [notifyArbiter(arbiterMessage)];
    if (submitterIsRecipient) {
      sends.push(notifyWallet(escrow.depositor, otherPartyMessage));
    } else {
      sends.push(notifyWallet(escrow.recipient, otherPartyMessage));
    }
    await Promise.all(sends);
  }

  async function onEscrowReleasedWithoutDispute({ args }) {
    const { escrowId, milestoneIndex } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    if (!milestone) return;
    const progress = await summarizeProgress(escrowId, escrow);
    const tail =
      progress.completed >= progress.total
        ? `All ${progress.total} milestones are now done — this escrow is complete.`
        : `Progress: ${progress.completed} of ${progress.total} milestones done.`;

    const depositorMessage =
      `Escrow #${escrowId}: the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC) has been released to the freelancer after the review window closed with no dispute. ` +
      `${tail}`;

    const recipientMessage =
      `Escrow #${escrowId}: your ${ordinal(milestoneIndex)} milestone has been released — ${formatUSDCAfterFee(milestone.amount)} USDC (after the 1.99% fee) is heading to your wallet. ` +
      `${tail}`;

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

    const depositorMessage =
      `Escrow #${escrowId}: the arbiter ruled for the freelancer on the ${ordinal(milestoneIndex)} milestone — ${formatUSDC(milestone.amount)} USDC has been released. ` +
      `Resolution ${code(resolutionHash)}. This decision is final.`;

    const recipientMessage =
      `Escrow #${escrowId}: the arbiter ruled in your favor on the ${ordinal(milestoneIndex)} milestone — ${formatUSDCAfterFee(milestone.amount)} USDC (after the 1.99% fee) is on its way to you. ` +
      `Resolution ${code(resolutionHash)}.`;

    const arbiterMessage =
      `Escrow #${escrowId}: you resolved the ${ordinal(milestoneIndex)} milestone in favor of the freelancer — ${formatUSDC(milestone.amount)} USDC released. ` +
      `Resolution ${code(resolutionHash)}.`;

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

    const depositorMessage =
      `Escrow #${escrowId}: the arbiter ruled in your favor on the ${ordinal(milestoneIndex)} milestone — ${formatUSDC(milestone.amount)} USDC has been added to your refund balance. ` +
      `Resolution ${code(resolutionHash)}. Open the app and go to Withdraw to claim it.`;

    const recipientMessage =
      `Escrow #${escrowId}: the arbiter ruled for the payer on the ${ordinal(milestoneIndex)} milestone — ${formatUSDC(milestone.amount)} USDC has been refunded. ` +
      `Resolution ${code(resolutionHash)}.`;

    const arbiterMessage =
      `Escrow #${escrowId}: you resolved the ${ordinal(milestoneIndex)} milestone in favor of the payer — ${formatUSDC(milestone.amount)} USDC refunded. ` +
      `Resolution ${code(resolutionHash)}.`;

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

    const depositorMessage =
      `Escrow #${escrowId}: cancelled by mutual agreement. ` +
      `Any unspent milestone amounts are now in your refund balance — open the app and go to Withdraw to claim them.`;

    const recipientMessage =
      `Escrow #${escrowId}: cancelled by mutual agreement. ` +
      `Any milestones already released to you are unaffected. No further payments will come from this escrow.`;

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

    const depositorMessage =
      `Escrow #${escrowId}: the freelancer escalated the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC) to the arbiter because the project deadline passed without your approval. ` +
      `Submit counter-evidence in the app now if you have a reason for not approving.`;

    const recipientMessage =
      `Escrow #${escrowId}: your escalation of the ${ordinal(milestoneIndex)} milestone is in front of the arbiter. ` +
      `You'll get a notification when a decision is made.`;

    const arbiterMessage =
      `Escrow #${escrowId}: deadline escalation on the ${ordinal(milestoneIndex)} milestone (${formatUSDC(milestone.amount)} USDC). ` +
      `Evidence ${code(evidenceHash)}. Open the arbiter panel to review.`;

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
      notifyArbiter(arbiterMessage),
    ]);
  }

  async function onRefundWithdrawn({ args, transactionHash }) {
    const recipient = args.recipient ?? args.depositor;
    const amount = args.amount;
    const message =
      `Your withdrawal went through — ${formatUSDC(amount)} USDC sent to ${addr(recipient)}. ` +
      `${txLink(transactionHash)}`;
    await notifyWallet(recipient, message);
  }

  async function onReceivingAddressUpdated({ args }) {
    const { escrowId, oldAddress, newAddress, oldDomain, newDomain } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;

    const newAddr = bytes32ToAddress(newAddress);
    const oldAddr = oldAddress ? bytes32ToAddress(oldAddress) : null;
    const changedAddr = oldAddr && oldAddr.toLowerCase() !== newAddr.toLowerCase();
    const changedDomain = oldDomain !== undefined && Number(oldDomain) !== Number(newDomain);

    const change =
      changedAddr && changedDomain
        ? `address and destination chain (now ${chainName(newDomain)})`
        : changedDomain
          ? `destination chain (now ${chainName(newDomain)})`
          : 'address';

    const depositorMessage =
      `Escrow #${escrowId}: the freelancer updated their receiving ${change}. ` +
      `Future milestone payments will go to ${addr(newAddr)} on ${chainName(newDomain)}. ` +
      `If you didn't expect this, contact the freelancer directly.`;

    const recipientMessage =
      `Escrow #${escrowId}: your receiving ${change} has been updated successfully. ` +
      `Future milestone payments will land at ${addr(newAddr)} on ${chainName(newDomain)}.`;

    await Promise.all([
      notifyWallet(escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onDisputeTimedOutRefunded({ args }) {
    const { escrowId, milestoneIndex } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const milestone = await safeGetMilestone(escrowId, milestoneIndex);
    const amountLine = milestone ? ` (${formatUSDC(milestone.amount)} USDC)` : '';

    const depositorMessage =
      `Escrow #${escrowId}: the dispute on the ${ordinal(milestoneIndex)} milestone${amountLine} timed out — the arbiter didn't act within 30 days. ` +
      `The funds have been refunded to your refund balance. Open the app and go to Withdraw to claim them.`;

    const recipientMessage =
      `Escrow #${escrowId}: the dispute on the ${ordinal(milestoneIndex)} milestone${amountLine} timed out — the arbiter didn't act within 30 days, so the funds have been refunded to the payer. ` +
      `No further action on this milestone.`;

    await Promise.all([
      notifyWallet(escrow.refundTo || escrow.depositor, depositorMessage),
      notifyWallet(escrow.recipient, recipientMessage),
    ]);
  }

  async function onRefundCreditTransferred({ args }) {
    const { from, to, amount } = args;
    const oldOwnerMessage =
      `Your refund credit of ${formatUSDC(amount)} USDC has been transferred to ${addr(to)}. ` +
      `Your balance on that escrow is now zero. If you didn't request this, contact support.`;

    const newOwnerMessage =
      `You've received a refund credit of ${formatUSDC(amount)} USDC from ${addr(from)}. ` +
      `Call withdrawRefund in the app to claim it as USDC in your wallet.`;

    await Promise.all([
      notifyWallet(from, oldOwnerMessage),
      notifyWallet(to, newOwnerMessage),
    ]);
  }

  async function onEscrowTermsSnapshotted({ args }) {
    const { escrowId, protocolFeeBps, protocolTreasury } = args;
    const escrow = await safeGetEscrow(escrowId);
    if (!escrow) return;
    const feePct = (Number(protocolFeeBps) / 100).toFixed(2);

    const depositorMessage =
      `Escrow #${escrowId}: terms locked in. ` +
      `The protocol fee for this escrow is fixed at ${feePct}% and the treasury is ${addr(protocolTreasury)} — these won't change even if the protocol updates them later. No action needed.`;

    await notifyWallet(escrow.depositor, depositorMessage);
  }

  async function onSplitConfigured({ args }) {
    const { escrowId, index, mintRecipient, destinationDomain, bps } = args;
    const sharePct = (Number(bps) / 100).toFixed(2);
    const recipient = bytes32ToAddress(mintRecipient);

    const message =
      `Escrow #${escrowId}: you've been added as payment recipient #${Number(index) + 1}. ` +
      `Your share is ${sharePct}% and payments will land at ${addr(recipient)} on ${chainName(destinationDomain)}. ` +
      `No action needed — you'll be notified when funds are released.`;

    await notifyWallet(recipient, message);
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
      ReceivingAddressUpdated: onReceivingAddressUpdated,
      DisputeTimedOutRefunded: onDisputeTimedOutRefunded,
      RefundCreditTransferred: onRefundCreditTransferred,
      EscrowTermsSnapshotted: onEscrowTermsSnapshotted,
      SplitConfigured: onSplitConfigured,
    },
  };
}

// ---------- formatting ----------

function addr(address) {
  if (!address) return '`unknown`';
  try {
    return `\`${getAddress(String(address))}\``;
  } catch {
    return `\`${String(address)}\``;
  }
}

function code(value) {
  if (value === undefined || value === null) return '`unknown`';
  return `\`${String(value)}\``;
}

function md(text) {
  return String(text ?? '').replace(/[_*`\[\]]/g, '\\$&');
}

function txLink(hash) {
  if (!hash) return '';
  return `${ARCSCAN_BASE}/tx/${hash}`;
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
  if (hex.length === 66) return '0x' + hex.slice(-40);
  return hex;
}

function snippet(s) {
  return String(s).slice(0, 80);
}
