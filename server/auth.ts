import crypto from "crypto";
import { promisify } from "util";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express, Request, Response, NextFunction } from "express";
import { sqlite } from "./db";
import { createSessionStore } from "./session-store";
import { bearerAuth } from "./bearer";
import { storage } from "./storage";
import type { Employee } from "@shared/schema";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// ══════════════════════════ PASSWORD HASHING ══════════════════════════
// Node's built-in scrypt rather than bcrypt. better-sqlite3 is already a native
// module needing --external handling in the Dockerfile's esbuild step; adding a
// second native dependency to do something the standard library covers would
// double that surface for no benefit.

const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);

  // Constant-time compare so response timing can't be used to guess the hash.
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ══════════════════════════ LOGIN THROTTLE ══════════════════════════
// Four accounts on a public URL with no rate limit is a weekend of guessing.
// In-memory is fine here: the worst a redeploy does is reset the counters, and
// a single process serves every request.

const MAX_ATTEMPTS = 8;
const MAX_SIGNUPS = 5;
const WINDOW_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

// The map is swept on write rather than left to grow. Without this, every
// distinct key from an unauthenticated caller stays resident forever — a slow
// memory-exhaustion vector that needs no account at all.
const MAX_TRACKED = 10_000;
function sweep(now: number) {
  if (attempts.size < MAX_TRACKED) return;
  // Array.from rather than iterating the Map directly: the build targets a
  // lower lib than Map iteration requires, and it also avoids mutating while
  // iterating.
  for (const key of Array.from(attempts.keys())) {
    const entry = attempts.get(key);
    if (entry && entry.resetAt <= now) attempts.delete(key);
  }
}

/**
 * The bucket key.
 *
 * The identifier is trimmed as well as lowercased, because the account lookup
 * trims too — without it " grant" and "grant" resolve to the same account but
 * land in different buckets, so an attacker gets a fresh allowance per padding
 * variant and the throttle is decorative.
 */
function throttleKey(req: Request, scope: string) {
  // Signup is keyed on the SOURCE ALONE. Including the email would hand an
  // attacker a fresh allowance for every address they invent, which is exactly
  // how the previous version failed: the thing being limited is how many
  // companies one source can create, not how often one address is tried.
  if (scope === "signup") return `signup:${req.ip ?? "unknown"}`;

  // Login keys on source + account so one person fat-fingering their password
  // cannot lock out their whole shop behind a shared office IP. Trimmed as
  // well as lowercased, because the account lookup trims too — otherwise
  // " grant" and "grant" reach the same account through different buckets.
  const who = String(req.body?.username ?? "").trim().toLowerCase();
  return `login:${req.ip ?? "unknown"}:${who}`;
}

function gate(req: Request, res: Response, next: NextFunction, scope: string, max: number) {
  const key = throttleKey(req, scope);
  const now = Date.now();
  sweep(now);
  const entry = attempts.get(key);

  if (entry && entry.resetAt > now && entry.count >= max) {
    const minutes = Math.ceil((entry.resetAt - now) / 60_000);
    return res.status(429).json({ message: `Too many attempts. Try again in ${minutes} minute(s).` });
  }
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
  next();
}

export function loginThrottle(req: Request, res: Response, next: NextFunction) {
  gate(req, res, next, "login", MAX_ATTEMPTS);
}

/** Signup is unauthenticated and creates rows, so it gets its own tighter bucket. */
export function signupThrottle(req: Request, res: Response, next: NextFunction) {
  gate(req, res, next, "signup", MAX_SIGNUPS);
}

function bump(key: string) {
  const entry = attempts.get(key);
  if (entry) entry.count += 1;
}

export function recordFailedLogin(req: Request) {
  bump(throttleKey(req, "login"));
}

/**
 * Counted on EVERY signup, not just failures. A successful signup is the
 * expensive one — it creates a company and an authenticated session.
 */
export function recordSignupAttempt(req: Request) {
  bump(throttleKey(req, "signup"));
}

export function clearLoginAttempts(req: Request) {
  attempts.delete(throttleKey(req, "login"));
}

// ══════════════════════════ SETUP ══════════════════════════

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    // Fail loudly rather than falling back to a default string. A known secret
    // means anyone can forge a signed session cookie and walk straight in, and
    // a silent fallback is the kind of thing nobody notices until it matters.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET is not set. Refusing to start in production without it — " +
          "set it in the Railway service variables.",
      );
    }
    console.warn("[auth] SESSION_SECRET not set; using a throwaway dev secret.");
    return crypto.randomBytes(32).toString("hex");
  }

  return secret;
}

export function setupAuth(app: Express) {
  const isProduction = process.env.NODE_ENV === "production";

  // Railway terminates TLS at its proxy, so req.secure is only true if Express
  // is told to trust the X-Forwarded-Proto header. Without this, `secure: true`
  // cookies are silently dropped and login appears to succeed but never sticks.
  app.set("trust proxy", 1);

  app.use(
    session({
      name: "jobdeck.sid",
      secret: sessionSecret(),
      store: createSessionStore(sqlite),
      resave: false,
      saveUninitialized: false,
      // A year, slid forward on every request. This is a four-person internal
      // tool used from the same phones every day; being asked to sign in again
      // is friction with no security payoff, because the real gate is the lock
      // screen on the device. Sign out is always available in the header.
      //
      // The cookie is httpOnly and set by the server, which also keeps it out
      // of reach of iOS's 7-day cap on script-writable storage — a JS-set
      // token would be evicted after a week of not opening the app.
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60_000,
      },
    }),
  );

  passport.use(
    // "username" here is whatever was typed in the sign-in box: either the
    // short username the shop already uses, or an email address. Both are
    // globally unique, so one lookup resolves the person and their company.
    new LocalStrategy({ passReqToCallback: false }, async (username, password, done) => {
      try {
        const employee = storage.getEmployeeByLogin(username.trim().toLowerCase());

        // Always run a hash comparison, even when the username is unknown, so
        // that a wrong username and a wrong password take the same time and
        // can't be told apart by timing.
        const stored = employee?.passwordHash ?? "scrypt:00:00";
        const ok = await verifyPassword(password, stored);

        if (!employee || !employee.passwordHash || !ok) {
          return done(null, false, { message: "Incorrect username or password." });
        }
        if (!employee.active) {
          return done(null, false, { message: "This account is inactive." });
        }

        const { passwordHash: _omit, ...safe } = employee;
        return done(null, safe as Employee);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, (user as Employee).id));

  passport.deserializeUser((id: number, done) => {
    try {
      // The session stores only the employee id, so the company has to be read
      // back from the row rather than trusted from the session payload.
      const row = storage.getEmployeeRowById(id);
      if (!row || !row.active) return done(null, false); // deleted or deactivated mid-session
      const employee = storage.getEmployee(row.companyId, id);
      if (!employee) return done(null, false);
      done(null, employee);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  // Bearer tokens stand in for the session on native, where WKWebView will not
  // persist Set-Cookie from capacitor://localhost. Mounted AFTER passport so a
  // cookie session wins, and before the /api gate so req.user is populated
  // either way — no downstream route needs to know which credential was used.
  app.use(bearerAuth);
}

// ══════════════════════════ GATE ══════════════════════════

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ message: "Not authenticated" });
}

// Permissions are flat: all four accounts can do everything, by design.
//
// If Henry later wants deletes restricted to himself, this is where it goes —
// a requireRole("owner") middleware built on req.user.role, applied to the
// DELETE routes in routes.ts. The role column already exists on employees and
// the seed script already fills it in, so nothing else needs to change.

declare global {
  namespace Express {
    // Tell Passport that req.user is an Employee. The empty-interface merge is
    // how @types/passport expects this to be declared.
    interface User extends Employee {}
  }
}
