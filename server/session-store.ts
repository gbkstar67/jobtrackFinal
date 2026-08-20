import session from "express-session";
import type { Database } from "better-sqlite3";

// A session store backed by the same better-sqlite3 handle the rest of the app
// uses. Deliberately hand-written rather than pulling in connect-sqlite3: that
// package depends on node-sqlite3, a *second* native module, which would need
// its own --external flag in the Dockerfile's esbuild step and its own prebuild
// for the deploy platform. This is forty lines and zero new dependencies.
//
// It replaces memorystore, which held sessions in process memory and therefore
// signed all four users out on every single Railway redeploy.

interface SessionRow {
  data: string;
}

export function createSessionStore(sqlite: Database): session.Store {
  const stmts = {
    get: sqlite.prepare<[string, number], SessionRow>(
      "SELECT data FROM sessions WHERE sid = ? AND expires > ?",
    ),
    set: sqlite.prepare(
      "INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?) " +
        "ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data",
    ),
    destroy: sqlite.prepare("DELETE FROM sessions WHERE sid = ?"),
    touch: sqlite.prepare("UPDATE sessions SET expires = ? WHERE sid = ?"),
    reap: sqlite.prepare("DELETE FROM sessions WHERE expires <= ?"),
  };

  // Fall back to a day if a session somehow has no cookie expiry attached.
  const expiryOf = (sess: session.SessionData) =>
    sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86_400_000;

  class SqliteSessionStore extends session.Store {
    get(sid: string, cb: (err?: unknown, session?: session.SessionData | null) => void) {
      try {
        const row = stmts.get.get(sid, Date.now());
        if (!row) return cb(null, null);
        cb(null, JSON.parse(row.data) as session.SessionData);
      } catch (err) {
        cb(err);
      }
    }

    set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void) {
      try {
        stmts.set.run(sid, expiryOf(sess), JSON.stringify(sess));
        cb?.(null);
      } catch (err) {
        cb?.(err);
      }
    }

    destroy(sid: string, cb?: (err?: unknown) => void) {
      try {
        stmts.destroy.run(sid);
        cb?.(null);
      } catch (err) {
        cb?.(err);
      }
    }

    // Called on every request when `rolling` is on, to slide the expiry forward.
    touch(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void) {
      try {
        stmts.touch.run(expiryOf(sess), sid);
        cb?.(null);
      } catch (err) {
        cb?.(err);
      }
    }
  }

  // Sweep expired rows hourly so the table doesn't grow without bound.
  // unref() so this timer never holds the process open on shutdown.
  const reaper = setInterval(() => {
    try {
      stmts.reap.run(Date.now());
    } catch (err) {
      console.error("[sessions] failed to reap expired sessions:", err);
    }
  }, 3_600_000);
  reaper.unref();

  return new SqliteSessionStore();
}
