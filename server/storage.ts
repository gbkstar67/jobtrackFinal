import { db, sqlite } from "./db";
import {
  jobs, employees, activityLog, employeePublicColumns,
  type Job, type InsertJob,
  type Employee, type EmployeeRow, type InsertEmployee,
  type Activity, type InsertActivity,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export interface IStorage {
  // Employees
  getAllEmployees(): Employee[];
  getEmployee(id: number): Employee | undefined;
  getEmployeeByUsername(username: string): EmployeeRow | undefined;
  getAvatar(id: number): { mime: string; bytes: Buffer; updatedAt: string } | undefined;
  setAvatar(id: number, mime: string, bytes: Buffer): void;
  deleteAvatar(id: number): boolean;
  createEmployee(emp: InsertEmployee): Employee;
  updateEmployee(id: number, updates: Partial<InsertEmployee>): Employee | undefined;
  deleteEmployee(id: number): boolean;

  // Jobs
  getAllJobs(): Job[];
  getJob(id: number): Job | undefined;
  createJob(job: InsertJob): Job;
  updateJob(id: number, updates: Partial<InsertJob>): Job | undefined;
  deleteJob(id: number): boolean;
  getNextJobNumber(): string;

  // Activity
  getActivities(jobId?: number): Activity[];
  logActivity(entry: InsertActivity): Activity;
}

export class DatabaseStorage implements IStorage {
  // ── Employees ──
  // Every read here projects through employeePublicColumns. A plain
  // select().from(employees) would now include password_hash and hand it to any
  // logged-in user via GET /api/employees.
  getAllEmployees(): Employee[] {
    const rows = db.select(employeePublicColumns).from(employees).orderBy(employees.name).all();
    const withAvatars = this.employeeIdsWithAvatars();
    return rows.map((e) => ({ ...e, hasAvatar: withAvatars.has(e.id) }));
  }

  getEmployee(id: number): Employee | undefined {
    const row = db.select(employeePublicColumns).from(employees).where(eq(employees.id, id)).get();
    if (!row) return undefined;
    return { ...row, hasAvatar: this.employeeIdsWithAvatars().has(row.id) };
  }

  // ── Avatars ──
  // Deliberately raw statements: the bytes are a BLOB and are only ever read
  // by getAvatar, so they never ride along on a normal employee query.

  private employeeIdsWithAvatars(): Set<number> {
    const rows = sqlite
      .prepare("SELECT employee_id AS id FROM employee_avatars")
      .all() as Array<{ id: number }>;
    return new Set(rows.map((r) => r.id));
  }

  getAvatar(employeeId: number): { mime: string; bytes: Buffer; updatedAt: string } | undefined {
    const row = sqlite
      .prepare("SELECT mime, bytes, updated_at AS updatedAt FROM employee_avatars WHERE employee_id = ?")
      .get(employeeId) as { mime: string; bytes: Buffer; updatedAt: string } | undefined;
    return row;
  }

  setAvatar(employeeId: number, mime: string, bytes: Buffer): void {
    sqlite
      .prepare(
        `INSERT INTO employee_avatars (employee_id, mime, bytes, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(employee_id) DO UPDATE SET
           mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`,
      )
      .run(employeeId, mime, bytes, new Date().toISOString());
  }

  deleteAvatar(employeeId: number): boolean {
    return sqlite.prepare("DELETE FROM employee_avatars WHERE employee_id = ?").run(employeeId).changes > 0;
  }

  /**
   * The one place a password hash is read. For the login strategy only — never
   * return this row over HTTP.
   */
  getEmployeeByUsername(username: string): EmployeeRow | undefined {
    return db.select().from(employees).where(eq(employees.username, username)).get();
  }

  createEmployee(emp: InsertEmployee): Employee {
    const createdAt = new Date().toISOString();
    return db
      .insert(employees)
      .values({ ...emp, createdAt })
      .returning(employeePublicColumns)
      .get();
  }

  updateEmployee(id: number, updates: Partial<InsertEmployee>): Employee | undefined {
    const existing = this.getEmployee(id);
    if (!existing) return undefined;
    return db
      .update(employees)
      .set(updates)
      .where(eq(employees.id, id))
      .returning(employeePublicColumns)
      .get();
  }

  deleteEmployee(id: number): boolean {
    // Take the picture with them; nothing else references the row.
    this.deleteAvatar(id);
    const result = db.delete(employees).where(eq(employees.id, id)).run();
    return result.changes > 0;
  }

  // ── Jobs ──
  getAllJobs(): Job[] {
    // Highest job number first. The numbers are issued sequentially, so this is
    // newest-first, and it keeps the board stable regardless of the order rows
    // happened to be inserted — the paper-log import and the 09400 overhead
    // account would otherwise land wherever their row id fell.
    return db
      .select()
      .from(jobs)
      .orderBy(sql`CAST(${jobs.jobNumber} AS INTEGER) DESC`)
      .all();
  }

  getJob(id: number): Job | undefined {
    return db.select().from(jobs).where(eq(jobs.id, id)).get();
  }

  createJob(job: InsertJob): Job {
    const createdAt = new Date().toISOString();

    // Allocating the job number and inserting the row have to be one atomic
    // step. Previously they were two, so two people hitting "Create Job" at the
    // same moment both read the same max and the second insert blew up on the
    // UNIQUE job_number constraint.
    return db.transaction(
      (tx) => {
        const jobNumber = this.getNextJobNumber();
        return tx.insert(jobs).values({ ...job, jobNumber, createdAt }).returning().get();
      },
      { behavior: "immediate" },
    );
  }

  updateJob(id: number, updates: Partial<InsertJob>): Job | undefined {
    const existing = this.getJob(id);
    if (!existing) return undefined;
    return db.update(jobs).set(updates).where(eq(jobs.id, id)).returning().get();
  }

  deleteJob(id: number): boolean {
    const result = db.delete(jobs).where(eq(jobs.id, id)).run();
    return result.changes > 0;
  }

  getNextJobNumber(): string {
    // Plain sequential numbers matching the shop's existing paper job log:
    // 24163, 25427, 26485, ... The leading two digits are the year the number
    // was issued, but the sequence simply carries on rather than resetting, so
    // the rule is just "one more than the highest number on the board".
    //
    // Non-numeric job numbers CAST to 0 in SQLite, so any stragglers in the old
    // JOB-2026-0001 format are ignored rather than breaking the count.
    const row = db
      .select({ maxNum: sql<number | null>`MAX(CAST(${jobs.jobNumber} AS INTEGER))` })
      .from(jobs)
      .get();

    // Seeded so an empty board starts where the paper log left off rather than at 1.
    const FIRST_JOB_NUMBER = 26486;
    const max = row?.maxNum ?? 0;
    return String(max > 0 ? max + 1 : FIRST_JOB_NUMBER);
  }

  // ── Activity ──
  getActivities(jobId?: number): Activity[] {
    if (jobId) {
      return db.select().from(activityLog).where(eq(activityLog.jobId, jobId)).orderBy(desc(activityLog.id)).all();
    }
    return db.select().from(activityLog).orderBy(desc(activityLog.id)).all();
  }

  logActivity(entry: InsertActivity): Activity {
    return db.insert(activityLog).values(entry).returning().get();
  }

  /**
   * Snapshot the live database to a file, WAL and all.
   *
   * VACUUM INTO folds any committed-but-not-yet-checkpointed WAL content into
   * the copy, which a plain file copy of jobtrack.db does not — that would
   * quietly produce a backup missing the most recent writes.
   */
  backupTo(destination: string): void {
    sqlite.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  }
}

export const storage = new DatabaseStorage();
