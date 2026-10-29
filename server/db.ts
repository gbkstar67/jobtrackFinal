import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "@shared/schema";

// Use DATABASE_PATH env var for Railway persistent volume, fallback to local
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data.db");

export const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent read/write performance (multi-user)
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

// ══════════════════════════ SCHEMA MIGRATIONS ══════════════════════════
//
// This is the ONE source of truth for the shape of the database.
//
// It used to be a bare `CREATE TABLE IF NOT EXISTS` block, which cannot alter a
// table that already exists — so the live Railway volume was effectively frozen
// at whatever shape it was first created with. There was also a migrations/
// folder of drizzle-kit output that nothing ever ran: no migrator was imported,
// and the container's only command is `node dist/index.cjs`. That folder has
// been deleted rather than left around to look authoritative.
//
// Each step below runs exactly once, in order, tracked by SQLite's user_version
// pragma. user_version lives inside the database file itself, so this works
// correctly against the existing volume without any external bookkeeping.
// Steps are append-only: never edit or reorder one that has shipped.

/** Add a column only if it isn't already there — makes steps re-runnable by hand. */
function addColumn(d: Database.Database, table: string, column: string, definition: string) {
  const existing = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (existing.some((c) => c.name === column)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const MIGRATIONS: Array<(d: Database.Database) => void> = [
  // ── 0: baseline ──
  // The original create-table block. On the live database every one of these is
  // already present, so this is a no-op there; on a fresh machine it builds the
  // starting shape that the later steps then modify.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT,
        phone TEXT,
        email TEXT,
        color TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_number TEXT NOT NULL UNIQUE,
        job_name TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_phone TEXT,
        client_email TEXT,
        client_address TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_to INTEGER,
        created_by INTEGER,
        start_date TEXT,
        due_date TEXT,
        completed_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        employee_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        timestamp TEXT NOT NULL
      );
    `);
  },

  // ── 1: authentication ──
  // Login columns on employees (same four people, so no separate users table),
  // plus a session table so logins survive a redeploy. memorystore would have
  // signed everyone out on every deploy.
  (d) => {
    addColumn(d, "employees", "username", "TEXT");
    addColumn(d, "employees", "password_hash", "TEXT");

    // Partial index: usernames must be unique, but the many employees who never
    // sign in all have NULL, and NULLs must not collide with each other.
    d.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS employees_username_unique
        ON employees (username) WHERE username IS NOT NULL;

      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        expires INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
    `);
  },

  // ── 2: activity log keeps the job's identity ──
  // Copy job_number / job_name onto each row so the trail stays readable after
  // a job is deleted. Backfilled from the jobs still present; rows whose job is
  // already gone keep NULL and fall back to whatever their details text says.
  (d) => {
    addColumn(d, "activity_log", "job_number", "TEXT");
    addColumn(d, "activity_log", "job_name", "TEXT");

    d.exec(`
      UPDATE activity_log
         SET job_number = (SELECT j.job_number FROM jobs j WHERE j.id = activity_log.job_id),
             job_name   = (SELECT j.job_name   FROM jobs j WHERE j.id = activity_log.job_id)
       WHERE job_number IS NULL
         AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = activity_log.job_id);
    `);
  },

  // ── 3: drop status and the two dates we no longer track ──
  //
  // DESTRUCTIVE. Every job's status, due date and completed date is removed
  // here and cannot be recovered from the database afterwards. The rows
  // themselves are untouched: job numbers, names, client details, notes,
  // assignments, start dates and the whole activity log all survive.
  //
  // start_date is deliberately kept.
  //
  // Backup first via GET /api/admin/backup, which shipped in the auth commit.
  (d) => {
    for (const column of ["status", "due_date", "completed_date"]) {
      const columns = d.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
      if (columns.some((c) => c.name === column)) {
        d.exec(`ALTER TABLE jobs DROP COLUMN ${column}`);
      }
    }
  },

  // ── 4: who bid it, and how it bills ──
  // Two codes the shop already keeps on the paper job log: bid_by is HT (Henry
  // Thomas) or DV (Derek Victor); billing_type is CO (contract) or TM (time &
  // material). Nullable — jobs predating this, and the overhead account, have
  // neither. Values are constrained in insertJobSchema rather than by a CHECK
  // so the codes can be extended without a table rebuild.
  (d) => {
    addColumn(d, "jobs", "bid_by", "TEXT");
    addColumn(d, "jobs", "billing_type", "TEXT");
  },

  // ── 5: profile pictures ──
  // Held in their own table rather than as a column on employees: a BLOB on
  // employees would be dragged into every "list the team" query, and those run
  // on nearly every page. Here the bytes are only read when an avatar is
  // actually requested.
  //
  // In the database rather than on the volume so a picture can't be orphaned
  // by a failed write, and so VACUUM INTO backups include it. Images are
  // resized to 256px in the browser before upload, so rows stay small.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS employee_avatars (
        employee_id INTEGER PRIMARY KEY,
        mime TEXT NOT NULL,
        bytes BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },

  // ── 6: multi-tenancy ──
  // Jobdeck stops being one shop's tool and becomes a product several
  // contractors use, each seeing only their own board.
  //
  // Everything that holds customer data gains company_id. Existing rows all
  // belong to company 1, HL Thomas, which keeps its job numbers running on
  // from the paper log.
  //
  // The jobs table has to be rebuilt rather than altered: job_number was
  // declared UNIQUE at creation, which is a table-level constraint SQLite
  // cannot drop in place. Two shops must be able to run a job 1042, so
  // uniqueness moves to (company_id, job_number).
  (d) => {
    const now = new Date().toISOString();

    d.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        job_number_seed INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);

    // Company 1 is whoever is already in here. Seeded above the highest job
    // number present so the sequence carries on rather than restarting.
    const existing = d.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number };
    if (existing.n === 0) {
      const maxJob = (
        d.prepare("SELECT MAX(CAST(job_number AS INTEGER)) AS m FROM jobs").get() as { m: number | null }
      ).m;
      d.prepare(
        "INSERT INTO companies (id, name, slug, job_number_seed, created_at) VALUES (1, ?, ?, ?, ?)",
      ).run("HL Thomas Inc", "hl-thomas", (maxJob ?? 0) + 1, now);
    }

    addColumn(d, "employees", "company_id", "INTEGER NOT NULL DEFAULT 1");
    addColumn(d, "employees", "login_email", "TEXT");
    addColumn(d, "activity_log", "company_id", "INTEGER NOT NULL DEFAULT 1");

    d.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS employees_login_email_unique
        ON employees (login_email) WHERE login_email IS NOT NULL;
      CREATE INDEX IF NOT EXISTS employees_company ON employees (company_id);
      CREATE INDEX IF NOT EXISTS activity_company ON activity_log (company_id);
    `);

    // ── Rebuild jobs ──
    const jobColumns = (d.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    if (!jobColumns.includes("company_id")) {
      d.exec(`
        CREATE TABLE jobs_rebuild (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL DEFAULT 1,
          job_number TEXT NOT NULL,
          job_name TEXT NOT NULL,
          client_name TEXT NOT NULL,
          client_phone TEXT,
          client_email TEXT,
          client_address TEXT,
          assigned_to INTEGER,
          created_by INTEGER,
          start_date TEXT,
          bid_by TEXT,
          billing_type TEXT,
          notes TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO jobs_rebuild
          (id, company_id, job_number, job_name, client_name, client_phone, client_email,
           client_address, assigned_to, created_by, start_date, bid_by, billing_type, notes, created_at)
        SELECT
           id, 1, job_number, job_name, client_name, client_phone, client_email,
           client_address, assigned_to, created_by, start_date, bid_by, billing_type, notes, created_at
        FROM jobs;

        DROP TABLE jobs;
        ALTER TABLE jobs_rebuild RENAME TO jobs;

        CREATE UNIQUE INDEX jobs_company_number_unique ON jobs (company_id, job_number);
        CREATE INDEX jobs_company ON jobs (company_id);
      `);

      // Make sure the AUTOINCREMENT high-water mark survived the drop/rename,
      // or the next insert could reuse an id. sqlite_sequence is an internal
      // table with no declared unique constraint, so it takes an update-then-
      // insert rather than an upsert.
      const maxId = (d.prepare("SELECT MAX(id) AS m FROM jobs").get() as { m: number | null }).m ?? 0;
      const bumped = d.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'jobs'").run(maxId);
      if (bumped.changes === 0) {
        d.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('jobs', ?)").run(maxId);
      }
    }
  },

  // ── 7: tasks ──
  // What's owed on each job: submittals, deliveries, inspections, calls.
  // Indexed for the two reads that happen constantly — "everything open for my
  // company, overdue first" and "everything on this job".
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        notes TEXT,
        due_date TEXT,
        due_time TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        assigned_to INTEGER,
        created_by INTEGER,
        repeat_rule TEXT,
        remind_at TEXT,
        reminder_sent_at TEXT,
        completed_at TEXT,
        completed_by INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS tasks_company_open ON tasks (company_id, completed_at, due_date);
      CREATE INDEX IF NOT EXISTS tasks_job ON tasks (company_id, job_id);
      CREATE INDEX IF NOT EXISTS tasks_reminders ON tasks (remind_at) WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL;
    `);
  },

  // ── 8: avatars carry their tenant ──
  // employee_avatars was keyed on employee_id alone, so every avatar query was
  // authorised by the id rather than by the row. The listing query in
  // particular had no tenant filter at all and reported which ids across EVERY
  // company have a picture. Backfilled from the owning employee.
  (d) => {
    addColumn(d, "employee_avatars", "company_id", "INTEGER NOT NULL DEFAULT 1");
    d.exec(`
      UPDATE employee_avatars
         SET company_id = COALESCE(
           (SELECT e.company_id FROM employees e WHERE e.id = employee_avatars.employee_id),
           company_id
         );
      CREATE INDEX IF NOT EXISTS employee_avatars_company ON employee_avatars (company_id);
    `);
  },

  // ── 9: ownership, invites, devices, photos, reminders ──
  // Confirmed against the live volume (user_version 9) before writing: this is
  // MIGRATIONS[9] and takes it to 10. Steps 0-8 are frozen.
  (d) => {
    // Ownership is a column, never a role string. role is a free-text display
    // label that any login holder can PATCH onto themselves, so authorising on
    // it would let a crew member promote themselves and delete the company.
    addColumn(d, "companies", "owner_employee_id", "INTEGER");
    // One shop, one wall clock. Reminder delivery needs a zone to turn a due
    // date into an instant; the viewer's own date still drives every UI query.
    addColumn(d, "companies", "timezone", "TEXT NOT NULL DEFAULT 'America/New_York'");

    // Backfill: the lowest-id login holder in each company.
    d.exec(`
      UPDATE companies SET owner_employee_id = (
        SELECT MIN(e.id) FROM employees e
         WHERE e.company_id = companies.id
           AND (e.username IS NOT NULL OR e.login_email IS NOT NULL)
      ) WHERE owner_employee_id IS NULL;
    `);

    d.exec(`
      -- Single-use tokens for "set your password". The ONLY way a crew member
      -- gets a login besides signup and the seed script; without it a new shop
      -- adds eight people and none of them can sign in.
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL DEFAULT 'invite',   -- 'invite' | 'reset'
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS invites_company ON invites (company_id);

      -- Opaque bearer tokens. The native shell cannot use the session cookie:
      -- WKWebView will not persist Set-Cookie from capacitor://localhost.
      CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        platform TEXT,
        last_used_at TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS api_tokens_employee ON api_tokens (employee_id);

      -- Push targets. transport tells the sender which wire format to use, so
      -- web (VAPID), iOS (APNs) and Android (FCM) coexist on one table.
      CREATE TABLE IF NOT EXISTS push_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        transport TEXT NOT NULL,                  -- 'web' | 'apns' | 'fcm'
        endpoint TEXT NOT NULL,                   -- web push URL, or device token
        p256dh TEXT,
        auth TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (transport, endpoint)
      );
      CREATE INDEX IF NOT EXISTS push_devices_employee ON push_devices (employee_id);

      -- Job photos. Capped and thumbnailed client-side; the full image and a
      -- ~320px derivative are stored so a 40-photo job does not pull 25MB.
      CREATE TABLE IF NOT EXISTS job_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL,
        mime TEXT NOT NULL,
        bytes BLOB NOT NULL,
        thumb BLOB NOT NULL,
        caption TEXT,
        taken_by INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_photos_job ON job_photos (company_id, job_id);

      -- Job contacts: GC, engineer, vendor. One client phone per job was never
      -- the real shape of the work.
      CREATE TABLE IF NOT EXISTS job_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        role TEXT,
        phone TEXT,
        email TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_contacts_job ON job_contacts (company_id, job_id);

      -- Dated field notes, so "what happened in March" has an answer.
      CREATE TABLE IF NOT EXISTS job_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        author_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_notes_job ON job_notes (company_id, job_id);
    `);
  },
];

function runMigrations(d: Database.Database) {
  const current = (d.pragma("user_version", { simple: true }) as number) ?? 0;

  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database is at schema version ${current} but this build only knows about ` +
        `${MIGRATIONS.length}. This usually means an older image was deployed over a ` +
        `newer one — roll forward rather than starting up against a schema from the future.`,
    );
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version];
    // Each step commits with its own version bump, so a failure halfway through
    // a run leaves the database at the last fully-applied step, never between two.
    d.transaction(() => {
      step(d);
      d.pragma(`user_version = ${version + 1}`);
    })();
    console.log(`[db] applied schema migration ${version} -> ${version + 1}`);
  }
}

runMigrations(sqlite);
