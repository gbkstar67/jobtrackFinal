import crypto from "crypto";
import { promisify } from "util";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express, Request, Response, NextFunction } from "express";
import { sqlite } from "./db";
import { createSessionStore } from "./session-store";
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
const WINDOW_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function throttleKey(req: Request) {
  return `${req.ip ?? "unknown"}:${String(req.body?.username ?? "").toLowerCase()}`;
}

export function loginThrottle(req: Request, res: Response, next: NextFunction) {
  const key = throttleKey(req);
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    const minutes = Math.ceil((entry.resetAt - now) / 60_000);
    return res
      .status(429)
      .json({ message: `Too many attempts. Try again in ${minutes} minute(s).` });
  }

  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
  next();
}

export function recordFailedLogin(req: Request) {
  const entry = attempts.get(throttleKey(req));
  if (entry) entry.count += 1;
}

export function clearLoginAttempts(req: Request) {
  attempts.delete(throttleKey(req));
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
      name: "jobtrack.sid",
      secret: sessionSecret(),
      store: createSessionStore(sqlite),
      resave: false,
      saveUninitialized: false,
      rolling: true, // slide the 30-day window forward on activity
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60_000,
      },
    }),
  );

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const employee = storage.getEmployeeByUsername(username);

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
      const employee = storage.getEmployee(id);
      // Deleted or deactivated mid-session: drop them rather than erroring.
      if (!employee || !employee.active) return done(null, false);
      done(null, employee);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());
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
