import { db, sqlite } from "./db";
import {
  jobs, employees, activityLog, companies, employeePublicColumns,
  type Job, type InsertJob,
  type Employee, type EmployeeRow, type InsertEmployee,
  type Activity, type InsertActivity,
  type Company,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";

/**
 * Every method that touches customer data takes companyId as its first
 * argument. Not an optional filter — a required parameter, so forgetting to
 * scope a query is a compile error rather than one shop reading another's
 * client list. The companyId always comes from req.user, never the request.
 */
export interface IStorage {
  // Companies
  getCompany(id: number): Company | undefined;
  getCompanyBySlug(slug: string): Company | undefined;
  createCompany(name: string, slug: string, jobNumberSeed: number): Company;

  // Employees
  getAllEmployees(companyId: number): Employee[];
  getEmployee(companyId: number, id: number): Employee | undefined;
  getEmployeeByLogin(identifier: string): EmployeeRow | undefined;
  getEmployeeRowById(id: number): EmployeeRow | undefined;
  createOwner(companyId: number, owner: { name: string; loginEmail: string; passwordHash: string }): Employee;
  createEmployee(companyId: number, emp: InsertEmployee): Employee;
  updateEmployee(companyId: number, id: number, updates: Partial<InsertEmployee>): Employee | undefined;
  deleteEmployee(companyId: number, id: number): boolean;

  // Avatars
  getAvatar(companyId: number, id: number): { mime: string; bytes: Buffer; updatedAt: string } | undefined;
  setAvatar(companyId: number, id: number, mime: string, bytes: Buffer): void;
  deleteAvatar(companyId: number, id: number): boolean;

  // Jobs
  getAllJobs(companyId: number): Job[];
  getJob(companyId: number, id: number): Job | undefined;
  createJob(companyId: number, job: InsertJob, createdBy: number): Job;
  updateJob(companyId: number, id: number, updates: Partial<InsertJob>): Job | undefined;
  deleteJob(companyId: number, id: number): boolean;
  getNextJobNumber(companyId: number): string;

  // Activity
  getActivities(companyId: number, jobId?: number): Activity[];
  logActivity(companyId: number, entry: InsertActivity): Activity;
}

export class DatabaseStorage implements IStorage {
  // ── Companies ──
  getCompany(id: number): Company | undefined {
    return db.select().from(companies).where(eq(companies.id, id)).get();
  }

  getCompanyBySlug(slug: string): Company | undefined {
    return db.select().from(companies).where(eq(companies.slug, slug)).get();
  }

  createCompany(name: string, slug: string, jobNumberSeed: number): Company {
    return db
      .insert(companies)
      .values({ name, slug, jobNumberSeed, createdAt: new Date().toISOString() })
      .returning()
      .get();
  }

  // ── Employees ──
  // Reads project through employeePublicColumns: a plain select would include
  // password_hash and hand it to any signed-in user.
  getAllEmployees(companyId: number): Employee[] {
    const rows = db
      .select(employeePublicColumns)
      .from(employees)
      .where(eq(employees.companyId, companyId))
      .orderBy(employees.name)
      .all();
    const withAvatars = this.employeeIdsWithAvatars();
    return rows.map((e) => ({ ...e, hasAvatar: withAvatars.has(e.id) }));
  }

  getEmployee(companyId: number, id: number): Employee | undefined {
    const row = db
      .select(employeePublicColumns)
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.companyId, companyId)))
      .get();
    if (!row) return undefined;
    return { ...row, hasAvatar: this.employeeIdsWithAvatars().has(row.id) };
  }

  /**
   * The one place a password hash is read, and the one employee lookup not
   * scoped by company — at sign-in there is no session yet to scope by. Both
   * identifiers are globally unique, so this resolves to exactly one person at
   * exactly one company. Never return this row over HTTP.
   */
  getEmployeeByLogin(identifier: string): EmployeeRow | undefined {
    const field = identifier.includes("@") ? employees.loginEmail : employees.username;
    return db.select().from(employees).where(eq(field, identifier)).get();
  }

  /**
   * Unscoped lookup by id, used only when restoring a session — at that point
   * the company is not yet known, because it is what we are resolving. Returns
   * the raw row including the hash, so never send this to a client.
   */
  getEmployeeRowById(id: number): EmployeeRow | undefined {
    return db.select().from(employees).where(eq(employees.id, id)).get();
  }

  /**
   * The first user of a new company. The only route that writes a login, which
   * is why it sits here rather than behind the employee insert schema — that
   * one deliberately omits username, loginEmail and passwordHash so the normal
   * team-management endpoints can never set them.
   */
  createOwner(
    companyId: number,
    owner: { name: string; loginEmail: string; passwordHash: string },
  ): Employee {
    return db
      .insert(employees)
      .values({
        companyId,
        name: owner.name,
        role: "Owner",
        color: "bg-blue-600",
        active: true,
        loginEmail: owner.loginEmail,
        passwordHash: owner.passwordHash,
        createdAt: new Date().toISOString(),
      })
      .returning(employeePublicColumns)
      .get();
  }

  createEmployee(companyId: number, emp: InsertEmployee): Employee {
    const createdAt = new Date().toISOString();
    return db
      .insert(employees)
      .values({ ...emp, companyId, createdAt })
      .returning(employeePublicColumns)
      .get();
  }

  updateEmployee(companyId: number, id: number, updates: Partial<InsertEmployee>): Employee | undefined {
    if (!this.getEmployee(companyId, id)) return undefined;
    return db
      .update(employees)
      .set(updates)
      .where(and(eq(employees.id, id), eq(employees.companyId, companyId)))
      .returning(employeePublicColumns)
      .get();
  }

  deleteEmployee(companyId: number, id: number): boolean {
    if (!this.getEmployee(companyId, id)) return false;
    this.deleteAvatar(companyId, id);
    return db
      .delete(employees)
      .where(and(eq(employees.id, id), eq(employees.companyId, companyId)))
      .run().changes > 0;
  }

  // ── Avatars ──
  // Raw statements because the picture is a BLOB and must not ride along on an
  // ordinary employee query. Each one re-checks the tenant through getEmployee
  // rather than trusting the id.
  private employeeIdsWithAvatars(): Set<number> {
    const rows = sqlite
      .prepare("SELECT employee_id AS id FROM employee_avatars")
      .all() as Array<{ id: number }>;
    return new Set(rows.map((r) => r.id));
  }

  getAvatar(companyId: number, employeeId: number) {
    if (!this.getEmployee(companyId, employeeId)) return undefined;
    return sqlite
      .prepare("SELECT mime, bytes, updated_at AS updatedAt FROM employee_avatars WHERE employee_id = ?")
      .get(employeeId) as { mime: string; bytes: Buffer; updatedAt: string } | undefined;
  }

  setAvatar(companyId: number, employeeId: number, mime: string, bytes: Buffer): void {
    if (!this.getEmployee(companyId, employeeId)) return;
    sqlite
      .prepare(
        `INSERT INTO employee_avatars (employee_id, mime, bytes, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(employee_id) DO UPDATE SET
           mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`,
      )
      .run(employeeId, mime, bytes, new Date().toISOString());
  }

  deleteAvatar(companyId: number, employeeId: number): boolean {
    if (!this.getEmployee(companyId, employeeId)) return false;
    return sqlite.prepare("DELETE FROM employee_avatars WHERE employee_id = ?").run(employeeId).changes > 0;
  }

  // ── Jobs ──
  getAllJobs(companyId: number): Job[] {
    return db
      .select()
      .from(jobs)
      .where(eq(jobs.companyId, companyId))
      .orderBy(sql`CAST(${jobs.jobNumber} AS INTEGER) DESC`)
      .all();
  }

  getJob(companyId: number, id: number): Job | undefined {
    return db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.companyId, companyId)))
      .get();
  }

  createJob(companyId: number, job: InsertJob, createdBy: number): Job {
    const createdAt = new Date().toISOString();
    // Allocating the number and inserting the row are one atomic step, or two
    // people hitting Create at the same moment collide on the unique index.
    return db.transaction(
      (tx) => {
        const jobNumber = this.getNextJobNumber(companyId);
        return tx
          .insert(jobs)
          .values({ ...job, companyId, jobNumber, createdBy, createdAt })
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
  }

  updateJob(companyId: number, id: number, updates: Partial<InsertJob>): Job | undefined {
    if (!this.getJob(companyId, id)) return undefined;
    return db
      .update(jobs)
      .set(updates)
      .where(and(eq(jobs.id, id), eq(jobs.companyId, companyId)))
      .returning()
      .get();
  }

  deleteJob(companyId: number, id: number): boolean {
    return db
      .delete(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.companyId, companyId)))
      .run().changes > 0;
  }

  /**
   * One above this company's highest job number, or its configured seed if the
   * board is empty. Scoped per company, so a new shop starting at 1 doesn't
   * inherit HL Thomas's 26486.
   */
  getNextJobNumber(companyId: number): string {
    const row = db
      .select({ maxNum: sql<number | null>`MAX(CAST(${jobs.jobNumber} AS INTEGER))` })
      .from(jobs)
      .where(eq(jobs.companyId, companyId))
      .get();

    const max = row?.maxNum ?? 0;
    if (max > 0) return String(max + 1);
    return String(this.getCompany(companyId)?.jobNumberSeed ?? 1);
  }

  // ── Activity ──
  getActivities(companyId: number, jobId?: number): Activity[] {
    const scope = jobId
      ? and(eq(activityLog.companyId, companyId), eq(activityLog.jobId, jobId))
      : eq(activityLog.companyId, companyId);
    return db.select().from(activityLog).where(scope).orderBy(desc(activityLog.id)).all();
  }

  logActivity(companyId: number, entry: InsertActivity): Activity {
    return db.insert(activityLog).values({ ...entry, companyId }).returning().get();
  }

  /**
   * Snapshot the whole database to a file, WAL and all.
   *
   * VACUUM INTO folds committed-but-uncheckpointed WAL content into the copy,
   * which a plain file copy does not — that would quietly miss recent writes.
   * Note this covers every tenant, so it is an operator tool, not a per-company
   * export.
   */
  backupTo(destination: string): void {
    sqlite.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  }
}

export const storage = new DatabaseStorage();
