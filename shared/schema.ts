import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Employees ──
export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role"),              // e.g. "Foreman", "Laborer", "Electrician"
  phone: text("phone"),
  email: text("email"),
  color: text("color").notNull(),  // avatar color for quick visual ID
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

// ── Jobs ──
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobNumber: text("job_number").notNull().unique(),
  jobName: text("job_name").notNull(),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  clientAddress: text("client_address"),
  status: text("status").notNull().default("pending"),
  assignedTo: integer("assigned_to"),        // employee id
  createdBy: integer("created_by"),          // employee id
  startDate: text("start_date"),
  dueDate: text("due_date"),
  completedDate: text("completed_date"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  jobNumber: true,
  createdAt: true,
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ── Activity Log ──
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  employeeId: integer("employee_id"),
  action: text("action").notNull(),          // "created", "updated", "status_changed", "assigned", "deleted"
  details: text("details"),                  // human-readable description
  timestamp: text("timestamp").notNull(),
});

export const insertActivitySchema = createInsertSchema(activityLog).omit({
  id: true,
});

export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityLog.$inferSelect;
