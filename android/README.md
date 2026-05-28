# Shtoot for Android

A thin Capacitor wrapper around the existing `peh/` frontend. The same
HTML/JS/CSS that runs in the browser is bundled into the APK and loaded by
the WebView; only the bits that genuinely need native APIs (Google sign-in,
notifications) are swapped out at sync time.

## Layout

```
android/
  package.json              npm scripts + Capacitor deps
  capacitor.config.json     app id, plugins, server scheme
  scripts/
    sync-peh.js             copies peh -> www/ with path + auth + notification rewrites
    templates/
      login.html            native Google sign-in page (replaces peh/login.html)
      native-bridge.js      shims window.Notification with LocalNotifications
  www/                      generated, do not edit by hand
  android/                  generated native Android Studio project
```

## One-time setup

1. Install [Android Studio](https://developer.android.com/studio) (brings the
   SDK + platform tools). Set `ANDROID_HOME` to the SDK path, e.g.
   `~/Android/Sdk`.
2. From this directory: `npm install`.
3. Register an **Android OAuth client** in the same Google Cloud project that
   issued the existing web client (`569147176090-...`):
   - Application type: Android
   - Package name: `net.shtoot.app`
   - SHA-1: see below. Release builds need their own SHA-1 from the release keystore.

   **Getting the debug SHA-1.** `~/.android/debug.keystore` does not exist on
   a fresh machine — it is created the first time Gradle runs a debug build.
   Either build the app once (`npm run build:android`) and then run

   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore \
     -alias androiddebugkey -storepass android -keypass android
   ```

   or, if you want the SHA-1 before building, create the keystore by hand
   with the standard Android debug parameters:

   ```bash
   mkdir -p ~/.android
   keytool -genkey -v -keystore ~/.android/debug.keystore \
     -storepass android -alias androiddebugkey -keypass android \
     -keyalg RSA -keysize 2048 -validity 10000 \
     -dname "CN=Android Debug,O=Android,C=US"
   ```

   The `SHA1:` line in the output is what Google Cloud Console wants.

   The Android client doesn't get a client ID you paste anywhere — its job is
   to authorise the package/SHA-1 combination. The `serverClientId` in
   `capacitor.config.json` stays pointed at the existing **web** client so the
   ID token we ship to ozen matches the one the browser version produces.
4. Confirm ozen accepts the audience `569147176090-4t128vkfk1ki84qbf272ghjifbknvaas.apps.googleusercontent.com` from Android — it already does for the web app, so nothing to change.

## Day-to-day

```bash
# After editing anything in ../peh
npm run sync                  # rebuild www/ and copy into the native project

# Open in Android Studio for debugging / running on a device
npm run open

# Headless debug build (needs ANDROID_HOME)
npm run build:android         # -> android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run sync` is the important one — every change in `../peh` needs it to
land in the APK. CI should run it before `gradlew assembleRelease`.

## How parity with peh is preserved

`scripts/sync-peh.js` is the whole adaptation layer. It:

- Rewrites absolute `/peh/...` paths to relative (`./...`) so the WebView can
  load them from `assets/public`.
- Replaces `peh/login.html` (which uses `accounts.google.com/gsi/client` —
  blocked inside Android WebViews) with a page that calls
  `@codetrix-studio/capacitor-google-auth`. The resulting Google ID token is
  written to `localStorage` under the same `jwt` key the rest of peh reads,
  so `shtoot-peh.js` etc. need no changes.
- Drops the service-worker registration and shims `window.Notification` via
  `native-bridge.js` so existing notification calls in `shtoot-peh.js` route
  through `@capacitor/local-notifications`.

Everything else — GraphQL over HTTPS, WebSocket subscriptions, IndexedDB key
storage, the Web Crypto E2E flow, space selection, key import/export — runs
unchanged inside the WebView.

### Important quirk: `server_client_id` lives in strings.xml

The `@codetrix-studio/capacitor-google-auth` plugin **ignores**
`serverClientId` in `capacitor.config.json` on Android — it reads a string
resource named `server_client_id` from
`android/app/src/main/res/values/strings.xml`. Without it, sign-in fails
with `code: 10` (DEVELOPER_ERROR) and the logcat shows
`Invalid audience value: server:client_id:Your Web Client Key`. The web
OAuth client ID (not the Android one) is what belongs there. The crypto.subtle and IndexedDB APIs are
available in Android WebView 60+, which covers every supported device.

## Known caveats

- **First run after `npm install` on a fresh checkout**: `www/` doesn't exist
  until you run `npm run sync-peh`. The Capacitor CLI will complain if you
  try to `cap sync` before that.
- **Release signing**: the generated project ships with debug signing only.
  Add a release keystore and Gradle signing config before publishing, then
  register that keystore's SHA-1 as a second Android OAuth client.
- **Network security**: the WebView talks to `https://api.shtoot.net` only.
  If you ever need to test against `http://localhost:4000` from a device,
  flip `cleartext: true` in `capacitor.config.json` and add a network
  security config; don't ship that build.
- **WebSocket disconnects on background**: Android will suspend the WebView
  when the app is backgrounded for a while. Reconnect logic in
  `shtoot-peh.js` handles this on resume, but missed messages while suspended
  won't trigger a notification — that needs FCM, which is out of scope here.
