# Shtoot on Google Play — Launch Plan

Goal: ship `net.shtoot.app` (the Capacitor wrapper in `android/`) to the Google Play Store, starting with a closed test and ending in production.

Ordered by dependency. Phases 1–3 can run in parallel; 4 needs 1–3; 5 needs 4.

---

## Phase 0 — Developer account (start now, has lead time)

- [ ] Register a Play Console developer account ($25 one-time).
  - **Personal account:** identity verification. Accounts created after Nov 2023 must run a **closed test with ≥12 testers opted in for 14 consecutive days** before they can apply for production access. Start recruiting testers now.
  - **Organization account:** needs a D-U-N-S number (can take weeks), but skips the 12-tester rule.
- [ ] Decide the public developer name, contact email and website (`https://shtoot.net`). Play shows these on the listing.

## Phase 1 — Build & platform blockers

These stop the upload from being accepted, or stop the app from working once installed from Play.

### 1.1 Target SDK
`variables.gradle` targets **API 34**. Play requires new apps to target the API level released in roughly the last year. As of late 2026 that is **API 36** (check the current requirement in Play Console → Policy status before starting).
- [ ] Upgrade Capacitor 6 → 8 (Capacitor 8 targets API 36; Capacitor 7 targets 35). Use `npx cap migrate` for each major version, then re-run `npm run sync`.
- [ ] **Edge-to-edge** is enforced from API 35: the WebView will draw under the status and navigation bars. Add safe-area handling (`env(safe-area-inset-*)` in the peh CSS through `sync-peh.js`, or the `@capacitor/status-bar` overlay config). Test the header and the compose bar on a gesture-nav device.
- [ ] Bump `firebase-bom`, `androidx.*` and `minSdkVersion` to whatever Capacitor 8 requires (it's well above the current 22).

### 1.2 Google sign-in plugin
`@codetrix-studio/capacitor-google-auth` is unmaintained, pinned to an `rc`, and built on the deprecated `GoogleSignIn` API (replaced by Credential Manager). It probably won't build against Capacitor 7 or 8.
- [ ] Replace it with a maintained plugin built on Credential Manager (e.g. `@capgo/capacitor-social-login`). Keep the contract that `templates/login.html` writes the Google **ID token** for the web client audience into `localStorage.jwt`, so ozen and peh need no changes.
- [ ] Keep the `server_client_id` / strings.xml quirk in mind; the new plugin may configure this differently.

### 1.3 Release signing and Play App Signing (most likely launch-day breakage)
Play re-signs the app with **its own app signing key**. Google sign-in and Firebase check the SHA-1 of the installed APK, so a build installed from Play will fail to sign in (DEVELOPER_ERROR / code 10) unless that key is registered.
- [ ] Generate an **upload keystore** (`keytool -genkey ... -alias upload`). Store it and its passwords outside the repo, with an offline backup.
- [ ] Add a `signingConfigs.release` to `app/build.gradle` that reads from `~/.gradle/gradle.properties` or env vars. Never commit the keystore or passwords.
- [ ] Enrol in Play App Signing (the default) when creating the app.
- [ ] Register **three** SHA-1s (debug, upload, Play app signing; the last one is under Play Console → Setup → App signing):
  - Google Cloud Console → Android OAuth client(s) for `net.shtoot.app`
  - Firebase project → Android app → SHA certificate fingerprints
- [ ] Re-download `google-services.json` after adding the fingerprints.

### 1.4 Release build
- [ ] Add `"build:release": "npm run sync && cd android && ./gradlew bundleRelease"` to `android/package.json`. Play only accepts **AAB** (`app-release.aab`).
- [ ] Versioning: `versionCode` must increase on every upload. Derive it from a single source (e.g. `package.json` version or a git commit count) instead of hand-editing it.
- [ ] Optional: turn on `minifyEnabled true` with keep rules for the Capacitor, Firebase and `net.shtoot.app.*` plugin classes. Not required for launch, so leave it off unless the build size matters.

### 1.5 Backup and E2E keys
The manifest has `android:allowBackup="true"`. Auto Backup will copy the `EncryptedSharedPreferences` file to a new device, but the Keystore master key won't come with it. On the new device the restored prefs can't be decrypted (it crashes or acts as if the key is missing).
- [ ] Set `android:allowBackup="false"`, or add `dataExtractionRules` / `fullBackupContent` that exclude the crypto prefs file. Key migration already goes through export blob + PIN, which is the intended path.

## Phase 2 — Policy blockers (Shtoot is a UGC / messaging app)

Play's User-Generated Content policy and account-deletion requirement apply. **None of this exists yet** (the schema has no delete, block or report mutations).

### 2.1 Account deletion (required)
Apps that create accounts must offer deletion **in the app** *and* through a **web URL** that works without installing the app. Users "create" an account on first Google sign-in (`createUser`).
- [ ] ozen: `deleteAccount` mutation (authenticated by JWT) that publishes a `user-deleted` Kafka event.
- [ ] Consumers drop the user, their public key (`publicKeys`) and FCM tokens, and their shtoots.
- [ ] **Kafka retention is infinite** (`KAFKA_LOG_RETENTION_MS: -1`), so deleted data would come back on replay. Pick one:
  - (a) consumers keep a deleted-users set and skip earlier events for those users during replay (smallest change), or
  - (b) switch the user/shtoot topics to log compaction with tombstones.
  
  The deletion has to survive an ozen restart either way.
- [ ] peh: "Delete account…" in the profile sidebar (`shtoot-user.js`). Confirm, call the mutation, then clear the local key (`clearStoredKey`) and sign out.
- [ ] Web URL: a page on shtoot.net (it can be peh's own flow behind Google sign-in) that the Data Safety form will link to.

### 2.2 UGC safeguards (required)
- [ ] **Terms of use / acceptable use**: a page on shtoot.net that users accept at first sign-in (one line plus a link on the login page is enough).
- [ ] **Report** a shtoot or user. Minimum: a `reportShtoot(ID, reason)` mutation that emails or logs to you. E2E 1:1 content can't be read server-side, so the report should include the plaintext the reporter chose to send.
- [ ] **Block** a user: hide their shtoots client-side and stop delivering their 1:1 messages and pushes to the blocker.
- [ ] A moderation path: a way for you to act on reports (delete a shtoot, ban a user). An admin-only mutation is enough for v1.

### 2.3 Privacy policy (required)
- [ ] Publish it at e.g. `https://shtoot.net/privacy`. It must cover: Google account email and display name, message content, public keys, FCM tokens, how long data is kept (currently forever, so say so or change it), deletion, and the fact that 1:1 messages are end-to-end encrypted and the server can't read them.
- [ ] Link it in the app (profile sidebar or login page) and in Play Console.

## Phase 3 — Store listing assets

- [ ] App icon 512×512 PNG. Check that `mipmap-*` holds the real Shtoot icon and not the Capacitor default.
- [ ] Feature graphic 1024×500.
- [ ] Phone screenshots (2–8, at least 1080px on the short side): the feed, a 1:1 encrypted chat with the 🔒, the space selector, and a notification.
- [ ] Short description (≤80 chars) and full description (≤4000).
- [ ] Category: Communication. Contact email. Website.

## Phase 4 — Play Console app content declarations

- [ ] **Data safety form**:
  - Collected: email address, name, messages, device or other IDs (FCM token).
  - Purpose: app functionality.
  - Not shared with third parties, apart from processors such as Firebase.
  - Encrypted in transit: yes.
  - Users can request deletion: yes, with the URL from 2.1.
- [ ] **Content rating** (IARC questionnaire): users interact and share content, so expect Teen or a similar rating.
- [ ] **Target audience**: 13+ or 18+. Avoid choosing under-13, because that triggers Families policy.
- [ ] **Ads**: none.
- [ ] **App access**: Play reviewers need to sign in. Provide a test Google account (and explain the key-setup overlay: choose "This is my first device").
- [ ] **Notification permission** (`POST_NOTIFICATIONS`) needs no extra declaration. No sensitive permissions are used.
- [ ] **Government / financial / health**: N/A.

## Phase 5 — Testing tracks → production

1. **Internal testing**: up to 100 testers, almost no review. Upload the first AAB here and verify on a real device **installed from Play**:
   - Google sign-in works (this proves the Play signing SHA-1 is registered)
   - FCM push arrives with the app killed, including E2E 1:1 decryption in `ShtootMessagingService`
   - Key setup overlay, export/import
   - Edge-to-edge layout
   - Delete account end to end, then restart ozen and confirm the data stays gone
2. **Closed testing**: personal accounts need ≥12 opted-in testers for 14 consecutive days. Ask testers to actually use the app; Google asks about tester engagement in the production application.
3. **Apply for production access** (personal accounts only). The form covers the testing done, the feedback received, and readiness.
4. **Production**: use a staged rollout (e.g. 20% → 100%) and watch Play Console → Android vitals for crashes and ANRs.

## Ongoing

- Every peh change needs `npm run sync` and a new AAB with a higher `versionCode`. ozen and the web frontend can still deploy on their own, but ozen must stay **backward compatible** with older installed app versions, since users don't update right away.
- The target-SDK requirement moves every August, so plan one Capacitor/targetSdk bump per year.
- Keep the upload keystore safe. If it's lost, a reset goes through Play support; the app signing key held by Google is unaffected.

## Open decisions

1. Personal or organization developer account (decides whether the 12-tester / 14-day gate applies).
2. Kafka deletion strategy: skip-on-replay set (a) or compaction with tombstones (b).
3. Data retention: keep "forever" and disclose it, or add a retention limit.
4. Minimum age: 13+ or 18+.
