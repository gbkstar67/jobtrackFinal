import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import passport from "passport";
import { storage } from "./storage";
import {
  isAuthenticated,
  loginThrottle,
  recordFailedLogin,
  clearLoginAttempts,
} from "./auth";
import { insertJobSchema, insertEmployeeSchema, type Employee } from "@shared/schema";

/** The signed-in employee. Safe to assert past the isAuthenticated gate. */
const actor = (req: Request) => req.user as Employee;

export async function registerRoutes(httpServer: Server, app: Express) {
  // ═══════════════════ AUTH (the only unauthenticated routes) ═══════════════════

  app.post("/api/login", loginThrottle, (req, res, next) => {
    passport.authenticate("local", (err: unknown, user: Employee | false, info?: { message?: string }) => {
      if (err) return next(err);

      if (!user) {
        recordFailedLogin(req);
        return res.status(401).json({ message: info?.message ?? "Incorrect username or password." });
      }

      // Re-issue the session id before establishing the login, so a session
      // fixated by an attacker beforehand isn't the one that ends up authenticated.
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);

        req.logIn(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          clearLoginAttempts(req);
          res.json(user);
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((destroyErr) => {
        if (destroyErr) return next(destroyErr);
        res.clearCookie("jobtrack.sid");
        res.status(204).end();
      });
    });
  });

  // Session check — how the client decides whether to show the app or the login
  // page. 401 rather than 200-with-null so it matches every other route.
  app.get("/api/me", (req, res) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ message: "Not authenticated" });
    res.json(req.user);
  });

  // ═══════════════════ THE GATE ═══════════════════
  // Mounted on the /api prefix rather than repeated per route, so a route added
  // later is protected by default instead of by whoever remembers. Everything
  // below this line requires a session; everything above it is public.
  app.use("/api", isAuthenticated);

  // ═══════════════════ EMPLOYEES ═══════════════════
  app.get("/api/employees", (_req, res) => {
    res.json(storage.getAllEmployees());
  });

  app.get("/api/employees/:id", (req, res) => {
    const emp = storage.getEmployee(parseInt(req.params.id, 10));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.post("/api/employees", (req, res) => {
    const result = insertEmployeeSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const emp = storage.createEmployee(result.data);
    res.status(201).json(emp);
  });

  app.patch("/api/employees/:id", (req, res) => {
    const result = insertEmployeeSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const emp = storage.updateEmployee(parseInt(req.params.id, 10), result.data);
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.delete("/api/employees/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const emp = storage.getEmployee(id);
    if (!emp) return res.status(404).json({ message: "Employee not found" });

    // Employees and users are now the same table, so deleting the wrong row
    // here destroys someone's login. Crew records stay deletable; accounts have
    // to be removed with the seed script, deliberately.
    if (emp.username) {
      return res.status(409).json({
        message: `${emp.name} has a login account and can't be deleted from the team page. Mark them inactive instead.`,
      });
    }

    storage.deleteEmployee(id);
    res.status(204).end();
  });

  // ═══════════════════ JOBS ═══════════════════
  app.get("/api/jobs", (_req, res) => {
    res.json(storage.getAllJobs());
  });

  app.get("/api/jobs/next-number", (_req, res) => {
    res.json({ jobNumber: storage.getNextJobNumber() });
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = storage.getJob(parseInt(req.params.id, 10));
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  });

  app.post("/api/jobs", (req, res) => {
    const result = insertJobSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });

    // createdBy comes from the session, never from the request body. The client
    // used to send it, which meant anyone could file a job under anyone's name —
    // and, because the who-am-I picker was React state that reset on refresh, it
    // was usually just null, giving "Someone created job X".
    const me = actor(req);
    const job = storage.createJob({ ...result.data, createdBy: me.id });

    storage.logActivity({
      jobId: job.id,
      employeeId: me.id,
      action: "created",
      details: `${me.name} created job ${job.jobNumber}`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(job);
  });

  app.patch("/api/jobs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const oldJob = storage.getJob(id);
    if (!oldJob) return res.status(404).json({ message: "Job not found" });

    const result = insertJobSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });

    const updatedJob = storage.updateJob(id, result.data);
    if (!updatedJob) return res.status(404).json({ message: "Job not found" });

    // Was `req.body._changedBy` — any caller could attribute an edit to anyone.
    const me = actor(req);

    if (result.data.status && result.data.status !== oldJob.status) {
      storage.logActivity({
        jobId: id,
        employeeId: me.id,
        action: "status_changed",
        details: `${me.name} changed status from ${oldJob.status} to ${result.data.status}`,
        timestamp: new Date().toISOString(),
      });
    }
    if (result.data.assignedTo !== undefined && result.data.assignedTo !== oldJob.assignedTo) {
      const assignee = result.data.assignedTo ? storage.getEmployee(result.data.assignedTo) : null;
      storage.logActivity({
        jobId: id,
        employeeId: me.id,
        action: "assigned",
        details: assignee ? `${me.name} assigned job to ${assignee.name}` : `${me.name} unassigned job`,
        timestamp: new Date().toISOString(),
      });
    }
    // General update log for other changes
    const skipKeys = ["status", "assignedTo"];
    const otherChanges = Object.keys(result.data).filter((k) => !skipKeys.includes(k));
    if (otherChanges.length > 0) {
      storage.logActivity({
        jobId: id,
        employeeId: me.id,
        action: "updated",
        details: `${me.name} updated ${otherChanges.join(", ")}`,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(updatedJob);
  });

  app.delete("/api/jobs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const job = storage.getJob(id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const me = actor(req);
    storage.deleteJob(id);

    // Logged before the row is gone so the trail keeps the job number and name.
    // Note there is deliberately no ON DELETE CASCADE on activity_log: cascading
    // would delete exactly the history this record exists to preserve.
    storage.logActivity({
      jobId: job.id,
      employeeId: me.id,
      action: "deleted",
      details: `${me.name} deleted job ${job.jobNumber} (${job.jobName})`,
      timestamp: new Date().toISOString(),
    });

    res.status(204).end();
  });

  // ═══════════════════ ACTIVITY LOG ═══════════════════
  app.get("/api/activity", (req, res) => {
    const jobId = req.query.jobId ? parseInt(req.query.jobId as string, 10) : undefined;
    res.json(storage.getActivities(jobId));
  });

  // ═══════════════════ BACKUP ═══════════════════
  // Railway volumes have no file browser and no download, so without this the
  // only copy of the database is unreachable except from inside the container.
  // Hitting this route in a browser downloads a consistent snapshot.
  app.get("/api/admin/backup", (req, res, next) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    const tmp = path.join(os.tmpdir(), `jobtrack-backup-${stamp}.db`);

    try {
      storage.backupTo(tmp);
    } catch (err) {
      return next(err);
    }

    res.download(tmp, `jobtrack-${stamp}.db`, (err) => {
      fs.unlink(tmp, () => {});
      if (err && !res.headersSent) next(err);
    });
  });

  return httpServer;
}
