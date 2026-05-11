// Telegram command surface for the CrossChainEscrow notifier.
import TelegramBot from 'node-telegram-bot-api';
import { isAddress, getAddress, verifyMessage } from 'viem';
import * as db from './db.js';
import { logger } from './logger.js';

const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function createBot({ token, getListenerStatus }) {
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
        'Welcome to the CrossChainEscrow notification bot.',
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
        '/start              - introduction',
        '/help               - show this message',
        '/link <wallet>      - begin linking a wallet (you will be asked to sign a message)',
        '/verify <signature> - finish linking by sending the signature',
        '/wallets            - list wallets you have linked',
        '/unlink <wallet>    - remove a linked wallet',
        '/status             - show whether the contract event listener is connected',
      ].join('\n'),
    );
  });

  // ---------- /status ----------
  bot.onText(/^\/status\b/, (msg) => {
    const s = getListenerStatus?.() ?? { connected: false, lastEventAt: null, watchingFrom: null };
    const lastEvent = s.lastEventAt ? new Date(s.lastEventAt).toISOString() : 'none yet';
    bot.sendMessage(
      msg.chat.id,
      [
        `Listener:    ${s.connected ? 'connected' : 'disconnected'}`,
        `Watching from block: ${s.watchingFrom ?? 'unknown'}`,
        `Last event:  ${lastEvent}`,
        `Contract:    ${s.contractAddress ?? 'unset'}`,
        `Chain RPC:   ${s.rpcUrl ?? 'unset'}`,
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

  return bot;
}

function randomNonce() {
  // 16 random bytes hex (no crypto-grade requirement, just uniqueness).
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
