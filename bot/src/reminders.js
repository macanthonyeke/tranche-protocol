// Hourly cron that scans active escrows and sends timed reminders to the
// depositor (deadline approaching) and both parties (dispute window closing).
import cron from 'node-cron';
import * as db from './db.js';
import { logger } from './logger.js';

// Window thresholds (seconds remaining) at which we fire reminders.
const DEADLINE_THRESHOLDS_SEC = [24 * 3600, 6 * 3600];
const DISPUTE_THRESHOLDS_SEC = [24 * 3600, 6 * 3600];

const ESCROW_STATE_ACTIVE = 0;
const MS_PENDING = 0;
const MS_FULFILLED = 1;

export function startReminders({ listener, notifier, schedule = '0 * * * *' }) {
  const task = cron.schedule(schedule, () => runOnce({ listener, notifier }), { scheduled: false });
  task.start();
  // Run immediately on startup so a freshly restarted bot doesn't sit silent.
  runOnce({ listener, notifier }).catch((err) =>
    logger.warn('initial reminder scan failed', { message: err.message }),
  );
  return task;
}

export async function runOnce({ listener, notifier }) {
  let count;
  try {
    count = await listener.getEscrowCount();
  } catch (err) {
    logger.warn('reminder scan: getEscrowCount failed', { message: err.message });
    return;
  }
  const total = Number(count);
  const nowSec = Math.floor(Date.now() / 1000);

  for (let id = 1; id <= total; id++) {
    try {
      await scanOne(id, nowSec, listener, notifier);
    } catch (err) {
      logger.warn('reminder scan: per-escrow error', { id, message: err.message });
    }
  }
}

async function scanOne(escrowId, nowSec, listener, notifier) {
  const e = await listener.getEscrow(escrowId);
  if (Number(e.state) !== ESCROW_STATE_ACTIVE) return;

  // ---- deadline reminders ----
  const deadline = Number(e.deadline);
  const secsToDeadline = deadline - nowSec;
  for (const threshold of DEADLINE_THRESHOLDS_SEC) {
    if (secsToDeadline <= threshold && secsToDeadline > 0) {
      const key = `deadline:${escrowId}:${threshold}`;
      if (!db.hasReminderBeenSent(key)) {
        const hours = Math.max(1, Math.round(secsToDeadline / 3600));
        await notifier.notifyWallet(
          e.depositor,
          `Reminder: Escrow #${escrowId} deadline is in ${hours} hours. Confirm milestone or the recipient can escalate.`,
        );
        db.markReminderSent(key);
      }
    }
  }

  // ---- dispute window reminders (per FULFILLED milestone) ----
  const disputeWindow = Number(e.disputeWindow);
  const milestoneCount = Number(e.milestoneCount);
  for (let idx = 0; idx < milestoneCount; idx++) {
    const m = await listener.getMilestone(escrowId, idx);
    if (Number(m.state) !== MS_FULFILLED) continue;

    const closes = Number(m.conditionMetTimestamp) + disputeWindow;
    const secsToClose = closes - nowSec;
    if (secsToClose <= 0) continue;

    for (const threshold of DISPUTE_THRESHOLDS_SEC) {
      if (secsToClose <= threshold) {
        const key = `dispute:${escrowId}:${idx}:${threshold}`;
        if (!db.hasReminderBeenSent(key)) {
          const hours = Math.max(1, Math.round(secsToClose / 3600));
          const text = `Dispute window for Escrow #${escrowId}, Milestone ${idx} closes in ${hours} hours.`;
          await Promise.all([
            notifier.notifyWallet(e.depositor, text),
            notifier.notifyWallet(e.recipient, text),
          ]);
          db.markReminderSent(key);
        }
      }
    }
  }

  // Mark MS_PENDING just to silence linter on unused import; not used in scan.
  void MS_PENDING;
}
