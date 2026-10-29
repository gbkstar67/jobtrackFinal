import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native shell wraps the existing Vite build — `dist/public` is what the
 * Dockerfile already produces and what Railway already serves, so web and
 * native ship the same bundle and never drift.
 *
 * The app talks to the Railway server over HTTPS; nothing is served from a
 * local dev server in a release build. `server.androidScheme: "https"` is what
 * makes Android's origin `https://localhost` rather than `http://localhost`,
 * which keeps it out of mixed-content and insecure-origin restrictions.
 */
const config: CapacitorConfig = {
  appId: "builds.grant.jobdeck",
  appName: "Jobdeck",
  webDir: "dist/public",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
    // Both native origins are allowlisted server-side in server/index.ts.
    cleartext: false,
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#ffffff",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    PushNotifications: {
      // Prompting on first launch gets denied; the app asks from Settings,
      // after the user has seen what a reminder is for.
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
