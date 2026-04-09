import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "@shared/schema";
import { sql } from "drizzle-orm";

// Use DATABASE_PATH env var for Railway persistent volume, fallback to local
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data.db");

const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent read/write performance (multi-user)
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

// Auto-create tables if they don't exist (handles first deploy)
sqlite.exec(`
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
