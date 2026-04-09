import { db } from "./db";
import {
  jobs, employees, activityLog,
  type Job, type InsertJob,
  type Employee, type InsertEmployee,
  type Activity, type InsertActivity,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Employees
  getAllEmployees(): Employee[];
  getEmployee(id: number): Employee | undefined;
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
  getAllEmployees(): Employee[] {
    return db.select().from(employees).orderBy(employees.name).all();
  }

  getEmployee(id: number): Employee | undefined {
    return db.select().from(employees).where(eq(employees.id, id)).get();
  }

  createEmployee(emp: InsertEmployee): Employee {
    const createdAt = new Date().toISOString();
    return db.insert(employees).values({ ...emp, createdAt }).returning().get();
  }

  updateEmployee(id: number, updates: Partial<InsertEmployee>): Employee | undefined {
    const existing = this.getEmployee(id);
    if (!existing) return undefined;
    return db.update(employees).set(updates).where(eq(employees.id, id)).returning().get();
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
    const jobNumber = this.getNextJobNumber();
    const createdAt = new Date().toISOString();
    return db.insert(jobs).values({ ...job, jobNumber, createdAt }).returning().get();
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
    const allJobs = db.select().from(jobs).all();
    const yearJobs = allJobs.filter((j) => j.jobNumber.startsWith(`JOB-${year}-`));
    const maxNum = yearJobs.reduce((max, j) => {
      const num = parseInt(j.jobNumber.split("-")[2] || "0", 10);
      return num > max ? num : max;
    }, 0);
    const nextNum = (maxNum + 1).toString().padStart(4, "0");
    return `JOB-${year}-${nextNum}`;
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
}

export const storage = new DatabaseStorage();
