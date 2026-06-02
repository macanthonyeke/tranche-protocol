// Telegram command surface for the Tranche Protocol notifier.
import TelegramBot from 'node-telegram-bot-api';
import { isAddress, getAddress, verifyMessage } from 'viem';
import * as db from './db.js';
import { logger } from './logger.js';

const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes

const MS_DISPUTED = 2;
const ESCROW_ACTIVE = 0;
const STATUS_ESCROW_SCAN_LIMIT = 50;

export function createBot({ token, listener }) {
  const getListenerStatus = () => listener?.getStatus?.() ?? null;
  // Force IPv4: Node's happy-eyeballs tries IPv6 first, and on hosts without
  // working IPv6 the failure surfaces from @cypress/request as EFATAL: AggregateError.
  const bot = new TelegramBot(token, {
    polling: true,
    request: {
      agentOptions: { keepAlive: true, family: 4 },
    },
  });

  bot.on('polling_error', (err) => {
    logger.error('telegram polling error', { message: err.message });
  });

  // ---------- /start ----------
  bot.onText(/^\/start\b/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      [
        'Welcome to the Tranche Protocol notification bot.',
        '',
        'Link a wallet to receive notifications about your escrows:',
        '  /link 0xYourWalletAddress',
        '',
        'Type /help for the full command list.',
      ].join('\n'),
    );
  });

  // ---------- /help ----------
  bot.onText(/^\/help\b/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      [
        'Commands:',
        '/start                          - introduction',
        '/help                           - show this message',
        '/link <wallet>                  - begin linking a wallet (you will be asked to sign a message)',
        '/verify <signature>             - finish linking by sending the signature',
        '/wallets                        - list wallets you have linked',
        '/unlink <wallet>                - remove a linked wallet',
        '/status                         - listener status, your refund credits, any timed-out disputes',
        '/timeout <escrowId> <msIndex>   - check if a stuck dispute can be force-resolved by timeout',
        '/transfercredit <newAddress>    - explains how to move a refund credit to another wallet',
      ].join('\n'),
    );
  });

  // ---------- /status ----------
  bot.onText(/^\/status\b/, async (msg) => {
    const s = getListenerStatus() ?? { connected: false, lastEventAt: null, watchingFrom: null };
    const lastEvent = s.lastEventAt ? new Date(s.lastEventAt).toISOString() : 'none yet';

    const lines = [
      `Listener:    ${s.connected ? 'connected' : 'disconnected'}`,
      `Watching from block: ${s.watchingFrom ?? 'unknown'}`,
      `Last event:  ${lastEvent}`,
      `Contract:    ${s.contractAddress ?? 'unset'}`,
      `Chain RPC:   ${s.rpcUrl ?? 'unset'}`,
    ];

    const wallets = db.getLinkedWallets(msg.from.id);
    if (wallets.length === 0) {
      lines.push('', 'No linked wallets — use /link <wallet> to get personal status.');
      bot.sendMessage(msg.chat.id, lines.join('\n'));
      return;
    }

    if (!listener) {
      bot.sendMessage(msg.chat.id, lines.join('\n'));
      return;
    }

    // Refund credits per linked wallet.
    lines.push('', 'Refund credits:');
    let anyCredit = false;
    for (const w of wallets) {
      try {
        const bal = await listener.getRefundBalance(getAddress(w));
        const usdc = (Number(bal) / 1_000_000).toFixed(2);
        if (Number(bal) > 0) {
          anyCredit = true;
          lines.push(`  ${getAddress(w)}: ${usdc} USDC (call withdrawRefund to claim)`);
        }
      } catch (err) {
        lines.push(`  ${getAddress(w)}: failed to read (${err.message})`);
      }
    }
    if (!anyCredit) lines.push('  none');

    // Timed-out disputes for any escrow where one of the user's wallets is a party.
    lines.push('', 'Timed-out disputes:');
    let stuckCount = 0;
    try {
      const total = Number(await listener.getEscrowCount());
      const linkedSet = new Set(wallets.map((w) => w.toLowerCase()));
      const timeout = Number(await listener.getArbiterInactionTimeout());
      const nowSec = Math.floor(Date.now() / 1000);
      // Scan only the most recent N escrows to keep the command snappy.
      const startId = Math.max(1, total - STATUS_ESCROW_SCAN_LIMIT + 1);
      for (let id = startId; id <= total; id++) {
        const e = await listener.getEscrow(id);
        const isParty =
          linkedSet.has(e.depositor.toLowerCase()) ||
          linkedSet.has(e.recipient.toLowerCase()) ||
          (e.refundTo && linkedSet.has(e.refundTo.toLowerCase()));
        if (!isParty) continue;
        const mCount = Number(e.milestoneCount);
        for (let i = 0; i < mCount; i++) {
          const m = await listener.getMilestone(id, i);
          if (Number(m.state) !== MS_DISPUTED) continue;
          const d = await listener.getDispute(id, i);
          const elapsed = nowSec - Number(d.raisedAt);
          if (elapsed >= timeout) {
            stuckCount += 1;
            lines.push(
              `  Escrow #${id} milestone ${i}: timeout reached — anyone can call resolveDisputeByTimeout to refund the payer.`,
            );
          }
        }
      }
      if (stuckCount === 0) lines.push('  none');
    } catch (err) {
      lines.push(`  scan failed: ${err.message}`);
    }

    bot.sendMessage(msg.chat.id, lines.join('\n'));
  });

  // ---------- /timeout <escrowId> <milestoneIndex> ----------
  bot.onText(/^\/timeout(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const escrowIdArg = match?.[1];
    const milestoneArg = match?.[2];
    if (!escrowIdArg || milestoneArg === undefined) {
      bot.sendMessage(msg.chat.id, 'Usage: /timeout <escrowId> <milestoneIndex>');
      return;
    }
    const escrowId = Number(escrowIdArg);
    const milestoneIndex = Number(milestoneArg);
    if (!Number.isFinite(escrowId) || escrowId <= 0 || !Number.isFinite(milestoneIndex) || milestoneIndex < 0) {
      bot.sendMessage(msg.chat.id, 'Escrow id and milestone index must be non-negative numbers.');
      return;
    }
    if (!listener) {
      bot.sendMessage(msg.chat.id, 'Listener is not available; try again later.');
      return;
    }

    try {
      const milestone = await listener.getMilestone(escrowId, milestoneIndex);
      if (Number(milestone.state) !== MS_DISPUTED) {
        bot.sendMessage(
          msg.chat.id,
          `Escrow #${escrowId} milestone ${milestoneIndex} is not currently in a dispute. Nothing to time out.`,
        );
        return;
      }
      const dispute = await listener.getDispute(escrowId, milestoneIndex);
      const timeout = Number(await listener.getArbiterInactionTimeout());
      const nowSec = Math.floor(Date.now() / 1000);
      const elapsed = nowSec - Number(dispute.raisedAt);
      if (elapsed >= timeout) {
        bot.sendMessage(
          msg.chat.id,
          [
            `Escrow #${escrowId} milestone ${milestoneIndex}: the arbiter has not acted in ${Math.floor(elapsed / 86400)} days.`,
            'The inaction timeout has been reached. Anyone can now call resolveDisputeByTimeout(escrowId, milestoneIndex) to refund the payer.',
          ].join('\n'),
        );
      } else {
        const daysLeft = Math.max(1, Math.ceil((timeout - elapsed) / 86400));
        bot.sendMessage(
          msg.chat.id,
          `Escrow #${escrowId} milestone ${milestoneIndex}: arbiter timeout not yet reached. ${daysLeft} day(s) remaining before resolveDisputeByTimeout can be called.`,
        );
      }
    } catch (err) {
      bot.sendMessage(msg.chat.id, `Could not read escrow/milestone: ${err.message}`);
    }
  });

  // ---------- /transfercredit <newAddress> ----------
  bot.onText(/^\/transfercredit(?:\s+(\S+))?/, (msg, match) => {
    const arg = match?.[1];
    if (!arg) {
      bot.sendMessage(
        msg.chat.id,
        [
          'Usage: /transfercredit <newAddress>',
          '',
          'transferRefundCredit moves your entire refund balance from your wallet to another address you control.',
          'Call it on the contract directly (the bot does not send transactions for you).',
          'This only works if your wallet can pay gas in USDC. If your wallet has been blacklisted by Circle, contact an admin — they can use adminTransferRefundCredit on your behalf.',
        ].join('\n'),
      );
      return;
    }
    if (!isAddress(arg)) {
      bot.sendMessage(msg.chat.id, 'That does not look like a valid Ethereum address.');
      return;
    }
    const newOwner = getAddress(arg);
    bot.sendMessage(
      msg.chat.id,
      [
        `To move your refund credit to ${newOwner}:`,
        '',
        '1. Open the app while connected as the wallet that holds the credit.',
        `2. Call transferRefundCredit(${newOwner}). It moves your entire refund balance to that address.`,
        '',
        'Your wallet must be able to pay gas in USDC. If it has been blacklisted by Circle, contact an admin — they can use adminTransferRefundCredit on your behalf.',
      ].join('\n'),
    );
  });

  // ---------- /wallets ----------
  bot.onText(/^\/wallets\b/, (msg) => {
    const wallets = db.getLinkedWallets(msg.from.id);
    if (wallets.length === 0) {
      bot.sendMessage(msg.chat.id, 'You have no linked wallets. Use /link <wallet> to add one.');
      return;
    }
    bot.sendMessage(
      msg.chat.id,
      ['Your linked wallets:', ...wallets.map((w) => `  ${getAddress(w)}`)].join('\n'),
    );
  });

  // ---------- /link <wallet> ----------
  bot.onText(/^\/link(?:\s+(\S+))?/, (msg, match) => {
    const arg = match?.[1];
    if (!arg) {
      bot.sendMessage(msg.chat.id, 'Usage: /link <walletAddress>');
      return;
    }
    if (!isAddress(arg)) {
      bot.sendMessage(msg.chat.id, 'That does not look like a valid Ethereum address.');
      return;
    }
    const wallet = getAddress(arg); // checksum
    const nonce = randomNonce();
    const message = `Link wallet ${wallet} to Telegram user ${msg.from.id} - nonce: ${nonce}`;

    db.savePendingLink({
      telegramId: msg.from.id,
      wallet,
      message,
      nonce,
    });

    bot.sendMessage(
      msg.chat.id,
      [
        'Sign this exact message with your wallet (no quotes, no trailing whitespace):',
        '',
        '----- MESSAGE START -----',
        message,
        '----- MESSAGE END -----',
        '',
        'Then reply with:',
        '  /verify <signature>',
        '',
        'The challenge expires in 15 minutes.',
      ].join('\n'),
    );
  });

  // ---------- /verify <signature> ----------
  bot.onText(/^\/verify(?:\s+(\S+))?/, async (msg, match) => {
    const sig = match?.[1];
    if (!sig) {
      bot.sendMessage(msg.chat.id, 'Usage: /verify <signature>');
      return;
    }

    db.purgeExpiredPendingLinks(PENDING_TTL_MS);

    const pending = db.getLatestPendingLink(msg.from.id);
    if (!pending) {
      bot.sendMessage(
        msg.chat.id,
        'No pending wallet link found (or it expired). Start over with /link <wallet>.',
      );
      return;
    }

    let valid = false;
    try {
      valid = await verifyMessage({
        address: getAddress(pending.wallet_address),
        message: pending.message,
        signature: sig.startsWith('0x') ? sig : `0x${sig}`,
      });
    } catch (err) {
      logger.warn('verifyMessage threw', { message: err.message });
    }

    if (!valid) {
      bot.sendMessage(
        msg.chat.id,
        'Signature did not verify. Make sure you signed the exact challenge message.',
      );
      return;
    }

    db.linkWallet(pending.wallet_address, msg.from.id);
    db.clearPendingLink(msg.from.id, pending.wallet_address);
    bot.sendMessage(
      msg.chat.id,
      `Wallet ${getAddress(pending.wallet_address)} linked. You will receive notifications for its escrows.`,
    );
  });

  // ---------- /unlink <wallet> ----------
  bot.onText(/^\/unlink(?:\s+(\S+))?/, (msg, match) => {
    const arg = match?.[1];
    if (!arg || !isAddress(arg)) {
      bot.sendMessage(msg.chat.id, 'Usage: /unlink <walletAddress>');
      return;
    }
    const removed = db.unlinkWallet(arg, msg.from.id);
    bot.sendMessage(
      msg.chat.id,
      removed
        ? `Wallet ${getAddress(arg)} unlinked.`
        : `That wallet was not linked to your account.`,
    );
  });

  // Silence the linter on ESCROW_ACTIVE — it documents the state value
  // referenced by /status semantics even though we don't gate on it.
  void ESCROW_ACTIVE;

  return bot;
}

function randomNonce() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
