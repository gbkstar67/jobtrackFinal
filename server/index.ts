import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { startReminderSweep } from "./reminders";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    // Profile pictures arrive as base64 data URLs, which inflate the bytes by
    // about a third. The default 100kb limit would reject them before the
    // route's own size check ran. The route still enforces MAX_AVATAR_BYTES.
    // Job photos are ~1600px JPEGs; base64 inflates them by a third.
    limit: "8mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * CORS for the native shell only.
 *
 * Capacitor serves the bundle from capacitor://localhost (iOS) and
 * http://localhost (Android), so every API call is cross-origin. Those two
 * origins are allowlisted explicitly — never a wildcard, and never with
 * credentials, because native authenticates with a bearer token and the web
 * app is same-origin and unaffected.
 */
const NATIVE_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && NATIVE_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Jobdeck-Client, X-Jobdeck-Platform, X-Jobdeck-Build, X-Jobdeck-Today, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    // Deliberately NO Access-Control-Allow-Credentials: native sends a bearer
    // token with credentials mode "omit", so allowing them would be a claim we
    // do not need to make.
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Method, path, status and duration only. Response bodies used to be
      // appended, which wrote every tenant's client names, phone numbers,
      // emails and site addresses into the platform log — readable by anyone
      // with access to the deploy console, and retained there.
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Sessions and Passport must be in place before any route is registered,
  // since the /api gate inside registerRoutes depends on req.isAuthenticated().
  setupAuth(app);

  await registerRoutes(httpServer, app);

  // Reminders: in-process, one replica, one SQLite file. A separate worker
  // would need its own handle on the same volume for no benefit.
  startReminderSweep();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Log the real error; return a generic one. err.message from the SQLite
    // driver carries table and column names and container paths.
    console.error("Internal Server Error:", err);
    const message =
      status < 500 && typeof err.message === "string" ? err.message : "Internal Server Error";

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
