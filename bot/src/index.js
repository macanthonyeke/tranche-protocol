// Entry point: wires DB, Telegram bot, viem listener, reminder cron.
import 'dotenv/config';
import * as db from './db.js';
import { createBot } from './bot.js';
import { createListener, loadAbi } from './listener.js';
import { createNotifier } from './notifier.js';
import { startReminders } from './reminders.js';
import { logger } from './logger.js';

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

async function main() {
  const TELEGRAM_BOT_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
  const RPC_URL = requireEnv('ARC_TESTNET_RPC_URL');
  const CONTRACT_ADDRESS = requireEnv('CONTRACT_ADDRESS');
  const CHAIN_ID = process.env.ARC_CHAIN_ID ?? '0';
  const ARBITER_TELEGRAM_ID = process.env.ARBITER_TELEGRAM_ID || '';
  const REMINDER_CRON = process.env.REMINDER_CRON || '0 * * * *';

  db.openDatabase();

  const abi = loadAbi();

  // Listener is built first because the notifier needs its read helpers.
  // We attach handlers (notifier.handlers) lazily via listener.start() so the
  // notifier can hold a back-reference to the listener for on-demand reads.
  const ref = {};

  const listener = createListener({
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    contractAddress: CONTRACT_ADDRESS,
    abi,
    notifier: { handlers: {} }, // placeholder, replaced below
  });
  ref.listener = listener;

  const bot = createBot({
    token: TELEGRAM_BOT_TOKEN,
    listener,
  });

  const notifier = createNotifier({
    bot,
    arbiterTelegramId: ARBITER_TELEGRAM_ID,
    getEscrow: (id) => ref.listener.getEscrow(id),
    getMilestone: (id, idx) => ref.listener.getMilestone(id, idx),
  });

  // Inject the real handlers into the listener and start watching.
  listener.setHandlers(notifier.handlers);
  listener.start();

  const reminderTask = startReminders({ listener, notifier, schedule: REMINDER_CRON });

  logger.info('bot online', {
    contract: CONTRACT_ADDRESS,
    rpc: RPC_URL,
    cron: REMINDER_CRON,
    arbiterTelegramId: ARBITER_TELEGRAM_ID || '<unset>',
  });

  // ---------- graceful shutdown ----------
  const shutdown = (sig) => {
    logger.info('shutdown initiated', { signal: sig });
    try {
      reminderTask.stop();
    } catch {}
    try {
      listener.stop();
    } catch {}
    try {
      bot.stopPolling();
    } catch {}
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (err) => {
    logger.error('unhandledRejection', { message: err?.message ?? String(err) });
  });
}

main().catch((err) => {
  logger.error('fatal startup error', { message: err.message, stack: err.stack });
  process.exit(1);
});
