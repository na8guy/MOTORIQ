import { prisma } from '../lib/prisma.js';
import { notify } from '../modules/notifications/notifications.service.js';
import { refreshAllVehicles } from '../modules/vehicles/vehicle-sync.service.js';

/**
 * Daily background work: keep government vehicle data fresh, then tell members
 * about anything falling due. Without this, reminders would sit in the database
 * and never actually remind anyone.
 *
 * CAVEAT: this is an in-process timer, so it only runs while the service is
 * awake. Render's free tier spins a service down when idle, which can skip a
 * day. For production use either a paid instance or Render Cron hitting
 * POST /admin/jobs/daily. Running late is fine here — a reminder window is days
 * wide — but it must not run *twice* for the same reminder, hence notifiedAt.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Warn at these distances from the due date. */
const WARN_DAYS = [30, 7, 1];

export async function runDailyJobs(): Promise<{ refreshed: number; notified: number }> {
  const started = Date.now();

  // 1. Pull fresh MOT/tax dates from DVLA/DVSA.
  const { synced } = await refreshAllVehicles();

  // 2. Notify on anything due soon.
  const notified = await notifyDueReminders();

  console.log(
    `[jobs] daily run complete in ${Math.round((Date.now() - started) / 1000)}s — ` +
      `${synced} vehicle(s) refreshed, ${notified} reminder(s) notified`,
  );
  return { refreshed: synced, notified };
}

async function notifyDueReminders(): Promise<number> {
  const horizon = new Date(Date.now() + Math.max(...WARN_DAYS) * DAY_MS);
  const due = await prisma.reminder.findMany({
    where: { completed: false, dueDate: { lte: horizon } },
    include: { vehicle: { select: { registration: true } } },
  });

  let sent = 0;
  for (const r of due) {
    const daysLeft = Math.ceil((r.dueDate.getTime() - Date.now()) / DAY_MS);

    // Only fire on a warning threshold (or once overdue), so members don't get
    // pinged every single day for a month.
    const isThreshold = WARN_DAYS.includes(daysLeft) || daysLeft <= 0;
    if (!isThreshold) continue;

    // Don't repeat today's ping if the job runs more than once.
    if (r.notifiedAt && Date.now() - r.notifiedAt.getTime() < DAY_MS) continue;

    const copy = LABELS[r.type] ?? { title: 'Reminder', noun: 'reminder', verb: 'is due' };
    const reg = r.vehicle?.registration ? ` for ${r.vehicle.registration}` : '';
    const days = Math.abs(daysLeft);
    const plural = days === 1 ? '' : 's';
    const when =
      daysLeft < 0
        ? `${copy.verb.replace(/^is /, 'was ')} ${days} day${plural} ago`
        : daysLeft === 0
          ? `${copy.verb} today`
          : `${copy.verb} in ${days} day${plural}`;

    await notify(r.userId, {
      title: `${copy.title}${reg}`,
      body: `Your ${copy.noun}${reg} ${when}.`,
      type: 'REMINDER',
    });
    await prisma.reminder.update({ where: { id: r.id }, data: { notifiedAt: new Date() } });
    sent++;
  }
  return sent;
}

/**
 * Notification copy per reminder type. `noun` is spelled out rather than
 * lower-casing `title`, which turned "MOT" into "your mot expires…".
 */
const LABELS: Record<string, { title: string; noun: string; verb: string }> = {
  MOT: { title: 'MOT', noun: 'MOT', verb: 'expires' },
  ROAD_TAX: { title: 'Road tax', noun: 'road tax', verb: 'is due' },
  SERVICE: { title: 'Service', noun: 'service', verb: 'is due' },
  INSURANCE: { title: 'Insurance renewal', noun: 'insurance', verb: 'renews' },
  BREAKDOWN: { title: 'Breakdown cover', noun: 'breakdown cover', verb: 'renews' },
  OTHER: { title: 'Reminder', noun: 'reminder', verb: 'is due' },
};

let timer: NodeJS.Timeout | null = null;

/** Start the daily loop. Safe to call once at boot. */
export function startScheduler(): void {
  if (timer) return;

  // Don't run at boot — a redeploy would re-run everything and Render restarts
  // often. Wait a full interval, and let ops force a run via the admin route.
  timer = setInterval(() => {
    runDailyJobs().catch((err) => console.error('[jobs] daily run failed:', err));
  }, DAY_MS);

  // Never hold the process open for a timer.
  timer.unref();
  console.log('[jobs] scheduler started (daily)');
}
