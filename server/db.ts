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
