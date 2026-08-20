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
import {
  insertJobSchema, insertEmployeeSchema, MAX_AVATAR_BYTES, type Employee,
} from "@shared/schema";

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

  // ═══════════════════ AVATARS ═══════════════════
  //
  // The browser resizes and re-encodes the picture to a small square before it
  // gets here, so the upload is a JSON data URL rather than a multipart form.
  // That avoids a file-upload dependency and caps the size at the source — but
  // the checks below still assume the client is lying, because it might be.

  const AVATAR_MIMES: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };

  /** Confirm the bytes really are the image type they claim to be. */
  function sniff(bytes: Buffer): string | null {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return "image/png";
    if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    return null;
  }

  app.get("/api/employees/:id/avatar", (req, res) => {
    const avatar = storage.getAvatar(parseInt(req.params.id, 10));
    if (!avatar) return res.status(404).json({ message: "No profile picture" });

    // Keyed on the upload time so a new picture busts the cache immediately
    // while an unchanged one is served from it.
    const etag = `"${Buffer.from(avatar.updatedAt).toString("base64url")}"`;
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    res.setHeader("Content-Type", avatar.mime);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("ETag", etag);
    res.send(avatar.bytes);
  });

  app.put("/api/employees/:id/avatar", (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!storage.getEmployee(id)) return res.status(404).json({ message: "Employee not found" });

    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    const match = dataUrl.match(/^data:([a-z/+-]+);base64,(.+)$/i);
    if (!match) return res.status(400).json({ message: "Expected a base64 image data URL" });

    const [, claimedMime, b64] = match;
    if (!AVATAR_MIMES[claimedMime]) {
      return res.status(415).json({ message: "Use a JPEG, PNG or WebP image" });
    }

    const bytes = Buffer.from(b64, "base64");
    if (bytes.length === 0) return res.status(400).json({ message: "Image was empty" });
    if (bytes.length > MAX_AVATAR_BYTES) {
      return res.status(413).json({ message: "That image is too large" });
    }

    // Trust the bytes, not the label.
    const actualMime = sniff(bytes);
    if (!actualMime) return res.status(415).json({ message: "That file isn't a valid image" });

    storage.setAvatar(id, actualMime, bytes);
    res.status(204).end();
  });

  app.delete("/api/employees/:id/avatar", (req, res) => {
    const removed = storage.deleteAvatar(parseInt(req.params.id, 10));
    if (!removed) return res.status(404).json({ message: "No profile picture" });
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
      jobNumber: job.jobNumber,
      jobName: job.jobName,
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

    if (result.data.assignedTo !== undefined && result.data.assignedTo !== oldJob.assignedTo) {
      const assignee = result.data.assignedTo ? storage.getEmployee(result.data.assignedTo) : null;
      storage.logActivity({
        jobId: id,
        jobNumber: oldJob.jobNumber,
        jobName: oldJob.jobName,
        employeeId: me.id,
        action: "assigned",
        details: assignee ? `${me.name} assigned job to ${assignee.name}` : `${me.name} unassigned job`,
        timestamp: new Date().toISOString(),
      });
    }
    // General update log for other changes
    const skipKeys = ["assignedTo"];
    const otherChanges = Object.keys(result.data).filter((k) => !skipKeys.includes(k));
    if (otherChanges.length > 0) {
      storage.logActivity({
        jobId: id,
        jobNumber: updatedJob.jobNumber,
        jobName: updatedJob.jobName,
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
      jobNumber: job.jobNumber,
      jobName: job.jobName,
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
