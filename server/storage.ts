import nodeCrypto from "crypto";
import { db, sqlite } from "./db";
import {
  jobs, employees, activityLog, companies, tasks,
  jobContacts, jobNotes, employeePublicColumns,
  type Job, type InsertJob,
  type Employee, type EmployeeRow, type InsertEmployee,
  type Activity, type InsertActivity,
  type Company,
  type Task, type InsertTask, type RepeatRule,
  type JobPhoto, type JobContact, type InsertContact, type JobNote, type InsertNote,
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

  // Invites, devices, photos, contacts, notes
  createInvite(companyId: number, employeeId: number, purpose: string, createdBy: number): string;
  consumeInvite(token: string): { companyId: number; employeeId: number } | undefined;
  setLogin(companyId: number, employeeId: number, loginEmail: string, passwordHash: string): boolean;
  registerDevice(companyId: number, employeeId: number, d: { transport: string; endpoint: string; p256dh?: string | null; auth?: string | null }): void;
  removeDevice(companyId: number, endpoint: string): boolean;
  countDevices(companyId: number, employeeId: number): number;

  listPhotos(companyId: number, jobId: number): JobPhoto[];
  getPhotoBytes(companyId: number, id: number, which: "full" | "thumb"): { mime: string; bytes: Buffer } | undefined;
  addPhoto(companyId: number, jobId: number, mime: string, bytes: Buffer, thumb: Buffer, caption: string | null, takenBy: number): JobPhoto;
  deletePhoto(companyId: number, id: number): boolean;

  listContacts(companyId: number, jobId: number): JobContact[];
  addContact(companyId: number, c: InsertContact): JobContact;
  deleteContact(companyId: number, id: number): boolean;

  listNotes(companyId: number, jobId: number): JobNote[];
  addNote(companyId: number, n: InsertNote, authorId: number): JobNote;
  deleteNote(companyId: number, id: number): boolean;

  // Tasks
  getTasks(companyId: number, opts?: TaskQuery): Task[];
  getTask(companyId: number, id: number): Task | undefined;
  createTask(companyId: number, task: InsertTask, createdBy: number): Task;
  updateTask(companyId: number, id: number, updates: Partial<InsertTask>): Task | undefined;
  completeTask(companyId: number, id: number, by: number): { task: Task; nextOccurrence: Task | null } | undefined;
  reopenTask(companyId: number, id: number): Task | undefined;
  deleteTask(companyId: number, id: number): boolean;
  getJobTaskSummary(companyId: number, today: string): Map<number, JobTaskSummary>;
}

/**
 * `today` is always supplied by the caller as the viewer's own YYYY-MM-DD, never
 * computed server-side. Railway runs UTC, so a server-computed "today" would
 * roll over at 8pm in Pennsylvania and show tomorrow's work as due now.
 */
export interface TaskQuery {
  view?: "open" | "today" | "upcoming" | "done" | "all" | "range";
  today?: string;
  /** For view=range: inclusive YYYY-MM-DD bounds of the visible window. */
  from?: string;
  to?: string;
  jobId?: number;
  assignedTo?: number | "unassigned";
  priority?: "normal" | "urgent";
}

export interface JobTaskSummary {
  open: number;
  overdue: number;
  nextDue: string | null;
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
    const withAvatars = this.employeeIdsWithAvatars(companyId);
    return rows.map((e) => ({ ...e, hasAvatar: withAvatars.has(e.id) }));
  }

  getEmployee(companyId: number, id: number): Employee | undefined {
    const row = db
      .select(employeePublicColumns)
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.companyId, companyId)))
      .get();
    if (!row) return undefined;
    return { ...row, hasAvatar: this.employeeIdsWithAvatars(companyId).has(row.id) };
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
  private employeeIdsWithAvatars(companyId: number): Set<number> {
    const rows = sqlite
      .prepare("SELECT employee_id AS id FROM employee_avatars WHERE company_id = ?")
      .all(companyId) as Array<{ id: number }>;
    return new Set(rows.map((r) => r.id));
  }

  getAvatar(companyId: number, employeeId: number) {
    if (!this.getEmployee(companyId, employeeId)) return undefined;
    return sqlite
      .prepare(
        "SELECT mime, bytes, updated_at AS updatedAt FROM employee_avatars WHERE employee_id = ? AND company_id = ?",
      )
      .get(employeeId, companyId) as { mime: string; bytes: Buffer; updatedAt: string } | undefined;
  }

  setAvatar(companyId: number, employeeId: number, mime: string, bytes: Buffer): void {
    if (!this.getEmployee(companyId, employeeId)) return;
    sqlite
      .prepare(
        `INSERT INTO employee_avatars (employee_id, company_id, mime, bytes, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(employee_id) DO UPDATE SET
           mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at
         WHERE employee_avatars.company_id = excluded.company_id`,
      )
      .run(employeeId, companyId, mime, bytes, new Date().toISOString());
  }

  deleteAvatar(companyId: number, employeeId: number): boolean {
    if (!this.getEmployee(companyId, employeeId)) return false;
    return sqlite
      .prepare("DELETE FROM employee_avatars WHERE employee_id = ? AND company_id = ?")
      .run(employeeId, companyId).changes > 0;
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
    // Tasks, photos, contacts and notes all hang off the job. Without this they
    // survive it, scoped to a job_id that resolves to nothing — the task list
    // would show work for a job that is no longer on the board. activity_log is
    // deliberately NOT included: it carries job_number and job_name precisely so
    // the trail outlives the job.
    return db.transaction((tx) => {
      const existing = this.getJob(companyId, id);
      if (!existing) return false;
      sqlite.prepare("DELETE FROM tasks WHERE company_id = ? AND job_id = ?").run(companyId, id);
      sqlite.prepare("DELETE FROM job_photos WHERE company_id = ? AND job_id = ?").run(companyId, id);
      sqlite.prepare("DELETE FROM job_contacts WHERE company_id = ? AND job_id = ?").run(companyId, id);
      sqlite.prepare("DELETE FROM job_notes WHERE company_id = ? AND job_id = ?").run(companyId, id);
      return tx.delete(jobs).where(and(eq(jobs.id, id), eq(jobs.companyId, companyId))).run().changes > 0;
    });
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

  // ── Invites and logins ──
  // Only the hash is stored, so a copy of the database cannot be replayed into
  // a login. The plaintext is returned exactly once, to the caller.
  createInvite(companyId: number, employeeId: number, purpose: string, createdBy: number): string {
    const token = nodeCrypto.randomBytes(32).toString("base64url");
    const now = new Date();
    sqlite
      .prepare(
        `INSERT INTO invites (company_id, employee_id, token_hash, purpose, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        companyId,
        employeeId,
        nodeCrypto.createHash("sha256").update(token).digest("hex"),
        purpose,
        new Date(now.getTime() + 7 * 86_400_000).toISOString(),
        createdBy,
        now.toISOString(),
      );
    return token;
  }

  /** Single use: marked spent in the same statement that reads it. */
  consumeInvite(token: string) {
    const hash = nodeCrypto.createHash("sha256").update(token).digest("hex");
    const row = sqlite
      .prepare(
        `SELECT id, company_id AS companyId, employee_id AS employeeId, expires_at AS expiresAt, used_at AS usedAt
           FROM invites WHERE token_hash = ?`,
      )
      .get(hash) as { id: number; companyId: number; employeeId: number; expiresAt: string; usedAt: string | null } | undefined;

    if (!row || row.usedAt || row.expiresAt <= new Date().toISOString()) return undefined;
    sqlite.prepare("UPDATE invites SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { companyId: row.companyId, employeeId: row.employeeId };
  }

  setLogin(companyId: number, employeeId: number, loginEmail: string, passwordHash: string): boolean {
    if (!this.getEmployee(companyId, employeeId)) return false;
    return (
      db
        .update(employees)
        .set({ loginEmail, passwordHash })
        .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
        .run().changes > 0
    );
  }

  // ── Push devices ──
  registerDevice(companyId: number, employeeId: number, d: { transport: string; endpoint: string; p256dh?: string | null; auth?: string | null }) {
    sqlite
      .prepare(
        `INSERT INTO push_devices (company_id, employee_id, transport, endpoint, p256dh, auth, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(transport, endpoint) DO UPDATE SET
           company_id = excluded.company_id,
           employee_id = excluded.employee_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           failure_count = 0,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(companyId, employeeId, d.transport, d.endpoint, d.p256dh ?? null, d.auth ?? null,
           new Date().toISOString(), new Date().toISOString());
  }

  removeDevice(companyId: number, endpoint: string): boolean {
    return sqlite
      .prepare("DELETE FROM push_devices WHERE company_id = ? AND endpoint = ?")
      .run(companyId, endpoint).changes > 0;
  }

  countDevices(companyId: number, employeeId: number): number {
    return (
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM push_devices WHERE company_id = ? AND employee_id = ?")
        .get(companyId, employeeId) as { n: number }
    ).n;
  }

  // ── Job photos ──
  // Listing NEVER selects the BLOBs: a 40-photo job would otherwise pull ~25MB
  // through the JSON response just to render a thumbnail strip.
  listPhotos(companyId: number, jobId: number): JobPhoto[] {
    return sqlite
      .prepare(
        `SELECT id, company_id AS companyId, job_id AS jobId, mime, caption,
                taken_by AS takenBy, created_at AS createdAt
           FROM job_photos WHERE company_id = ? AND job_id = ? ORDER BY id DESC`,
      )
      .all(companyId, jobId) as JobPhoto[];
  }

  getPhotoBytes(companyId: number, id: number, which: "full" | "thumb") {
    const column = which === "thumb" ? "thumb" : "bytes";
    return sqlite
      .prepare(`SELECT mime, ${column} AS bytes FROM job_photos WHERE company_id = ? AND id = ?`)
      .get(companyId, id) as { mime: string; bytes: Buffer } | undefined;
  }

  addPhoto(companyId: number, jobId: number, mime: string, bytes: Buffer, thumb: Buffer, caption: string | null, takenBy: number): JobPhoto {
    const info = sqlite
      .prepare(
        `INSERT INTO job_photos (company_id, job_id, mime, bytes, thumb, caption, taken_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(companyId, jobId, mime, bytes, thumb, caption, takenBy, new Date().toISOString());
    return this.listPhotos(companyId, jobId).find((p) => p.id === Number(info.lastInsertRowid))!;
  }

  deletePhoto(companyId: number, id: number): boolean {
    return sqlite.prepare("DELETE FROM job_photos WHERE company_id = ? AND id = ?").run(companyId, id).changes > 0;
  }

  countPhotos(companyId: number, jobId: number): number {
    return (
      sqlite.prepare("SELECT COUNT(*) AS n FROM job_photos WHERE company_id = ? AND job_id = ?")
        .get(companyId, jobId) as { n: number }
    ).n;
  }

  // ── Contacts ──
  listContacts(companyId: number, jobId: number): JobContact[] {
    return db.select().from(jobContacts)
      .where(and(eq(jobContacts.companyId, companyId), eq(jobContacts.jobId, jobId)))
      .orderBy(jobContacts.id).all();
  }

  addContact(companyId: number, c: InsertContact): JobContact {
    return db.insert(jobContacts)
      .values({ ...c, companyId, createdAt: new Date().toISOString() })
      .returning().get();
  }

  deleteContact(companyId: number, id: number): boolean {
    return db.delete(jobContacts)
      .where(and(eq(jobContacts.id, id), eq(jobContacts.companyId, companyId))).run().changes > 0;
  }

  // ── Field notes ──
  listNotes(companyId: number, jobId: number): JobNote[] {
    return db.select().from(jobNotes)
      .where(and(eq(jobNotes.companyId, companyId), eq(jobNotes.jobId, jobId)))
      .orderBy(desc(jobNotes.id)).all();
  }

  addNote(companyId: number, n: InsertNote, authorId: number): JobNote {
    return db.insert(jobNotes)
      .values({ ...n, companyId, authorId, createdAt: new Date().toISOString() })
      .returning().get();
  }

  deleteNote(companyId: number, id: number): boolean {
    return db.delete(jobNotes)
      .where(and(eq(jobNotes.id, id), eq(jobNotes.companyId, companyId))).run().changes > 0;
  }

  // ── Tasks ──

  getTasks(companyId: number, opts: TaskQuery = {}): Task[] {
    const { view = "open", today, from, to, jobId, assignedTo, priority } = opts;
    const where: any[] = [eq(tasks.companyId, companyId)];

    if (jobId) where.push(eq(tasks.jobId, jobId));
    if (priority) where.push(eq(tasks.priority, priority));
    if (assignedTo === "unassigned") where.push(sql`${tasks.assignedTo} IS NULL`);
    else if (typeof assignedTo === "number") where.push(eq(tasks.assignedTo, assignedTo));

    if (view === "range") {
      // The calendar window, open AND completed: a day that had three things
      // on it should still show three, ticked off.
      where.push(sql`${tasks.dueDate} IS NOT NULL`);
      if (from) where.push(sql`${tasks.dueDate} >= ${from}`);
      if (to) where.push(sql`${tasks.dueDate} <= ${to}`);
    } else if (view === "done") {
      where.push(sql`${tasks.completedAt} IS NOT NULL`);
    } else if (view !== "all") {
      where.push(sql`${tasks.completedAt} IS NULL`);
      if (view === "today" && today) {
        // Today means today *and* anything already late — what's late is what
        // you need to see first, not filed under a day that has passed.
        where.push(sql`${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} <= ${today}`);
      } else if (view === "upcoming" && today) {
        where.push(sql`${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} > ${today}`);
      }
    }

    const rows = db.select().from(tasks).where(and(...where)).all();

    // Ordered in JS rather than SQL because the rule is layered: overdue first,
    // then by date with undated last, then urgent above normal, then by time.
    const rank = (t: Task) => {
      if (view === "done") return 0;
      if (today && t.dueDate && t.dueDate < today) return 0; // overdue
      if (today && t.dueDate === today) return 1;
      if (t.dueDate) return 2;
      return 3; // no date — sits below anything scheduled
    };
    return rows.sort((a, b) =>
      rank(a) - rank(b) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      (a.priority === b.priority ? 0 : a.priority === "urgent" ? -1 : 1) ||
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
      a.id - b.id,
    );
  }

  getTask(companyId: number, id: number): Task | undefined {
    return db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.companyId, companyId))).get();
  }

  createTask(companyId: number, task: InsertTask, createdBy: number): Task {
    return db
      .insert(tasks)
      .values({ ...task, companyId, createdBy, createdAt: new Date().toISOString() })
      .returning()
      .get();
  }

  updateTask(companyId: number, id: number, updates: Partial<InsertTask>): Task | undefined {
    if (!this.getTask(companyId, id)) return undefined;
    return db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId)))
      .returning()
      .get();
  }

  /**
   * Tick a task off. If it repeats, the next occurrence is created here rather
   * than generated in advance — "every Monday" materialised ahead of time is an
   * unbounded table, and a repeat nobody completes should stop appearing.
   */
  completeTask(companyId: number, id: number, by: number) {
    const existing = this.getTask(companyId, id);
    if (!existing) return undefined;

    // Completing an already-complete task is a no-op, which makes this
    // endpoint genuinely idempotent. Without the guard, a double-tap on the
    // checkbox — or any retry — re-stamps the row AND inserts another next
    // occurrence for a repeating task. Two identical "Monday coordination
    // meeting" rows on the same job, each spawning its own next occurrence,
    // with nothing to tell them apart or dedupe them on.
    if (existing.completedAt) return { task: existing, nextOccurrence: null };

    return db.transaction((tx) => {
      const task = tx
        .update(tasks)
        .set({ completedAt: new Date().toISOString(), completedBy: by })
        .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId)))
        .returning()
        .get();

      let nextOccurrence: Task | null = null;
      if (existing.repeatRule && existing.dueDate) {
        const nextDue = advanceDate(existing.dueDate, existing.repeatRule as RepeatRule);
        nextOccurrence = tx
          .insert(tasks)
          .values({
            companyId,
            jobId: existing.jobId,
            title: existing.title,
            notes: existing.notes,
            dueDate: nextDue,
            dueTime: existing.dueTime,
            priority: existing.priority,
            assignedTo: existing.assignedTo,
            createdBy: existing.createdBy,
            repeatRule: existing.repeatRule,
            remindAt: shiftReminder(existing.remindAt, existing.dueDate, nextDue),
            createdAt: new Date().toISOString(),
          })
          .returning()
          .get();
      }
      return { task, nextOccurrence };
    });
  }

  reopenTask(companyId: number, id: number): Task | undefined {
    if (!this.getTask(companyId, id)) return undefined;
    return db
      .update(tasks)
      .set({ completedAt: null, completedBy: null })
      .where(and(eq(tasks.id, id), eq(tasks.companyId, companyId)))
      .returning()
      .get();
  }

  deleteTask(companyId: number, id: number): boolean {
    return db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.companyId, companyId))).run().changes > 0;
  }

  /**
   * Open and overdue counts plus the next deadline, per job — so the board can
   * show which job needs attention before it turns into a problem. One query
   * for the whole board rather than one per row.
   */
  getJobTaskSummary(companyId: number, today: string): Map<number, JobTaskSummary> {
    const rows = sqlite
      .prepare(
        `SELECT job_id AS jobId,
                COUNT(*) AS open,
                SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
                MIN(due_date) AS nextDue
           FROM tasks
          WHERE company_id = ? AND completed_at IS NULL
          GROUP BY job_id`,
      )
      .all(today, companyId) as Array<{ jobId: number; open: number; overdue: number; nextDue: string | null }>;

    return new Map(rows.map((r) => [r.jobId, { open: r.open, overdue: r.overdue, nextDue: r.nextDue }]));
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

/**
 * Advance a YYYY-MM-DD by one repeat interval.
 *
 * Built on UTC noon rather than midnight so a daylight-saving shift can never
 * push the result onto the neighbouring day. Month steps clamp — the 31st
 * repeating monthly lands on the 30th in a short month rather than skidding
 * into the next one, which is what Date would do unguarded.
 */
export function advanceDate(date: string, rule: RepeatRule): string {
  const [y, m, d] = date.split("-").map(Number);
  if (rule === "monthly") {
    const targetMonth = m === 12 ? 1 : m + 1;
    const targetYear = m === 12 ? y + 1 : y;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const day = Math.min(d, lastDay);
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const days = rule === "daily" ? 1 : rule === "weekly" ? 7 : 14;
  const next = new Date(Date.UTC(y, m - 1, d, 12));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Carry a reminder forward by the same gap it had from the old due date. */
export function shiftReminder(
  remindAt: string | null,
  oldDue: string,
  newDue: string,
): string | null {
  if (!remindAt) return null;
  const gap = new Date(`${oldDue}T12:00:00Z`).getTime() - new Date(remindAt).getTime();
  return new Date(new Date(`${newDue}T12:00:00Z`).getTime() - gap).toISOString();
}

export const storage = new DatabaseStorage();
