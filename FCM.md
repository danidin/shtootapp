# Android FCM push notifications with native E2E decryption

## Context

When the Shtoot Android app is backgrounded, Android suspends the WebView. The WebSocket dies, no JS runs, and the existing `LocalNotifications` shim (`android/scripts/templates/native-bridge.js`) never fires — so users get nothing for messages received while the app is closed. This is already called out in `android/README.md:121-124` as needing FCM.

We're implementing the **full WhatsApp pattern**: ozen pushes via FCM, Android wakes a native handler that decrypts the message (including E2E 1:1 messages) and posts a system notification with real content. To make native-side E2E decryption possible, the RSA private key has to move out of IndexedDB (WebView-only) into Android-native storage that both the WebView (via a Capacitor plugin) and the native `FirebaseMessagingService` can read.

Existing-user impact: the README already warns that pre-migration keys are non-extractable and "Export key…" offers to regenerate. We'll lean on that — Android users with an existing IndexedDB key get prompted to either re-import via PIN from another device or regenerate. No silent migration.

## Architecture

```
ozen ── FCM data payload (envelope JSON) ──► Play Services ──► Shtoot FCM handler (Kotlin)
                                                                       │
                                                                       ▼
                                                         EncryptedSharedPreferences (private key)
                                                                       │
                                                                       ▼
                                                         RSA-OAEP + AES-GCM decrypt
                                                                       │
                                                                       ▼
                                                         NotificationManagerCompat.notify(...)

WebView (peh) ──► Capacitor plugin ShtootCrypto ──► same EncryptedSharedPreferences
```

The private key lives in `EncryptedSharedPreferences` (master key in Android Keystore). Both the FCM handler and the Capacitor plugin read from it. The WebView never sees raw private key bytes — it gets a sentinel like `{nativeKey: true, publicKeyB64: '...'}` and routes decrypt/encrypt operations through the plugin.

## Manual setup (user-side, documented in updated README)

1. Create Firebase project at https://console.firebase.google.com.
2. Add Android app: package `net.shtoot.app`, register debug SHA-1 (from `~/.android/debug.keystore`) and release SHA-1.
3. Download `google-services.json` → `android/android/app/google-services.json` (the build.gradle already conditionally applies the plugin if this file exists — `android/android/app/build.gradle:47-54`).
4. Project Settings → Service accounts → "Generate new private key" → save JSON. Mount into the ozen container; set env `FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/sa.json`. Add to ozen's `.gitignore`.
5. Enable Cloud Messaging API in Google Cloud Console for the project.

## Implementation

### 1. Native Capacitor plugin: `ShtootCrypto`

New plugin under `android/android/app/src/main/java/net/shtoot/app/cryptoplugin/`:

- `ShtootCryptoPlugin.java` — Capacitor `@CapacitorPlugin(name="ShtootCrypto")` with methods:
  - `hasKey({userID})` → `{has: boolean, publicKeyB64?: string}`
  - `createKey({userID})` → `{publicKeyB64}` — RSA-2048 keypair, store private as PKCS8 bytes in EncryptedSharedPreferences under `key-<userID>-priv`, public SPKI under `key-<userID>-pub`.
  - `decryptEnvelope({userID, envelope})` → `{plaintext}` — RSA-OAEP unwrap AES key, AES-GCM decrypt, return UTF-8 string. Handles both `key` and `senderKey` fields like `peh/crypto.js:195-219`.
  - `encryptForRecipients({userID, plaintext, recipientPubKeysB64})` → `{envelope}` — mirrors `peh/crypto.js:106-134`.
  - `exportBundle({userID})` → `{blob, pin}` — same PBKDF2-PIN format as `peh/crypto.js:159-173`.
  - `importBundle({userID, blob, pin})` → `{publicKeyB64}` — mirrors `peh/crypto.js:175-193`.
  - `clearKey({userID})` → `{ok: true}`
- `CryptoStore.kt` — helper for EncryptedSharedPreferences access, used by both the plugin and `ShtootMessagingService`. Master key via `MasterKey.Builder(...).setKeyScheme(AES256_GCM)`.
- Register plugin in `MainActivity.java`:
  ```java
  registerPlugin(ShtootCryptoPlugin.class);
  ```

### 2. JS replacement for `crypto.js`

New file `android/scripts/templates/native-crypto.js` exporting the **same names** as `peh/crypto.js` so `shtoot-peh.js` and `shtoot-user.js` need no changes:

- `getStoredKeys(userID)` → calls `ShtootCrypto.hasKey({userID})`, returns `{privateKey: {nativeKey: true}, publicKeyB64}` or `null`.
- `initKeys(userID, baseApiUrl)` → if `hasKey`, POST publicKey to `/key`, return stored.
- `createNewKey(userID, baseApiUrl)` → `ShtootCrypto.createKey`, POST publicKey, return stored.
- `encryptForSpace(text, senderEmail, recipientEmail, storedKeys, baseApiUrl)` → fetch `/key/<recipient>`, call `ShtootCrypto.encryptForRecipients` with `[recipientPub, senderPub]`.
- `decryptMessage(encryptedJson, privateKey)` → `ShtootCrypto.decryptEnvelope`. The `privateKey` arg is ignored on Android (it's the `{nativeKey: true}` sentinel) — the userID is read from a module-level cache set during `initKeys`/`createNewKey`.
- `exportKeyBundle`, `importKeyBundle`, `clearStoredKey` → plugin pass-throughs.

`sync-peh.js` change: instead of copying `peh/crypto.js`, copy `templates/native-crypto.js` to `www/crypto.js` (same filename so existing imports resolve unchanged). Add to `filesToTransform` skip list.

### 3. FCM receiver: `ShtootMessagingService.kt`

New service in `android/android/app/src/main/java/net/shtoot/app/fcm/`:

- Subclass `FirebaseMessagingService`.
- `onMessageReceived(message)`:
  - Read `data` map: `{type: "shtoot", shtootId, userID, senderID, space, payload}` where `payload` is either plaintext (non-E2E) or the JSON envelope (E2E).
  - Read `targetUser` from data — the recipient's email (same device may have multiple accounts, see `keypair-<userID>` scoping in `CLAUDE.md`).
  - If `payload` starts with `{"e2e":1`, call `CryptoStore.decrypt(targetUser, payload)` to get plaintext; otherwise use as-is.
  - Build notification: title = `senderID`, body = plaintext, intent opens MainActivity. Use `NotificationCompat.Builder` with channel `shtoot-messages`. Tag = shtootId so duplicates collapse.
  - On decrypt failure, fall back to body "New encrypted message".
- `onNewToken(token)`: broadcast via `LocalBroadcastManager` to a JS-bound listener so the WebView can forward to ozen. Also persist last token in SharedPreferences in case the broadcast misses.
- Register in `AndroidManifest.xml`:
  ```xml
  <service android:name=".fcm.ShtootMessagingService" android:exported="false">
    <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
  </service>
  ```
- Create notification channel at app start (MainActivity `onCreate`).

### 4. Capacitor `@capacitor/push-notifications` wiring

- Add `@capacitor/push-notifications` to `android/package.json` deps.
- In `native-bridge.js` (post-shim), after JWT is in localStorage:
  - `PushNotifications.requestPermissions()` → `PushNotifications.register()`.
  - Listener `registration` → call new GraphQL mutation `registerFcmToken(token: String!)`.
  - Listener `registrationError` → console.error.
  - Listener `pushNotificationReceived` (foreground) → no-op for now; FCM payload's `notification` field is absent (data-only), and the existing WebSocket flow handles foreground UI updates.
  - Listener `pushNotificationActionPerformed` → if `data.shtootId`, scroll to that message after load.

### 5. Ozen backend

Files: `ozen/index.ts`, `ozen/typeDefs.ts`, `ozen/resolvers.ts`, `ozen/partzoof-producer.ts`, `ozen/partzoof-consumer.ts`, `ozen/package.json`.

- Add `firebase-admin` dep.
- New module `ozen/fcm.ts`:
  - `initFcm()` — reads `FIREBASE_SERVICE_ACCOUNT_PATH`, calls `admin.initializeApp({credential: cert(...)})`.
  - `sendToTokens(tokens: string[], data: Record<string,string>)` — uses `admin.messaging().sendEachForMulticast` with `priority: 'high'`, `android: {priority: 'high'}`. Data-only message (no `notification` field) so the FCM handler always runs.
  - On per-token errors with code `messaging/registration-token-not-registered` or `messaging/invalid-argument`, emit `fcm-token-removed` Kafka event to purge.
- In-memory `fcmTokens: Map<email, Set<token>>` exported from `partzoof-consumer.ts`, populated from new Kafka events (mirrors `publicKeys` pattern at `ozen/partzoof-consumer.ts:17`).
- New Kafka event keys in `partzoof-producer.ts`: `fcm-token-registered` (value `{email, token}`) and `fcm-token-removed`. Handled in consumer like `key-created` is at `ozen/partzoof-consumer.ts:30-40`.
- New GraphQL mutations in `typeDefs.ts`:
  ```graphql
  registerFcmToken(token: String!): Boolean
  unregisterFcmToken(token: String!): Boolean
  ```
  Resolvers use `context.user.email` for the binding; emit Kafka event.
- Push trigger: in `partzoof-consumer.ts` `shtoot-said` handler (where `eventBus.emit(SHTOOT_ADDED, ...)` happens at line 53), after emitting, look up recipient tokens:
  - For shtoots with no `space`: skip push (broadcast — too noisy; the WebSocket handles those for online users).
  - For shtoots with `space`: split `space` on the existing delimiter (email addresses), collect tokens for each member except the sender, call `sendToTokens` with:
    ```
    {
      type: "shtoot",
      shtootId, senderID, space,
      targetUser: <recipient email>,
      payload: shtoot.text   // either plaintext or {"e2e":1,...} JSON
    }
    ```
  - One FCM call per recipient (so `targetUser` can be set correctly for multi-account devices).

### 6. Migration UX for existing Android users

In `native-crypto.js` `initKeys` and the setup overlay in `shtoot-peh.js:143-151`:
- If `hasKey` returns false but `localStorage` indicates the user previously had a key on this device (we'll set a `had-indexeddb-key` flag during migration check), show a message in the existing setup overlay: "Keys must be re-imported on this device after upgrade — use Import on another device's Export, or generate a new key (old messages become unreadable)."
- No automatic IndexedDB → native migration: existing keys are non-extractable per the README.

### 7. Documentation

Update `android/README.md`:
- Replace the "WebSocket disconnects on background" caveat with the new FCM flow.
- New section "Push notifications (FCM)" describing the manual setup steps above.
- Note the migration expectation for users with pre-FCM keys.

Update `CLAUDE.md` E2E section to mention that Android stores private keys in EncryptedSharedPreferences instead of IndexedDB, and the FCM handler decrypts natively.

## Critical files (to be modified / created)

**New files:**
- `android/android/app/src/main/java/net/shtoot/app/cryptoplugin/ShtootCryptoPlugin.java`
- `android/android/app/src/main/java/net/shtoot/app/cryptoplugin/CryptoStore.kt`
- `android/android/app/src/main/java/net/shtoot/app/fcm/ShtootMessagingService.kt`
- `android/scripts/templates/native-crypto.js`
- `ozen/fcm.ts`

**Modified:**
- `android/android/app/src/main/java/net/shtoot/app/MainActivity.java` — register plugin, create notification channel.
- `android/android/app/src/main/AndroidManifest.xml` — declare FCM service + notification permission.
- `android/android/app/build.gradle` — add EncryptedSharedPreferences + Firebase Messaging deps.
- `android/package.json` — add `@capacitor/push-notifications`.
- `android/scripts/sync-peh.js` — copy `native-crypto.js` to `www/crypto.js`; extend `native-bridge.js` to wire push registration.
- `android/scripts/templates/native-bridge.js` — push setup + token forwarding to ozen.
- `ozen/package.json` — `firebase-admin`.
- `ozen/typeDefs.ts` — new mutations.
- `ozen/resolvers.ts` — register/unregister resolvers; emit Kafka events.
- `ozen/partzoof-producer.ts` — `sendFcmTokenRegisteredEvent`, `sendFcmTokenRemovedEvent`.
- `ozen/partzoof-consumer.ts` — handle new event keys; on `shtoot-said`, trigger FCM.
- `ozen/index.ts` — `initFcm()` at startup.
- `android/README.md`, `CLAUDE.md` — docs.

## Verification

End-to-end test (requires Firebase setup done):

1. **Build & deploy**:
   - `cd android && npm install && npm run build:android` — confirm Gradle picks up `google-services.json` and `@capacitor/push-notifications`.
   - Install APK on a physical Android device (FCM doesn't work reliably on emulators without Play Services).
   - Start ozen with `FIREBASE_SERVICE_ACCOUNT_PATH=...`; confirm startup log shows `firebase-admin` init.

2. **Token registration**:
   - Sign in on device. In ozen logs, confirm `fcm-token-registered` Kafka event for the user.
   - Kill and relaunch the app — token should re-register (FCM may issue a new token).

3. **Key setup**:
   - On first launch after upgrade, the setup overlay should appear. Choose "first device" → confirm `ShtootCrypto.createKey` is called (check via `adb logcat`), public key POSTed to `/key/<email>`.
   - In a second account on another device, send a 1:1 message to the first user's email. Expected: encrypted envelope arrives.

4. **Foreground notification**:
   - Send a public shtoot from another client while the Android app is open. WebSocket flow displays it in-app; no FCM notification should be shown (avoid duplicates — `ShtootMessagingService` checks app foreground state via `ProcessLifecycleOwner`; if Android app is foreground, skip `notify`).

5. **Background notification, non-E2E**:
   - Background the Android app for ~1 minute (so WebView is suspended). Have another client post a public shtoot in a space the user is in. Expected: system notification appears with sender + plaintext body. Tap → opens app and scrolls to that shtoot.

6. **Background notification, E2E**:
   - Background app. From another device, send a 1:1 encrypted message to the user. Expected: system notification with sender + decrypted plaintext. Verify via logcat that `CryptoStore.decrypt` ran in `ShtootMessagingService`, not in JS.

7. **App-killed notification**:
   - Force-stop the Android app. Send a 1:1 encrypted message. Expected: notification appears (FCM data messages start the service even when the app process is dead).

8. **Token cleanup**:
   - Uninstall the app. From ozen, attempt a push — confirm `messaging/registration-token-not-registered` error is logged and `fcm-token-removed` Kafka event fires.

9. **Key migration UX**:
   - On a device with an old IndexedDB key (pre-upgrade), reinstall the new build. Confirm the setup overlay appears with the migration explanation; importing via PIN from another device's export should succeed and subsequent E2E messages decrypt natively.

10. **Browser (peh) regression**:
    - Open the web app — confirm Web Crypto / IndexedDB path is unchanged (`peh/crypto.js` is untouched; the rewrite happens only in `sync-peh.js`).
