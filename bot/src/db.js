// SQLite store for wallet <-> Telegram bindings, pending sign-in challenges,
// and reminder idempotency keys.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '../data/bot.sqlite');

let db;

export function openDatabase(filePath = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      wallet_address TEXT PRIMARY KEY,
      telegram_id   INTEGER NOT NULL,
      linked_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS wallets_by_tg ON wallets(telegram_id);

    CREATE TABLE IF NOT EXISTS pending_links (
      telegram_id    INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      message        TEXT NOT NULL,
      nonce          TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      PRIMARY KEY (telegram_id, wallet_address)
    );

    CREATE INDEX IF NOT EXISTS pending_by_tg ON pending_links(telegram_id, created_at);

    CREATE TABLE IF NOT EXISTS reminders_sent (
      reminder_key TEXT PRIMARY KEY,
      sent_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}

// ---------- wallet linking ----------

export function getLinkedWallets(telegramId) {
  return db
    .prepare('SELECT wallet_address FROM wallets WHERE telegram_id = ? ORDER BY linked_at ASC')
    .all(telegramId)
    .map((r) => r.wallet_address);
}

export function getTelegramIdsForWallet(wallet) {
  const w = wallet.toLowerCase();
  return db
    .prepare('SELECT telegram_id FROM wallets WHERE wallet_address = ?')
    .all(w)
    .map((r) => r.telegram_id);
}

export function linkWallet(wallet, telegramId) {
  db.prepare(
    'INSERT OR REPLACE INTO wallets (wallet_address, telegram_id, linked_at) VALUES (?, ?, ?)',
  ).run(wallet.toLowerCase(), telegramId, Date.now());
}

export function unlinkWallet(wallet, telegramId) {
  return db
    .prepare('DELETE FROM wallets WHERE wallet_address = ? AND telegram_id = ?')
    .run(wallet.toLowerCase(), telegramId).changes > 0;
}

// ---------- pending links ----------

export function savePendingLink({ telegramId, wallet, message, nonce }) {
  db.prepare(
    `INSERT OR REPLACE INTO pending_links
     (telegram_id, wallet_address, message, nonce, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(telegramId, wallet.toLowerCase(), message, nonce, Date.now());
}

export function getLatestPendingLink(telegramId) {
  return db
    .prepare(
      `SELECT wallet_address, message, nonce, created_at
       FROM pending_links
       WHERE telegram_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(telegramId);
}

export function clearPendingLink(telegramId, wallet) {
  db.prepare('DELETE FROM pending_links WHERE telegram_id = ? AND wallet_address = ?').run(
    telegramId,
    wallet.toLowerCase(),
  );
}

export function purgeExpiredPendingLinks(maxAgeMs) {
  db.prepare('DELETE FROM pending_links WHERE created_at < ?').run(Date.now() - maxAgeMs);
}

// ---------- reminder idempotency ----------

export function hasReminderBeenSent(key) {
  return !!db.prepare('SELECT 1 FROM reminders_sent WHERE reminder_key = ?').get(key);
}

export function markReminderSent(key) {
  db.prepare('INSERT OR IGNORE INTO reminders_sent (reminder_key, sent_at) VALUES (?, ?)').run(
    key,
    Date.now(),
  );
}

// ---------- generic key/value sync state ----------

export function getSyncValue(key) {
  return db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key)?.value;
}

export function setSyncValue(key, value) {
  db.prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)').run(key, String(value));
}

export function rawDb() {
  return db;
}
