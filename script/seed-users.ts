/**
 * One-time seed for the four JobTrack accounts.
 *
 *   npx tsx script/seed-users.ts
 *
 * Prompts for each password interactively. Nothing is hardcoded, nothing is
 * written to disk except the scrypt hash, and the terminal echo is turned off
 * while you type so the passwords don't end up in your shell scrollback.
 *
 * Run it against the live database from inside the Railway container:
 *   railway ssh
 *   npx tsx script/seed-users.ts
 *
 * Re-running is safe: it updates the password on an existing account rather
 * than creating a duplicate.
 */
import readline from "readline";
import { Writable } from "stream";
import { sqlite } from "../server/db";
import { hashPassword } from "../server/auth";

// id is pinned deliberately. The live jobs table already has created_by and
// assigned_to values, and activity_log has employee_id values, all pointing at
// existing employee ids. Letting AUTOINCREMENT hand out fresh ids would orphan
// every one of those references.
const ACCOUNTS = [
  { id: 1, username: "grant",  name: "Grant",  role: "Admin",          color: "bg-orange-500" },
  { id: 2, username: "henry",  name: "Henry",  role: "Owner",          color: "bg-emerald-500" },
  { id: 3, username: "mike",   name: "Mike",   role: "Superintendent", color: "bg-blue-500" },
  { id: 4, username: "jen",    name: "Jen",    role: "Secretary",      color: "bg-purple-500" },
];

/** Read a line with the echo suppressed. */
function prompt(question: string, hidden = false): Promise<string> {
  let muted = false;
  const mutableOut = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableOut,
    terminal: true,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

async function main() {
  console.log(`\nSeeding accounts into: ${process.env.DATABASE_PATH || "./data.db"}\n`);

  // Report what's about to be displaced, before displacing it.
  const existing = sqlite
    .prepare("SELECT id, name, username FROM employees ORDER BY id")
    .all() as Array<{ id: number; name: string; username: string | null }>;

  if (existing.length > 0) {
    console.log("Employees currently in the database:");
    for (const e of existing) {
      console.log(`  id=${e.id}  ${e.name}${e.username ? `  (login: ${e.username})` : ""}`);
    }

    const keptIds = new Set(ACCOUNTS.map((a) => a.id));
    const displaced = existing.filter((e) => !keptIds.has(e.id));
    if (displaced.length > 0) {
      const refs = displaced.map((e) => {
        const jobCount = (
          sqlite
            .prepare("SELECT COUNT(*) AS n FROM jobs WHERE assigned_to = ? OR created_by = ?")
            .get(e.id, e.id) as { n: number }
        ).n;
        const actCount = (
          sqlite.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE employee_id = ?").get(e.id) as {
            n: number;
          }
        ).n;
        return `  id=${e.id} ${e.name} — referenced by ${jobCount} job(s), ${actCount} activity row(s)`;
      });
      console.log("\nThese rows will be REMOVED and their references orphaned:");
      console.log(refs.join("\n"));
    }

    const ok = await prompt("\nReplace the employees table with the four accounts? (yes/no): ");
    if (ok.toLowerCase() !== "yes") {
      console.log("Aborted. Nothing changed.");
      process.exit(0);
    }
  }

  const hashes: Array<{ id: number; hash: string }> = [];
  for (const account of ACCOUNTS) {
    let password = "";
    while (password.length < 8) {
      password = await prompt(`Password for ${account.name} (${account.username}), min 8 chars: `, true);
      if (password.length < 8) console.log("  Too short — try again.");
    }
    const confirm = await prompt(`Confirm password for ${account.name}: `, true);
    if (password !== confirm) {
      console.error(`\nPasswords for ${account.name} did not match. Nothing was written. Start over.`);
      process.exit(1);
    }
    hashes.push({ id: account.id, hash: await hashPassword(password) });
  }

  const createdAt = new Date().toISOString();

  // One transaction: either all four accounts exist afterwards, or none of this
  // happened and the old table is untouched.
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM employees").run();
    // Reset AUTOINCREMENT so employees added later start above id 4.
    sqlite.prepare("DELETE FROM sqlite_sequence WHERE name = 'employees'").run();

    const insert = sqlite.prepare(
      `INSERT INTO employees (id, name, role, phone, email, color, active, created_at, username, password_hash)
       VALUES (?, ?, ?, NULL, NULL, ?, 1, ?, ?, ?)`,
    );

    for (const account of ACCOUNTS) {
      const { hash } = hashes.find((h) => h.id === account.id)!;
      insert.run(account.id, account.name, account.role, account.color, createdAt, account.username, hash);
    }

    // Existing sessions reference the old rows; force everyone to sign in again.
    sqlite.prepare("DELETE FROM sessions").run();
  })();

  console.log("\nDone. Four accounts seeded:");
  for (const a of ACCOUNTS) console.log(`  ${a.username.padEnd(8)} id=${a.id}  ${a.name} — ${a.role}`);
  console.log("\nAll existing sessions were cleared. Everyone signs in fresh.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSeed failed. Nothing was committed:", err);
  process.exit(1);
});
