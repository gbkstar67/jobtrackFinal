import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import passport from "passport";
import { storage } from "./storage";
import {
  isAuthenticated,
  loginThrottle,
  signupThrottle,
  recordSignupAttempt,
  recordFailedLogin,
  clearLoginAttempts,
  hashPassword,
} from "./auth";
import { z } from "zod";
import {
  insertJobSchema, insertEmployeeSchema, insertTaskSchema,
  insertContactSchema, insertNoteSchema,
  MAX_AVATAR_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_JOB, type Employee,
} from "@shared/schema";
import { pushStatus } from "./push";
import { mintToken, revokeToken } from "./bearer";

const signupSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required"),
  name: z.string().trim().min(2, "Your name is required"),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
  // A shop moving off paper can carry its existing numbering across.
  firstJobNumber: z.number().int().positive().optional(),
});

/**
 * Operator-only gate for the whole-database backup.
 *
 * This is NOT a role check, deliberately. The file it guards is a VACUUM INTO
 * of the entire multi-tenant database: every contractor's client list, every
 * tenant's scrypt hashes, and every live session id. A tenant owner must not
 * be able to take other tenants' data either, so no in-app role is sufficient.
 *
 * Gated on an out-of-band ADMIN_TOKEN. With no token configured the route does
 * not exist at all — a deployment that forgot to set one must not fall back to
 * "any signed-in user", which is exactly the hole this replaces.
 */
function requireOperator(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(404).json({ message: "Not found" });

  const supplied = String(req.headers["x-admin-token"] ?? "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(404).json({ message: "Not found" });
  }
  next();
}

/** The signed-in employee. Safe to assert past the isAuthenticated gate. */
const actor = (req: Request) => req.user as Employee;

/**
 * The tenant for this request, taken from the session and nowhere else.
 *
 * Never read a company id from a path, query or body: that would let a signed-in
 * user at one shop ask for another shop's board simply by changing a number.
 */
const tenant = (req: Request) => (req.user as Employee).companyId;

export async function registerRoutes(httpServer: Server, app: Express) {
  // ═══════════════════ AUTH (the only unauthenticated routes) ═══════════════════

  app.post("/api/login", loginThrottle, (req, res, next) => {
    // passport-local falls back to req.query for username and password, which
    // would put credentials in the URL and therefore in proxy and platform
    // access logs. Only the body is a legitimate source.
    if (req.query.username || req.query.password) {
      return res.status(400).json({ message: "Send credentials in the request body." });
    }
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

          // The native shell cannot keep a cookie, so it asks for a bearer
          // token by identifying itself. Web clients get the cookie only.
          const client = String(req.headers["x-jobdeck-client"] ?? "");
          if (client === "native") {
            const platform = String(req.headers["x-jobdeck-platform"] ?? "") || null;
            return res.json({ ...user, token: mintToken(user.companyId, user.id, platform) });
          }
          res.json(user);
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    // Revoke the bearer too, or signing out on the phone leaves a credential
    // that still works.
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) revokeToken(header.slice(7).trim());

    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((destroyErr) => {
        if (destroyErr) return next(destroyErr);
        res.clearCookie("jobdeck.sid");
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

  // ═══════════════════ SIGN UP ═══════════════════
  // Creates a company and its first user in one step. Unauthenticated by
  // necessity — there is no session yet — so it is throttled like the login.

  function slugify(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return base || "shop";
  }

  /** First free slug: acme, acme-2, acme-3 … */
  function uniqueSlug(name: string): string {
    const base = slugify(name);
    let candidate = base;
    for (let n = 2; storage.getCompanyBySlug(candidate); n += 1) candidate = `${base}-${n}`;
    return candidate;
  }

  app.post("/api/signup", signupThrottle, async (req, res, next) => {
    const body = signupSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "Check the form", errors: body.error.flatten() });
    }

    const { companyName, name, email, password, firstJobNumber } = body.data;
    const loginEmail = email.trim().toLowerCase();

    // Every signup counts against the bucket, successful or not. loginThrottle
    // only ever rose on a FAILED login, and signup never reported failures — so
    // the counter it read could never increase and the gate never closed.
    recordSignupAttempt(req);

    if (storage.getEmployeeByLogin(loginEmail)) {
      return res.status(409).json({ message: "That email is already registered." });
    }

    try {
      const company = storage.createCompany(
        companyName.trim(),
        uniqueSlug(companyName),
        firstJobNumber ?? 1,
      );
      const owner = storage.createOwner(company.id, {
        name: name.trim(),
        loginEmail,
        passwordHash: await hashPassword(password),
      });

      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.logIn(owner, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.status(201).json(owner);
        });
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Accept an invite / reset token: set a password and sign in ──
  // Unauthenticated by necessity, and the only path besides signup and the
  // seed script that can create a login. Without it a shop signs up, adds
  // eight people, and none of them can sign in.
  app.post("/api/accept-invite", loginThrottle, async (req, res, next) => {
    const body = z
      .object({ token: z.string().min(10), email: z.string().trim().email(), password: z.string().min(8) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Check the form", errors: body.error.flatten() });

    const claim = storage.consumeInvite(body.data.token);
    if (!claim) return res.status(410).json({ message: "That invite link has expired or was already used." });

    const loginEmail = body.data.email.toLowerCase();
    const taken = storage.getEmployeeByLogin(loginEmail);
    if (taken && taken.id !== claim.employeeId) {
      return res.status(409).json({ message: "That email is already registered." });
    }

    try {
      storage.setLogin(claim.companyId, claim.employeeId, loginEmail, await hashPassword(body.data.password));
      const user = storage.getEmployee(claim.companyId, claim.employeeId);
      if (!user) return res.status(404).json({ message: "Employee not found" });

      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.logIn(user, (loginErr) => (loginErr ? next(loginErr) : res.json(user)));
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Client config, unauthenticated ──
  // A shipped App Store build runs whatever Apple approved weeks ago and cannot
  // be rolled forward. This lets the server tell an old build to update, and
  // lets the API base move (to the LLC's own domain, say) without a release.
  app.get("/api/client-config", (_req, res) => {
    res.json({
      minBuild: Number(process.env.MIN_CLIENT_BUILD ?? 0),
      apiBase: process.env.PUBLIC_API_BASE ?? null,
      push: { publicKey: pushStatus().publicKey },
    });
  });

  // ═══════════════════ THE GATE ═══════════════════
  // Mounted on the /api prefix rather than repeated per route, so a route added
  // later is protected by default instead of by whoever remembers. Everything
  // below this line requires a session; everything above it is public.
  app.use("/api", isAuthenticated);

  /** The signed-in user's own company. Used for the name in the header. */
  app.get("/api/company", (req, res) => {
    const company = storage.getCompany(tenant(req));
    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json({ id: company.id, name: company.name, slug: company.slug });
  });

  /** Only the company owner may invite, or change who holds a login. */
  function isOwner(req: Request): boolean {
    const company = storage.getCompany(tenant(req));
    return Boolean(company && company.ownerEmployeeId === actor(req).id);
  }

  function requireOwner(req: Request, res: Response, next: NextFunction) {
    if (!isOwner(req)) return res.status(403).json({ message: "Only the account owner can do that." });
    next();
  }

  // ═══════════════════ EMPLOYEES ═══════════════════
  app.get("/api/employees", (req, res) => {
    res.json(storage.getAllEmployees(tenant(req)));
  });

  app.get("/api/employees/:id", (req, res) => {
    const emp = storage.getEmployee(tenant(req), parseInt(String(req.params.id), 10));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.post("/api/employees", (req, res) => {
    const result = insertEmployeeSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const emp = storage.createEmployee(tenant(req), result.data);
    res.status(201).json(emp);
  });

  app.patch("/api/employees/:id", (req, res) => {
    const result = insertEmployeeSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const emp = storage.updateEmployee(tenant(req), parseInt(String(req.params.id), 10), result.data);
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.delete("/api/employees/:id", (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const emp = storage.getEmployee(tenant(req), id);
    if (!emp) return res.status(404).json({ message: "Employee not found" });

    // Employees and users are now the same table, so deleting the wrong row
    // here destroys someone's login. Crew records stay deletable; accounts have
    // to be removed with the seed script, deliberately.
    // Tests BOTH identifiers. It used to check username only, which was written
    // when every login came from the seed script. Owners created by signup have
    // a loginEmail and no username, so their company's sole login could delete
    // itself and lock the tenant out of its own data permanently.
    if (emp.username || emp.loginEmail) {
      return res.status(409).json({
        message: `${emp.name} has a login and can't be deleted from the team page. Mark them inactive instead.`,
      });
    }

    storage.deleteEmployee(tenant(req), id);
    res.status(204).end();
  });


  /**
   * assignedTo arrives in the request body, so it has to be proved to belong to
   * this company before it is written. Otherwise a signed-in user could park a
   * job on someone at another contractor simply by guessing an id.
   */
  function assigneeIsValid(req: Request, assignedTo: number | null | undefined): boolean {
    if (assignedTo === undefined || assignedTo === null) return true;
    return Boolean(storage.getEmployee(tenant(req), assignedTo));
  }

  // ── Invite a crew member / reset a password ──
  app.post("/api/employees/:id/invite", requireOwner, (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const emp = storage.getEmployee(tenant(req), id);
    if (!emp) return res.status(404).json({ message: "Employee not found" });

    const purpose = emp.loginEmail || emp.username ? "reset" : "invite";
    const token = storage.createInvite(tenant(req), id, purpose, actor(req).id);

    // Returned once, to the owner, who passes it on however they like. No mail
    // server is configured and inventing one is a bigger decision than this.
    res.json({
      purpose,
      link: `/#/accept-invite?token=${token}`,
      expiresInDays: 7,
      name: emp.name,
    });
  });

  // ═══════════════════ PUSH ═══════════════════
  app.get("/api/push/status", (req, res) => {
    const status = pushStatus();
    res.json({ ...status, myDevices: storage.countDevices(tenant(req), actor(req).id) });
  });

  app.post("/api/push/register", (req, res) => {
    const body = z
      .object({
        transport: z.enum(["web", "apns", "fcm"]),
        endpoint: z.string().min(8),
        p256dh: z.string().nullable().optional(),
        auth: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid subscription" });

    storage.registerDevice(tenant(req), actor(req).id, body.data);
    res.status(204).end();
  });

  app.post("/api/push/unregister", (req, res) => {
    const endpoint = String(req.body?.endpoint ?? "");
    if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
    storage.removeDevice(tenant(req), endpoint);
    res.status(204).end();
  });

  /** Send a test push to the caller's own devices — the fastest way to tell
   *  "notifications are off" from "the sweep is broken". */
  app.post("/api/push/test", async (req, res) => {
    const devices = storage.countDevices(tenant(req), actor(req).id);
    if (!devices) return res.status(409).json({ message: "No device registered on this account yet." });
    const { runTestPush } = await import("./reminders-test");
    const sent = await runTestPush(tenant(req), actor(req).id, actor(req).name);
    res.json({ devices, sent });
  });

  // ═══════════════════ JOB PHOTOS, CONTACTS, NOTES ═══════════════════
  app.get("/api/jobs/:id/photos", (req, res) => {
    const jobId = parseInt(String(req.params.id), 10);
    if (!storage.getJob(tenant(req), jobId)) return res.status(404).json({ message: "Job not found" });
    res.json(storage.listPhotos(tenant(req), jobId));
  });

  app.get("/api/photos/:id/:size", (req, res) => {
    const size = String(req.params.size) === "thumb" ? "thumb" : "full";
    const photo = storage.getPhotoBytes(tenant(req), parseInt(String(req.params.id), 10), size);
    if (!photo) return res.status(404).json({ message: "Photo not found" });
    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(photo.bytes);
  });

  app.post("/api/jobs/:id/photos", (req, res) => {
    const jobId = parseInt(String(req.params.id), 10);
    if (!storage.getJob(tenant(req), jobId)) return res.status(404).json({ message: "Job not found" });
    if (storage.countPhotos(tenant(req), jobId) >= MAX_PHOTOS_PER_JOB) {
      return res.status(409).json({ message: `That job already has ${MAX_PHOTOS_PER_JOB} photos.` });
    }

    const full = decodeImage(String(req.body?.dataUrl ?? ""), MAX_PHOTO_BYTES);
    const thumb = decodeImage(String(req.body?.thumbUrl ?? ""), 200_000);
    if ("error" in full) return res.status(full.status).json({ message: full.error });
    if ("error" in thumb) return res.status(thumb.status).json({ message: thumb.error });

    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 300) : null;
    res.status(201).json(
      storage.addPhoto(tenant(req), jobId, full.mime, full.bytes, thumb.bytes, caption || null, actor(req).id),
    );
  });

  app.delete("/api/photos/:id", (req, res) => {
    if (!storage.deletePhoto(tenant(req), parseInt(String(req.params.id), 10))) {
      return res.status(404).json({ message: "Photo not found" });
    }
    res.status(204).end();
  });

  app.get("/api/jobs/:id/contacts", (req, res) => {
    const jobId = parseInt(String(req.params.id), 10);
    if (!storage.getJob(tenant(req), jobId)) return res.status(404).json({ message: "Job not found" });
    res.json(storage.listContacts(tenant(req), jobId));
  });

  app.post("/api/contacts", (req, res) => {
    const result = insertContactSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    if (!storage.getJob(tenant(req), result.data.jobId)) {
      return res.status(400).json({ message: "That job isn't on your board" });
    }
    res.status(201).json(storage.addContact(tenant(req), result.data));
  });

  app.delete("/api/contacts/:id", (req, res) => {
    if (!storage.deleteContact(tenant(req), parseInt(String(req.params.id), 10))) {
      return res.status(404).json({ message: "Contact not found" });
    }
    res.status(204).end();
  });

  app.get("/api/jobs/:id/notes", (req, res) => {
    const jobId = parseInt(String(req.params.id), 10);
    if (!storage.getJob(tenant(req), jobId)) return res.status(404).json({ message: "Job not found" });
    res.json(storage.listNotes(tenant(req), jobId));
  });

  app.post("/api/notes", (req, res) => {
    const result = insertNoteSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const job = storage.getJob(tenant(req), result.data.jobId);
    if (!job) return res.status(400).json({ message: "That job isn't on your board" });

    const me = actor(req);
    const note = storage.addNote(tenant(req), result.data, me.id);
    storage.logActivity(tenant(req), {
      jobId: job.id, jobNumber: job.jobNumber, jobName: job.jobName,
      employeeId: me.id, action: "note",
      details: `${me.name} added a field note`,
      timestamp: new Date().toISOString(),
    });
    res.status(201).json(note);
  });

  app.delete("/api/notes/:id", (req, res) => {
    if (!storage.deleteNote(tenant(req), parseInt(String(req.params.id), 10))) {
      return res.status(404).json({ message: "Note not found" });
    }
    res.status(204).end();
  });

  // ═══════════════════ AVATARS ═══════════════════
  //
  // The browser resizes and re-encodes the picture to a small square before it
  // gets here, so the upload is a JSON data URL rather than a multipart form.
  // That avoids a file-upload dependency and caps the size at the source — but
  // the checks below still assume the client is lying, because it might be.

  /**
   * Decode a base64 data URL to bytes, trusting the magic bytes rather than the
   * declared type. Shared by avatars and job photos.
   */
  function decodeImage(dataUrl: string, maxBytes: number):
    | { mime: string; bytes: Buffer }
    | { error: string; status: number } {
    const match = dataUrl.match(/^data:([a-z/+-]+);base64,(.+)$/i);
    if (!match) return { error: "Expected a base64 image data URL", status: 400 };
    if (!AVATAR_MIMES[match[1]]) return { error: "Use a JPEG, PNG or WebP image", status: 415 };

    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) return { error: "Image was empty", status: 400 };
    if (bytes.length > maxBytes) return { error: "That image is too large", status: 413 };

    const actual = sniff(bytes);
    if (!actual) return { error: "That file isn't a valid image", status: 415 };
    return { mime: actual, bytes };
  }

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
    const avatar = storage.getAvatar(tenant(req), parseInt(String(req.params.id), 10));
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
    const id = parseInt(String(req.params.id), 10);
    if (!storage.getEmployee(tenant(req), id)) return res.status(404).json({ message: "Employee not found" });

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

    storage.setAvatar(tenant(req), id, actualMime, bytes);
    res.status(204).end();
  });

  app.delete("/api/employees/:id/avatar", (req, res) => {
    const removed = storage.deleteAvatar(tenant(req), parseInt(String(req.params.id), 10));
    if (!removed) return res.status(404).json({ message: "No profile picture" });
    res.status(204).end();
  });

  // ═══════════════════ JOBS ═══════════════════
  app.get("/api/jobs", (req, res) => {
    res.json(storage.getAllJobs(tenant(req)));
  });

  // Must sit above /api/jobs/:id or "task-summary" is parsed as an id.
  app.get("/api/jobs/task-summary", (req, res) => {
    const summary = storage.getJobTaskSummary(tenant(req), viewerToday(req));
    res.json(Object.fromEntries(summary));
  });

  app.get("/api/jobs/next-number", (req, res) => {
    res.json({ jobNumber: storage.getNextJobNumber(tenant(req)) });
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = storage.getJob(tenant(req), parseInt(String(req.params.id), 10));
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
    if (!assigneeIsValid(req, result.data.assignedTo)) {
      return res.status(400).json({ message: "That assignee isn't on your team" });
    }

    const me = actor(req);
    const job = storage.createJob(tenant(req), result.data, me.id);

    storage.logActivity(tenant(req), {
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
    const id = parseInt(String(req.params.id), 10);
    const oldJob = storage.getJob(tenant(req), id);
    if (!oldJob) return res.status(404).json({ message: "Job not found" });

    const result = insertJobSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });

    if (!assigneeIsValid(req, result.data.assignedTo)) {
      return res.status(400).json({ message: "That assignee isn't on your team" });
    }

    const updatedJob = storage.updateJob(tenant(req), id, result.data);
    if (!updatedJob) return res.status(404).json({ message: "Job not found" });

    // Was `req.body._changedBy` — any caller could attribute an edit to anyone.
    const me = actor(req);

    if (result.data.assignedTo !== undefined && result.data.assignedTo !== oldJob.assignedTo) {
      const assignee = result.data.assignedTo ? storage.getEmployee(tenant(req), result.data.assignedTo) : null;
      storage.logActivity(tenant(req), {
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
      storage.logActivity(tenant(req), {
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
    const id = parseInt(String(req.params.id), 10);
    const job = storage.getJob(tenant(req), id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const me = actor(req);
    storage.deleteJob(tenant(req), id);

    // Logged before the row is gone so the trail keeps the job number and name.
    // Note there is deliberately no ON DELETE CASCADE on activity_log: cascading
    // would delete exactly the history this record exists to preserve.
    storage.logActivity(tenant(req), {
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

  // ═══════════════════ TASKS ═══════════════════
  //
  // What's owed on each job. Every task hangs off a job by design — "call the
  // engineer" on its own is a sticky note; "call the engineer about 26350" is
  // the thing worth keeping.

  /** The viewer's own date, used for overdue/today. Never computed here. */
  function viewerToday(req: Request): string {
    // Header first, query second. The header keeps "today" out of the query
    // key, so a cache persisted yesterday still matches this morning's
    // request — the offline read otherwise fails on exactly the day it
    // matters, because the key contains a date never fetched.
    const supplied = String(req.headers["x-jobdeck-today"] ?? req.query.today ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(supplied)) return supplied;
    // A client that forgot to send one still gets something sane, but the
    // server runs UTC so this can be a day ahead of Pennsylvania after 8pm.
    return new Date().toISOString().slice(0, 10);
  }

  app.get("/api/tasks", (req, res) => {
    const view = String(req.query.view ?? "open");
    if (!["open", "today", "upcoming", "done", "all", "range"].includes(view)) {
      return res.status(400).json({ message: "Unknown view" });
    }

    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (view === "range") {
      const valid = /^\d{4}-\d{2}-\d{2}$/;
      if (!valid.test(from) || !valid.test(to)) {
        return res.status(400).json({ message: "range needs from and to as YYYY-MM-DD" });
      }
      // A bounded window: an unbounded range is a whole-table scan served as
      // JSON, which on a 4G truck connection is the same as broken.
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      if (days < 0 || days > 92) {
        return res.status(400).json({ message: "range must be 0-92 days" });
      }
    }
    const rawAssignee = req.query.assignedTo;
    res.json(
      storage.getTasks(tenant(req), {
        view: view as any,
        today: viewerToday(req),
        from: from || undefined,
        to: to || undefined,
        jobId: req.query.jobId ? parseInt(String(req.query.jobId), 10) : undefined,
        priority: req.query.priority ? (String(req.query.priority) as any) : undefined,
        assignedTo:
          rawAssignee === "unassigned"
            ? "unassigned"
            : rawAssignee
              ? parseInt(String(rawAssignee), 10)
              : undefined,
      }),
    );
  });

  app.get("/api/tasks/:id", (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    // A non-numeric id means the caller built a bad URL. Say so, rather than
    // returning the 404 that looks like "no such task".
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid task id" });
    const task = storage.getTask(tenant(req), id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(task);
  });

  app.post("/api/tasks", (req, res) => {
    const result = insertTaskSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    }

    // jobId and assignedTo both arrive from the client, so both are proved to
    // belong to this company before anything is written.
    const job = storage.getJob(tenant(req), result.data.jobId);
    if (!job) return res.status(400).json({ message: "That job isn't on your board" });
    if (!assigneeIsValid(req, result.data.assignedTo)) {
      return res.status(400).json({ message: "That assignee isn't on your team" });
    }

    const me = actor(req);
    const task = storage.createTask(tenant(req), result.data, me.id);

    storage.logActivity(tenant(req), {
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobName: job.jobName,
      employeeId: me.id,
      action: "task_added",
      details: `${me.name} added "${task.title}"`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(task);
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!storage.getTask(tenant(req), id)) return res.status(404).json({ message: "Task not found" });

    const result = insertTaskSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    }
    if (result.data.jobId && !storage.getJob(tenant(req), result.data.jobId)) {
      return res.status(400).json({ message: "That job isn't on your board" });
    }
    if (!assigneeIsValid(req, result.data.assignedTo)) {
      return res.status(400).json({ message: "That assignee isn't on your team" });
    }

    res.json(storage.updateTask(tenant(req), id, result.data));
  });

  app.post("/api/tasks/:id/complete", (req, res) => {
    const me = actor(req);
    const done = storage.completeTask(tenant(req), parseInt(String(req.params.id), 10), me.id);
    if (!done) return res.status(404).json({ message: "Task not found" });

    const job = storage.getJob(tenant(req), done.task.jobId);
    if (job) {
      storage.logActivity(tenant(req), {
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobName: job.jobName,
        employeeId: me.id,
        action: "task_done",
        details: `${me.name} finished "${done.task.title}"`,
        timestamp: new Date().toISOString(),
      });
    }

    // nextOccurrence is non-null when the task repeats — the client uses it to
    // tell the user the next one has been scheduled rather than silently
    // re-adding a row they just ticked off.
    res.json(done);
  });

  app.post("/api/tasks/:id/reopen", (req, res) => {
    const task = storage.reopenTask(tenant(req), parseInt(String(req.params.id), 10));
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(task);
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const removed = storage.deleteTask(tenant(req), parseInt(String(req.params.id), 10));
    if (!removed) return res.status(404).json({ message: "Task not found" });
    res.status(204).end();
  });

  // ═══════════════════ ACTIVITY LOG ═══════════════════
  app.get("/api/activity", (req, res) => {
    const jobId = req.query.jobId ? parseInt(req.query.jobId as string, 10) : undefined;
    res.json(storage.getActivities(tenant(req), jobId));
  });

  // ═══════════════════ BACKUP ═══════════════════
  // Railway volumes have no file browser and no download, so without this the
  // only copy of the database is unreachable except from inside the container.
  // Hitting this route in a browser downloads a consistent snapshot.
  app.get("/api/admin/backup", requireOperator, (req, res, next) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Randomised, not timestamped: VACUUM INTO refuses to overwrite, so two
    // requests in the same second would collide on a per-second name.
    const tmp = path.join(os.tmpdir(), `jobdeck-backup-${stamp}-${crypto.randomUUID()}.db`);

    try {
      storage.backupTo(tmp);
    } catch (err) {
      return next(err);
    }

    res.download(tmp, `jobdeck-${stamp}.db`, (err) => {
      fs.unlink(tmp, () => {});
      if (err && !res.headersSent) next(err);
    });
  });

  return httpServer;
}
