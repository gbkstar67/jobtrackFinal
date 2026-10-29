import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { sqlite } from "./db";
import { storage } from "./storage";

/**
 * Opaque bearer tokens for the native shell.
 *
 * The session cookie cannot be used there: WKWebView will not persist
 * Set-Cookie from capacitor://localhost, so an iOS build authenticates once and
 * is signed out on the next launch. This is a second, narrower credential —
 * random, stored only as a hash, scoped to one employee, revocable.
 */

const TOKEN_BYTES = 32;
const TTL_DAYS = 365;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function mintToken(companyId: number, employeeId: number, platform: string | null): string {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_DAYS * 86_400_000);
  sqlite
    .prepare(
      `INSERT INTO api_tokens (company_id, employee_id, token_hash, platform, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(companyId, employeeId, hash(token), platform, expires.toISOString(), now.toISOString());
  return token;
}

export function revokeToken(token: string) {
  sqlite
    .prepare("UPDATE api_tokens SET revoked_at = ? WHERE token_hash = ?")
    .run(new Date().toISOString(), hash(token));
}

export function revokeAllForEmployee(employeeId: number) {
  sqlite
    .prepare("UPDATE api_tokens SET revoked_at = ? WHERE employee_id = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), employeeId);
}

/**
 * Accept a bearer token in place of a session.
 *
 * Mounted BEFORE the isAuthenticated gate. It populates req.user exactly as
 * Passport would, so every downstream route — all of which derive the tenant
 * from req.user — keeps working unchanged and no route needs to know which
 * credential was used.
 */
export function bearerAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();

  const token = header.slice(7).trim();
  if (!token) return next();

  const row = sqlite
    .prepare(
      `SELECT employee_id AS employeeId, expires_at AS expiresAt, revoked_at AS revokedAt
         FROM api_tokens WHERE token_hash = ?`,
    )
    .get(hash(token)) as { employeeId: number; expiresAt: string; revokedAt: string | null } | undefined;

  if (!row || row.revokedAt || row.expiresAt <= new Date().toISOString()) return next();

  const employee = storage.getEmployeeRowById(row.employeeId);
  if (!employee || !employee.active) return next();

  const full = storage.getEmployee(employee.companyId, employee.id);
  if (!full) return next();

  (req as any).user = full;
  // Passport's own predicate is what isAuthenticated checks, so it has to agree.
  (req as any).isAuthenticated = () => true;

  sqlite
    .prepare("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?")
    .run(new Date().toISOString(), hash(token));

  next();
}
