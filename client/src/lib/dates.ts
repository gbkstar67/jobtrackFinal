/**
 * The viewer's own calendar date as YYYY-MM-DD.
 *
 * en-CA formats as YYYY-MM-DD, and toLocaleDateString resolves in the browser's
 * timezone — which is the point. The server runs UTC, so anything derived there
 * flips to tomorrow at 8pm in Pennsylvania and shows tomorrow's work as due now.
 */
export function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** "Mon, Nov 4" — short enough for a list row. Parsed as local, not UTC. */
export function formatDueDate(date: string, today = localToday()): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T00:00:00`);
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toLocaleDateString("en-CA") === tomorrow.toLocaleDateString("en-CA")) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "7:00 AM" from "07:00". */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function isOverdue(dueDate: string | null, today = localToday()): boolean {
  return Boolean(dueDate && dueDate < today);
}
