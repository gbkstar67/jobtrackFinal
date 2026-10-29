import { sqlite } from "./db";
import { sendToDevices, type PushTarget } from "./push";

/** Send a push to one person's own devices, so "is it me or the sweep?" is one tap. */
export async function runTestPush(companyId: number, employeeId: number, name: string) {
  const targets = sqlite
    .prepare(
      "SELECT id, transport, endpoint, p256dh, auth FROM push_devices WHERE company_id = ? AND employee_id = ?",
    )
    .all(companyId, employeeId) as PushTarget[];

  const results = await sendToDevices(targets, {
    title: "Jobdeck",
    body: `Notifications are working, ${name.split(" ")[0]}.`,
    path: "/tasks",
    tag: "test",
  });
  return results.filter((r) => r.ok).length;
}
