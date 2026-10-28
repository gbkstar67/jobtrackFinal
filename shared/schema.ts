import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Companies (tenants) ──
// Every row that holds customer data carries a companyId, and every read is
// scoped by it. One contractor's board must never be reachable from another's
// session — see the storage layer, where companyId is a required argument on
// every method rather than an optional filter.
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Where this shop's job numbers start. HL Thomas carries on from its paper
  // log at 26486; a new shop starts at 1 unless it says otherwise.
  jobNumberSeed: integer("job_number_seed").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export type Company = typeof companies.$inferSelect;

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;

// ── Employees ──
export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),              // e.g. "Foreman", "Laborer", "Electrician"
  phone: text("phone"),
  email: text("email"),
  color: text("color").notNull(),  // avatar color for quick visual ID
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),

  // ── Auth ──
  // Employees and users are the same four people, so login lives on this table
  // rather than a separate users table. Both columns are null for employees who
  // are crew-only and never sign in. Seeded by script/seed-users.ts; there is no
  // self-service signup, so neither column is writable through the API.
  // Either identifier signs you in. Both are globally unique, so a session
  // resolves to exactly one person at one company with no company picker.
  username: text("username"),
  loginEmail: text("login_email"),
  passwordHash: text("password_hash"),
});

// Note the omits: username and passwordHash are deliberately NOT part of the
// insert schema, so POST/PATCH /api/employees can never set a login or a hash.
export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  username: true,
  loginEmail: true,
  passwordHash: true,
  // Never client-supplied: it comes from the session, or a tenant could be
  // chosen by whoever is calling.
  companyId: true,
});

// What the API is allowed to send to the browser. Employee rows now carry a
// password hash, and db.select().from(employees) would happily serialise it,
// so every read path projects through this column list instead.
export const employeePublicColumns = {
  id: employees.id,
  name: employees.name,
  role: employees.role,
  phone: employees.phone,
  email: employees.email,
  color: employees.color,
  active: employees.active,
  createdAt: employees.createdAt,
  username: employees.username,
  loginEmail: employees.loginEmail,
  companyId: employees.companyId,
} as const;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

/** Largest avatar the server will accept, after the browser has resized it. */
export const MAX_AVATAR_BYTES = 400_000;
export const AVATAR_PIXELS = 256;
export type EmployeeRow = typeof employees.$inferSelect;
/**
 * An employee as the client ever sees one — never includes passwordHash.
 * hasAvatar is computed, not stored: it tells the UI whether to request the
 * picture or fall back to initials.
 */
export type Employee = Omit<EmployeeRow, "passwordHash"> & { hasAvatar?: boolean };

// ── Jobs ──
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  // Unique per company, not globally — two shops can both run a job 1042.
  jobNumber: text("job_number").notNull(),
  jobName: text("job_name").notNull(),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  clientAddress: text("client_address"),
  assignedTo: integer("assigned_to"),        // employee id
  createdBy: integer("created_by"),          // employee id
  startDate: text("start_date"),

  // Who bid the job: "HT" (Henry Thomas) or "DV" (Derek Victor). Stored as the
  // two-letter code the shop already writes on the paper job log.
  bidBy: text("bid_by"),
  // How the job bills: "CO" (contract) or "TM" (time & material).
  billingType: text("billing_type"),

  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

// The two codes are constrained to their allowed values here rather than left
// as free text, so a typo can't reach the database through the API.
export const insertJobSchema = createInsertSchema(jobs)
  .omit({
    id: true,
    jobNumber: true,
    createdAt: true,
    companyId: true, // from the session, never the request body
  })
  .extend({
    bidBy: z.enum(["HT", "DV"]).nullable().optional(),
    billingType: z.enum(["CO", "TM"]).nullable().optional(),
  });

/** Bidder codes, as written on the paper job log. */
export const BID_BY = {
  HT: "Henry Thomas",
  DV: "Derek Victor",
} as const;

/** Billing types, as written on the paper job log. */
export const BILLING_TYPE = {
  CO: "Contract",
  TM: "Time & Material",
} as const;

export type BidBy = keyof typeof BID_BY;
export type BillingType = keyof typeof BILLING_TYPE;

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ── Activity Log ──
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  jobId: integer("job_id").notNull(),

  // The job's identity is copied in at write time rather than joined at read
  // time. Deleting a job leaves its history behind pointing at an id that no
  // longer resolves, and the activity page used to render those rows blank.
  //
  // Deliberately NOT a foreign key with ON DELETE CASCADE: cascading would
  // delete exactly the history this table exists to keep.
  jobNumber: text("job_number"),
  jobName: text("job_name"),

  employeeId: integer("employee_id"),
  action: text("action").notNull(),          // "created", "updated", "assigned", "deleted"
  details: text("details"),                  // human-readable description
  timestamp: text("timestamp").notNull(),
});

export const insertActivitySchema = createInsertSchema(activityLog).omit({
  id: true,
  companyId: true,
});

export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityLog.$inferSelect;
