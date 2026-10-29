# Jobdeck — publishing to the App Store and Play Store

Everything in this repo is built. What remains needs accounts, a Mac with
Xcode, and Apple's verification queue — none of which can be done from here.

## 0. Do this first — it is the long pole

Apple organisation enrolment needs a **D-U-N-S number**. D&B takes up to ~5
business days, Apple up to ~2 more, and organisation verification is commonly
1–3 weeks on top. Nothing else here is blocked by code.

1. File the LLC.
2. Request the D-U-N-S at `developer.apple.com/enroll` — the legal name,
   address and phone must match the D&B record **character for character**, or
   verification stalls with no notification.
3. Enrol in the Apple Developer Program ($99/yr) as the organisation.
4. Create a Google Play developer account ($25 one-time). An organisation
   account is exempt from the 12-testers-for-14-days closed-testing rule that
   applies to personal accounts created after 13 Nov 2023 — confirm in the Play
   Console rather than from a guide.

## 1. Install the local toolchain

Not present on this machine:

```
Xcode               App Store, ~17GB. Then: sudo xcode-select -s /Applications/Xcode.app
CocoaPods           sudo gem install cocoapods
Java 21             brew install --cask temurin@21
Android Studio      developer.android.com/studio  (installs the SDK)
```

Then, from the repo root:

```
npx cap sync ios        # runs pod install, which failed earlier without Xcode
npx cap sync android
```

## 2. Build the web bundle the native apps wrap

```
npm run cap:sync
```

`VITE_API_BASE` defaults to `https://trackjobs.up.railway.app`. When the app
moves to its own domain, set it at build time — or change nothing and let the
server tell the app where to go via `GET /api/client-config`, which exists so a
domain move does not need a store release.

## 3. iOS

```
npm run cap:ios          # opens Xcode
```

In Xcode:
- Signing & Capabilities → select the team → add **Push Notifications**
- Set the bundle id to `builds.grant.jobdeck` (or change it in
  `capacitor.config.ts` **before** the first submission — it is immutable after)
- Before a release build, change `aps-environment` in `ios/App/App/App.entitlements`
  from `development` to `production`
- Product → Archive → Distribute

Already configured: display name, camera and photo permission strings,
`UIBackgroundModes: remote-notification`, `ITSAppUsesNonExemptEncryption: false`
(so you are not asked the encryption question every upload), `WKAppBoundDomains`,
and `PrivacyInfo.xcprivacy` — App Store Connect rejects the upload without that
last one.

### APNs
Create a **Key** (not a certificate) in the developer portal with the Apple Push
Notifications service enabled. The `.p8` downloads **once**. Then set on Railway:

```
APNS_KEY_P8        contents of the .p8 (or base64 of it)
APNS_KEY_ID        the 10-character key id
APPLE_TEAM_ID      your team id
APNS_BUNDLE_ID     builds.grant.jobdeck
APNS_ENVIRONMENT   sandbox   (while testing from Xcode; unset for release)
```

A development build's token only works against the sandbox host. The error for
getting this wrong is `BadDeviceToken`, which reads like a bad token rather
than a wrong environment — it is the single biggest time sink in APNs.

## 4. Android

```
npm run cap:android      # opens Android Studio
```

- Firebase console → add an Android app with the same package id → download
  `google-services.json` → place at `android/app/google-services.json`
- Create a service account with the Firebase Messaging role, download its JSON,
  and set `FCM_SERVICE_ACCOUNT` on Railway (raw JSON or base64)
- Build → Generate Signed Bundle → **keep the keystore safe**. Losing it means
  you can never update the listing again.

## 5. Web push (works today, no store needed)

```
npx web-push generate-vapid-keys      # or any VAPID generator
```

```
VAPID_PUBLIC_KEY   the public key
VAPID_PRIVATE_KEY  the private key   — Railway + a password manager, nowhere else
VAPID_SUBJECT      mailto:you@yourdomain   (a bare email is rejected)
```

Rotating these invalidates every existing subscription and every phone has to
re-register from Settings.

## 6. Store listing

- **Name**: Jobdeck
- **Subtitle**: The job board for the trades
- **Category**: Business / Productivity
- **Privacy policy URL**: required by both stores before submission
- **Demo account for review**: both stores require working credentials.
  Run `npm run seed:demo` on the server, then give review
  `demo@jobdeck.app` / the `DEMO_PASSWORD` you set. Re-run with `--reset`
  before each submission so reviewers see a clean, populated board.
- **Screenshots**: 6.7" iPhone and 5.5" are the required iOS sizes. The
  Today screen, the job board, a job with photos, and the calendar are the four
  that show what this is.

## 7. Server environment

Already set: `SESSION_SECRET`, `ADMIN_TOKEN`, `DATABASE_PATH`.
Add as you go: `VAPID_*`, `APNS_*`, `FCM_SERVICE_ACCOUNT`,
and optionally `MIN_CLIENT_BUILD` to force old installs to update.

## 8. Backups

```
railway ssh
npx tsx script/backup.ts
```

Writes a `VACUUM INTO` snapshot to `/data` and keeps the five most recent.
Preferred over the HTTP route — no token to handle and no request timeout.
