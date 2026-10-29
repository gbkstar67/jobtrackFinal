/**
 * A demo company for sales calls.
 *
 *   npx tsx script/seed-demo.ts            create or refresh it
 *   npx tsx script/seed-demo.ts --reset    wipe and rebuild (between demos)
 *
 * Grant works at HL Thomas and sells to other mechanical contractors — who bid
 * against HL Thomas on the same hospital and university work. Showing a
 * prospect the real board would show them a rival's live client list.
 *
 * Dates are RELATIVE to the run, not fixed, so "2 days overdue" stays 2 days
 * overdue forever instead of decaying into "180 days overdue" by spring. Re-run
 * it before a pitch and the board looks freshly worked.
 */
import { sqlite } from "../server/db";
import { hashPassword } from "../server/auth";

const SLUG = "demo-mechanical";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "jobdeck-demo";

const offset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};

const CREW = [
  { name: "Ray Whitaker", role: "Owner", color: "bg-blue-600", login: "demo@jobdeck.app" },
  { name: "Tony Delgado", role: "Superintendent", color: "bg-emerald-500", login: null },
  { name: "Sam Pritchard", role: "Project Manager", color: "bg-orange-500", login: null },
  { name: "Dana Kowalczyk", role: "Office", color: "bg-purple-500", login: null },
];

const JOBS = [
  ["41208", "MERCY GENERAL OR SUITE 4 AHU", "Brennan Construction", "HT", "CO"],
  ["41215", "RIVERSIDE UNIVERSITY CHILLER TIE-IN", "Pace Mechanical", "DV", "CO"],
  ["41221", "ST. ANNE'S IMAGING DUCT DEMO", "St. Anne's Hospital", "HT", "TM"],
  ["41226", "NORTHGATE MALL RTU REPLACEMENT", "Northgate Properties", "HT", "CO"],
  ["41230", "CENTRAL LAB FUME HOOD EXHAUST", "Keystone Labs", "DV", "TM"],
  ["41237", "VETERANS CLINIC VAV REBALANCE", "Brennan Construction", "HT", "CO"],
  ["41244", "DISTRICT 9 SCHOOL BOILER PIPING", "District 9 Schools", "DV", "CO"],
  ["41251", "HARBOR POINT CAFE MAKEUP AIR", "Harbor Point LLC", "HT", "CO"],
];

/** [job index, title, due offset in days, time, priority, assignee index, repeat] */
const TASKS: Array<[number, string, number | null, string | null, string, number | null, string | null]> = [
  [0, "Chase AHU submittal — 9 days out", -4, null, "urgent", 2, null],
  [0, "Coordination meeting with Brennan", 0, "10:00", "normal", 1, "weekly"],
  [1, "Confirm chiller rigging date", -1, null, "urgent", 1, null],
  [1, "Release spool drawings to shop", 2, null, "normal", 2, null],
  [2, "Walk the imaging suite with the GC", 0, "07:00", "normal", 1, null],
  [2, "Price the added fire damper", 1, null, "normal", 2, null],
  [3, "Crane permit for RTU swap", 3, null, "urgent", 2, null],
  [3, "Order curb adapters", 5, null, "normal", 3, null],
  [4, "Hood certification scheduled?", -2, null, "normal", 1, null],
  [5, "Rebalance report to engineer", 4, null, "normal", 2, null],
  [6, "Boiler start-up with factory tech", 7, "08:00", "normal", 1, null],
  [6, "Submit O&M manuals", 10, null, "normal", 3, null],
  [7, "Makeup air unit delivery", 2, "13:00", "normal", 1, null],
  [7, "Friday pay applications", 1, null, "normal", 3, "weekly"],
  [0, "Call engineer back about static pressure", null, null, "normal", null, null],
];

const NOTES = [
  [0, "Walked the mechanical room with Brennan's super. Existing curb is 2in short of the new unit — flagged to engineering, waiting on a detail."],
  [2, "Demo is tight above the ceiling grid. Night work only, 6pm start, badge access through loading dock B."],
  [3, "Roof access is through the northeast stair. Building wants 48 hours notice for the crane."],
];

const CONTACTS = [
  [0, "Mike Brennan", "General Contractor", "(724) 555-0147", "mbrennan@brennanconstruction.test"],
  [0, "Priya Raman", "Mechanical Engineer", "(412) 555-0182", "praman@enginering.test"],
  [1, "Dale Hutchins", "Owner's Rep", "(724) 555-0110", null],
  [3, "Northgate Facilities", "Building", "(412) 555-0166", "facilities@northgate.test"],
];

async function main() {
  const reset = process.argv.includes("--reset");
  const now = new Date().toISOString();

  const existing = sqlite.prepare("SELECT id FROM companies WHERE slug = ?").get(SLUG) as { id: number } | undefined;

  if (existing && reset) {
    // Scoped to the demo company only — a prospect poking at it must never be
    // able to leave it dirty, and this must never touch a real tenant.
    for (const table of ["tasks", "job_photos", "job_contacts", "job_notes", "activity_log", "jobs"]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE company_id = ?`).run(existing.id);
    }
    console.log("  cleared the demo board");
  }

  let companyId: number;
  if (existing) {
    companyId = existing.id;
  } else {
    const info = sqlite
      .prepare("INSERT INTO companies (name, slug, job_number_seed, timezone, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("Demo Mechanical Co", SLUG, 41260, "America/New_York", now);
    companyId = Number(info.lastInsertRowid);
    console.log(`  created company ${companyId}`);
  }

  // Crew
  const crewIds: number[] = [];
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const member of CREW) {
    const found = sqlite
      .prepare("SELECT id FROM employees WHERE company_id = ? AND name = ?")
      .get(companyId, member.name) as { id: number } | undefined;
    if (found) { crewIds.push(found.id); continue; }

    const info = sqlite
      .prepare(
        `INSERT INTO employees (company_id, name, role, color, active, created_at, login_email, password_hash)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(companyId, member.name, member.role, member.color, now, member.login, member.login ? hash : null);
    crewIds.push(Number(info.lastInsertRowid));
  }
  sqlite.prepare("UPDATE companies SET owner_employee_id = ? WHERE id = ?").run(crewIds[0], companyId);

  // Jobs
  const jobIds: number[] = [];
  const insertJob = sqlite.prepare(
    `INSERT INTO jobs (company_id, job_number, job_name, client_name, bid_by, billing_type, assigned_to, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [i, j] of JOBS.entries()) {
    const found = sqlite
      .prepare("SELECT id FROM jobs WHERE company_id = ? AND job_number = ?")
      .get(companyId, j[0]) as { id: number } | undefined;
    if (found) { jobIds.push(found.id); continue; }
    const info = insertJob.run(companyId, j[0], j[1], j[2], j[3], j[4], crewIds[1 + (i % 3)], crewIds[0], now);
    jobIds.push(Number(info.lastInsertRowid));
  }

  // Tasks, dated relative to today so the demo never goes stale
  const insertTask = sqlite.prepare(
    `INSERT INTO tasks (company_id, job_id, title, due_date, due_time, priority, assigned_to, created_by, repeat_rule, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const have = (sqlite.prepare("SELECT COUNT(*) AS n FROM tasks WHERE company_id = ?").get(companyId) as { n: number }).n;
  if (have === 0) {
    for (const [jobIdx, title, due, time, priority, who, repeat] of TASKS) {
      insertTask.run(
        companyId, jobIds[jobIdx], title,
        due === null ? null : offset(due), time, priority,
        who === null ? null : crewIds[who], crewIds[0], repeat, now,
      );
    }
  }

  const insertNote = sqlite.prepare(
    "INSERT INTO job_notes (company_id, job_id, body, author_id, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  if ((sqlite.prepare("SELECT COUNT(*) AS n FROM job_notes WHERE company_id = ?").get(companyId) as { n: number }).n === 0) {
    for (const [idx, body] of NOTES) insertNote.run(companyId, jobIds[idx as number], body, crewIds[1], now);
  }

  const insertContact = sqlite.prepare(
    "INSERT INTO job_contacts (company_id, job_id, name, role, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  if ((sqlite.prepare("SELECT COUNT(*) AS n FROM job_contacts WHERE company_id = ?").get(companyId) as { n: number }).n === 0) {
    for (const [idx, name, role, phone, email] of CONTACTS) {
      insertContact.run(companyId, jobIds[idx as number], name, role, phone, email, now);
    }
  }

  const counts = (t: string) =>
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE company_id = ?`).get(companyId) as { n: number }).n;

  console.log(`\n  Demo Mechanical Co (company ${companyId})`);
  console.log(`    jobs ${counts("jobs")} · tasks ${counts("tasks")} · notes ${counts("job_notes")} · contacts ${counts("job_contacts")}`);
  console.log(`    sign in: demo@jobdeck.app / ${DEMO_PASSWORD}`);
  console.log(`    next job number: 41260\n`);
  process.exit(0);
}

main().catch((err) => { console.error("demo seed failed:", err); process.exit(1); });
