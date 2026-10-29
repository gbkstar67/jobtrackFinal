import { sqlite } from "./db";
import { sendToDevices, type PushTarget } from "./push";

/**
 * The reminder sweep — the half of reminders that never existed.
 *
 * migration 7 shipped tasks.remind_at, the partial index, the bell in TaskRow
 * and shiftReminder() carrying a reminder onto a repeat. Nothing ever sent
 * anything. This closes that loop.
 *
 * Runs in-process on an interval rather than as a separate worker: one Railway
 * replica, one SQLite file, and a cron container would need its own copy of the
 * database handle for no benefit.
 */

const SWEEP_MS = 60_000;

interface DueRow {
  id: number;
  companyId: number;
  title: string;
  jobNumber: string | null;
  jobName: string | null;
  assignedTo: number | null;
}

/**
 * Claim due reminders by stamping them BEFORE sending.
 *
 * Stamping first means a crash mid-send drops a reminder rather than
 * redelivering it on every subsequent tick — a notification storm on someone's
 * lock screen is worse than one missed buzz, and the task is still visibly
 * late in the app either way.
 */
function claimDue(now: string): DueRow[] {
  const rows = sqlite
    .prepare(
      `SELECT t.id          AS id,
              t.company_id  AS companyId,
              t.title       AS title,
              t.assigned_to AS assignedTo,
              j.job_number  AS jobNumber,
              j.job_name    AS jobName
         FROM tasks t
         LEFT JOIN jobs j ON j.id = t.job_id AND j.company_id = t.company_id
        WHERE t.remind_at IS NOT NULL
          AND t.reminder_sent_at IS NULL
          AND t.completed_at IS NULL
          AND t.remind_at <= ?
        LIMIT 200`,
    )
    .all(now) as DueRow[];

  if (rows.length) {
    const stamp = sqlite.prepare("UPDATE tasks SET reminder_sent_at = ? WHERE id = ?");
    const claim = sqlite.transaction((ids: number[]) => {
      for (const id of ids) stamp.run(now, id);
    });
    claim(rows.map((r) => r.id));
  }
  return rows;
}

/**
 * Who to buzz: the assignee if there is one, otherwise everyone at the company
 * with a registered device. An unassigned task that nobody is told about is the
 * same as no reminder at all.
 */
function devicesFor(companyId: number, assignedTo: number | null): PushTarget[] {
  const sql = assignedTo
    ? `SELECT id, transport, endpoint, p256dh, auth FROM push_devices
        WHERE company_id = ? AND employee_id = ?`
    : `SELECT id, transport, endpoint, p256dh, auth FROM push_devices WHERE company_id = ?`;
  const args = assignedTo ? [companyId, assignedTo] : [companyId];
  return sqlite.prepare(sql).all(...args) as PushTarget[];
}

function prune(results: Awaited<ReturnType<typeof sendToDevices>>) {
  const drop = sqlite.prepare("DELETE FROM push_devices WHERE id = ?");
  const bump = sqlite.prepare("UPDATE push_devices SET failure_count = failure_count + 1 WHERE id = ?");
  const seen = sqlite.prepare("UPDATE push_devices SET failure_count = 0, last_seen_at = ? WHERE id = ?");
  const now = new Date().toISOString();

  for (const r of results) {
    if (r.gone) drop.run(r.deviceId);
    else if (!r.ok) bump.run(r.deviceId);
    else seen.run(now, r.deviceId);
  }
  // A device that has failed repeatedly without a definitive "gone" is dead too.
  sqlite.prepare("DELETE FROM push_devices WHERE failure_count >= 10").run();
}

export async function runSweep(): Promise<number> {
  const now = new Date().toISOString();
  const due = claimDue(now);
  if (!due.length) return 0;

  for (const task of due) {
    const targets = devicesFor(task.companyId, task.assignedTo);
    if (!targets.length) {
      // Say so rather than stamping silently — "reminders don't work" is
      // almost always nobody having registered a device.
      console.log(
        `[reminders] task ${task.id} (company ${task.companyId}) had no registered device; nothing sent`,
      );
      continue;
    }

    const label = task.jobNumber ? `${task.jobNumber} · ` : "";
    const results = await sendToDevices(targets, {
      title: task.jobName ?? "Jobdeck",
      body: `${label}${task.title}`,
      path: "/tasks",
      tag: `task-${task.id}`,
    });
    prune(results);
  }
  return due.length;
}

let timer: NodeJS.Timeout | null = null;

export function startReminderSweep() {
  if (timer) return;
  timer = setInterval(() => {
    runSweep().catch((err) => console.error("[reminders] sweep failed:", err));
  }, SWEEP_MS);
  timer.unref(); // never hold the process open on shutdown
  console.log(`[reminders] sweeping every ${SWEEP_MS / 1000}s`);
}
