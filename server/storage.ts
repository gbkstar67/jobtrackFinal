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
    return db.select(employeePublicColumns).from(employees).orderBy(employees.name).all();
  }

  getEmployee(id: number): Employee | undefined {
    return db.select(employeePublicColumns).from(employees).where(eq(employees.id, id)).get();
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
    const result = db.delete(employees).where(eq(employees.id, id)).run();
    return result.changes > 0;
  }

  // ── Jobs ──
  getAllJobs(): Job[] {
    return db.select().from(jobs).orderBy(desc(jobs.id)).all();
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
    const year = new Date().getFullYear();
    const prefix = `JOB-${year}-`;

    // Computed in SQL rather than by loading every job into memory and reducing
    // over it. substr() is 1-indexed in SQLite, hence the + 1.
    const row = db
      .select({
        maxNum: sql<number | null>`MAX(CAST(substr(${jobs.jobNumber}, ${prefix.length + 1}) AS INTEGER))`,
      })
      .from(jobs)
      .where(sql`${jobs.jobNumber} LIKE ${prefix + "%"}`)
      .get();

    const nextNum = ((row?.maxNum ?? 0) + 1).toString().padStart(4, "0");
    return `${prefix}${nextNum}`;
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
