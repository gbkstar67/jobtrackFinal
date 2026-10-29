/**
 * The single chokepoint for every platform branch.
 *
 * Nothing else in the client asks "am I native?" — it asks this. Capacitor is
 * imported lazily so the web bundle never pays for plugins it cannot use, and
 * so the app still runs in a plain browser with none of them installed.
 */
export const isNative = (): boolean =>
  typeof window !== "undefined" && Boolean((window as any).Capacitor?.isNativePlatform?.());

export const nativePlatform = (): "ios" | "android" | "web" =>
  (typeof window !== "undefined" && (window as any).Capacitor?.getPlatform?.()) || "web";

/** Installed to the home screen (iOS standalone or any display-mode app). */
export const isStandalone = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

const TOKEN_KEY = "jobdeck.token";

/**
 * The bearer token for native.
 *
 * On web this is always null and the session cookie does the work. Stored in
 * localStorage rather than a Capacitor Preferences plugin so there is one code
 * path; it never leaves the device and is revoked server-side on sign out.
 */
export function getToken(): string | null {
  if (!isNative()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — the session cookie is the fallback */
  }
}

/** Headers every request carries. Today is sent as a header so query keys stay date-free. */
export function platformHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Jobdeck-Today": new Date().toLocaleDateString("en-CA"),
  };
  if (isNative()) {
    headers["X-Jobdeck-Client"] = "native";
    headers["X-Jobdeck-Platform"] = nativePlatform();
    headers["X-Jobdeck-Build"] = String(__BUILD_NUMBER__);
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Where the API lives.
 *
 * Native cannot use relative URLs — the bundle is served from
 * capacitor://localhost, so "/api/jobs" would resolve against the app itself.
 * Web uses relative URLs so it works on any domain without a rebuild.
 */
export function apiBase(): string {
  if (!isNative()) return "";
  try {
    const override = localStorage.getItem("jobdeck.apiBase");
    if (override) return override;
  } catch {
    /* ignore */
  }
  return __API_BASE__;
}

/** Ask for push permission and register the device. Safe to call repeatedly. */
export async function registerForPush(publicKey: string | null): Promise<boolean> {
  if (isNative()) return registerNativePush();
  return registerWebPush(publicKey);
}

async function registerNativePush(): Promise<boolean> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt") status = await PushNotifications.requestPermissions();
    if (status.receive !== "granted") return false;

    return await new Promise<boolean>((resolve) => {
      // The token arrives asynchronously via an event, not a return value.
      PushNotifications.addListener("registration", async (token: { value: string }) => {
        await postJSON("/api/push/register", {
          transport: nativePlatform() === "ios" ? "apns" : "fcm",
          endpoint: token.value,
        });
        resolve(true);
      });
      PushNotifications.addListener("registrationError", () => resolve(false));
      PushNotifications.register();
      setTimeout(() => resolve(false), 15_000);
    });
  } catch {
    return false;
  }
}

async function registerWebPush(publicKey: string | null): Promise<boolean> {
  if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await postJSON("/api/push/register", {
      transport: "web",
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    });
    return true;
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function postJSON(path: string, body: unknown) {
  await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...platformHeaders() },
    credentials: isNative() ? "omit" : "include",
    body: JSON.stringify(body),
  });
}

/** Native chrome: status bar colour, splash dismissal, hardware back. */
export async function initNativeShell(onBack: () => void) {
  if (!isNative()) return;
  try {
    const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
      import("@capacitor/app"),
    ]);
    await StatusBar.setStyle({ style: Style.Light });
    if (nativePlatform() === "android") await StatusBar.setBackgroundColor({ color: "#ffffff" });
    await SplashScreen.hide();
    App.addListener("backButton", onBack);
  } catch {
    /* a plugin missing must never stop the app booting */
  }
}
