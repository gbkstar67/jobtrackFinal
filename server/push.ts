import crypto from "crypto";
import http2 from "http2";

/**
 * Push delivery for three transports behind one function.
 *
 * Deliberately hand-rolled rather than firebase-admin: that package requires
 * Node >= 22, which would force this image off node:20-slim — and
 * better-sqlite3@11 ships no prebuild for Node 22's ABI, so the base-image bump
 * becomes a from-source native compile on a slim image with no compiler. All of
 * that to reach devices Google is only relaying to anyway.
 *
 * APNs and FCM both authenticate with a JWT the standard library can sign, and
 * Web Push is the same VAPID primitive. ~200 lines, zero dependencies, no
 * engines floor, nothing for esbuild to mark external.
 */

export interface PushTarget {
  id: number;
  transport: string;          // "web" | "apns" | "fcm"
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Deep link path, e.g. "/tasks" or "/job/12". */
  path?: string;
  tag?: string;
}

/** A delivery result per device so the caller can prune dead endpoints. */
export interface PushResult {
  deviceId: number;
  ok: boolean;
  /** True when the endpoint is permanently gone and should be deleted. */
  gone: boolean;
  detail?: string;
}

// ══════════════════════════ JWT ══════════════════════════

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** ES256 JWT — the format both APNs and VAPID use. */
function signES256(header: object, claims: object, privateKey: crypto.KeyObject): string {
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const der = crypto.sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363", // JOSE wants raw r||s, not DER
  });
  return `${unsigned}.${b64url(der)}`;
}

/** RS256 JWT — Google service accounts. */
function signRS256(header: object, claims: object, pem: string): string {
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), pem);
  return `${unsigned}.${b64url(sig)}`;
}

// ══════════════════════════ WEB PUSH (VAPID) ══════════════════════════
//
// Covers Android Chrome, desktop browsers, and — since iOS 16.4 — iPhone for a
// home-screen-installed PWA. This is what delivers reminders before the native
// builds are through review, and it keeps working after.

function vapidKey(): crypto.KeyObject | null {
  const pem = process.env.VAPID_PRIVATE_KEY;
  if (!pem) return null;
  try {
    return crypto.createPrivateKey(
      pem.includes("BEGIN") ? pem : Buffer.from(pem, "base64url"),
    );
  } catch {
    return null;
  }
}

function vapidAuth(endpoint: string): string | null {
  const key = vapidKey();
  const subject = process.env.VAPID_SUBJECT;
  if (!key || !subject) return null;

  const { origin } = new URL(endpoint);
  const jwt = signES256(
    { typ: "JWT", alg: "ES256" },
    { aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject },
    key,
  );
  return `vapid t=${jwt}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

/**
 * Encrypt a payload with aes128gcm per RFC 8291.
 *
 * The browser's subscription gives a P-256 public key and an auth secret; the
 * server generates an ephemeral keypair, does ECDH, and derives content keys
 * through HKDF. Getting any step wrong yields a push the browser silently drops.
 */
function encryptWebPush(payload: string, p256dh: string, auth: string): Buffer {
  const clientPub = Buffer.from(p256dh, "base64url");
  const authSecret = Buffer.from(auth, "base64url");

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPub);

  const salt = crypto.randomBytes(16);
  const hkdf = (ikm: Buffer, saltBuf: Buffer, info: Buffer, len: number) => {
    const prk = crypto.createHmac("sha256", saltBuf).update(ikm).digest();
    return crypto
      .createHmac("sha256", prk)
      .update(Buffer.concat([info, Buffer.from([1])]))
      .digest()
      .subarray(0, len);
  };

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    clientPub,
    serverPub,
  ]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // The record must be padding-delimited: 0x02 marks the final record.
  const body = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPub.length, 20);

  return Buffer.concat([header, serverPub, encrypted]);
}

async function sendWeb(target: PushTarget, msg: PushMessage): Promise<PushResult> {
  const authHeader = vapidAuth(target.endpoint);
  if (!authHeader) return { deviceId: target.id, ok: false, gone: false, detail: "VAPID not configured" };
  if (!target.p256dh || !target.auth) {
    return { deviceId: target.id, ok: false, gone: true, detail: "subscription missing keys" };
  }

  const payload = JSON.stringify(msg);
  const body = encryptWebPush(payload, target.p256dh, target.auth);

  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body,
  });

  // 404/410 mean the subscription is permanently gone — prune it.
  return {
    deviceId: target.id,
    ok: res.ok,
    gone: res.status === 404 || res.status === 410,
    detail: res.ok ? undefined : `${res.status} ${await res.text().catch(() => "")}`.slice(0, 200),
  };
}

// ══════════════════════════ APNs ══════════════════════════

let apnsTokenCache: { token: string; mintedAt: number } | null = null;

function apnsBearer(): string | null {
  const key = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!key || !keyId || !teamId) return null;

  // Apple rejects tokens older than an hour and also rejects minting them too
  // often, so it is cached and refreshed on a 50-minute cadence.
  const now = Date.now();
  if (apnsTokenCache && now - apnsTokenCache.mintedAt < 50 * 60_000) return apnsTokenCache.token;

  const pem = key.includes("BEGIN") ? key : Buffer.from(key, "base64").toString("utf8");
  const token = signES256(
    { alg: "ES256", kid: keyId },
    { iss: teamId, iat: Math.floor(now / 1000) },
    crypto.createPrivateKey(pem),
  );
  apnsTokenCache = { token, mintedAt: now };
  return token;
}

function sendApns(target: PushTarget, msg: PushMessage): Promise<PushResult> {
  const bearer = apnsBearer();
  const topic = process.env.APNS_BUNDLE_ID;
  if (!bearer || !topic) {
    return Promise.resolve({ deviceId: target.id, ok: false, gone: false, detail: "APNs not configured" });
  }

  // Sandbox vs production is the classic APNs time sink: a development build's
  // token is only valid against api.sandbox, and the error is a bare
  // BadDeviceToken that looks like a bad token rather than a wrong host.
  const host = process.env.APNS_ENVIRONMENT === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";

  return new Promise((resolve) => {
    const client = http2.connect(host);
    const body = JSON.stringify({
      aps: { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": msg.tag },
      path: msg.path ?? "/tasks",
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${target.endpoint}`,
      authorization: `bearer ${bearer}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let detail = "";
    req.on("response", (headers) => { status = Number(headers[":status"]) || 0; });
    req.on("data", (chunk) => { detail += chunk; });
    req.on("error", (err) => {
      client.close();
      resolve({ deviceId: target.id, ok: false, gone: false, detail: String(err).slice(0, 200) });
    });
    req.on("end", () => {
      client.close();
      // 410 Unregistered, or 400 BadDeviceToken — the app was deleted.
      const gone = status === 410 || detail.includes("BadDeviceToken") || detail.includes("Unregistered");
      resolve({ deviceId: target.id, ok: status === 200, gone, detail: detail.slice(0, 200) || undefined });
    });

    req.end(body);
    req.setTimeout(10_000, () => { req.close(); client.close(); });
  });
}

// ══════════════════════════ FCM (HTTP v1) ══════════════════════════

let fcmTokenCache: { token: string; expiresAt: number } | null = null;

async function fcmAccessToken(): Promise<{ token: string; projectId: string } | null> {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;

  const sa = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);

  if (fcmTokenCache && fcmTokenCache.expiresAt > now + 60) {
    return { token: fcmTokenCache.token, projectId: sa.project_id };
  }

  const assertion = signRS256(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { access_token: string; expires_in: number };
  fcmTokenCache = { token: json.access_token, expiresAt: now + json.expires_in };
  return { token: json.access_token, projectId: sa.project_id };
}

async function sendFcm(target: PushTarget, msg: PushMessage): Promise<PushResult> {
  const creds = await fcmAccessToken();
  if (!creds) return { deviceId: target.id, ok: false, gone: false, detail: "FCM not configured" };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${creds.projectId}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: target.endpoint,
          notification: { title: msg.title, body: msg.body },
          data: { path: msg.path ?? "/tasks" },
          android: { priority: "HIGH", notification: { tag: msg.tag } },
        },
      }),
    },
  );

  const text = await res.text().catch(() => "");
  const gone = res.status === 404 || text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT");
  return { deviceId: target.id, ok: res.ok, gone, detail: res.ok ? undefined : text.slice(0, 200) };
}

// ══════════════════════════ ENTRY POINT ══════════════════════════

/** Fan out one message to many devices. Never throws — every target reports. */
export async function sendToDevices(targets: PushTarget[], msg: PushMessage): Promise<PushResult[]> {
  return Promise.all(
    targets.map(async (t) => {
      try {
        if (t.transport === "apns") return await sendApns(t, msg);
        if (t.transport === "fcm") return await sendFcm(t, msg);
        return await sendWeb(t, msg);
      } catch (err) {
        return { deviceId: t.id, ok: false, gone: false, detail: String(err).slice(0, 200) };
      }
    }),
  );
}

/** Which transports are actually configured — surfaced in Settings. */
export function pushStatus() {
  return {
    web: Boolean(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT),
    apns: Boolean(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID && process.env.APPLE_TEAM_ID),
    fcm: Boolean(process.env.FCM_SERVICE_ACCOUNT),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  };
}
