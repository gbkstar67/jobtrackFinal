import type { Task } from "@shared/schema";

/**
 * Every date computation the calendar needs, on the viewer's clock.
 *
 * The only place allowed to construct a Date, so the two traps have one site
 * to be wrong at: `new Date("2026-03-08")` parses as UTC midnight and comes
 * back as March 7 in Pennsylvania, and `getTime() + n * 86400000` yields the
 * same calendar day twice across a spring-forward.
 */
export const MONTH_CELLS = 42;   // always 6 rows, so the page height never jumps
export const AGENDA_DAYS = 45;

/** Build from PARTS at local noon — never from a string, never at midnight. */
export function parseLocal(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function toISODate(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

/** Calendar-field arithmetic, so a DST shift cannot repeat or skip a day. */
export function addDays(date: string, n: number): string {
  const d = parseLocal(date);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(cursor: string, n: number): string {
  const [y, m] = cursor.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(cursor: string): string {
  return parseLocal(`${cursor}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function monthGridRange(cursor: string) {
  const first = parseLocal(`${cursor}-01`);
  const from = addDays(toISODate(first), -first.getDay());
  const days = Array.from({ length: MONTH_CELLS }, (_, i) => addDays(from, i));
  return { from, to: days[MONTH_CELLS - 1], days };
}

export function agendaRange(anchor: string) {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(anchor, i));
  return { from: anchor, to: days[AGENDA_DAYS - 1], days };
}

export function groupByDay(tasks: Task[]): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const list = out.get(t.dueDate);
    if (list) list.push(t);
    else out.set(t.dueDate, [t]);
  }
  return out;
}

export function dayHeading(date: string, today: string): string {
  const label = parseLocal(date).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  if (date === today) return `Today · ${label}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

/**
 * A stable colour per job, so the same job is the same colour on every screen
 * and across reloads. Hashing the id rather than indexing a list means it does
 * not shift when a job is added or deleted.
 */
const JOB_HUES = [210, 28, 150, 280, 340, 190, 45, 260, 120, 15];
export function jobHue(jobId: number): number {
  return JOB_HUES[jobId % JOB_HUES.length];
}
