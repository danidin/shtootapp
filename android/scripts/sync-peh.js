#!/usr/bin/env node
/**
 * Copies peh/ into www/ for the Capacitor WebView.
 *
 * Differences vs the web build:
 *   - paths are rewritten from `/peh/...` to relative (`./...`)
 *   - login.html is replaced with an Android-native sign-in page that calls
 *     @codetrix-studio/capacitor-google-auth and stores the id token in
 *     localStorage under `jwt` (the existing key the rest of peh reads).
 *   - shtoot-peh.js is patched so notifications go through
 *     @capacitor/local-notifications instead of window.Notification /
 *     service worker showNotification.
 *   - the empty service worker is dropped — Capacitor doesn't need it and
 *     the WebView's notification permission is brokered by the plugin.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PEH = path.resolve(ROOT, '..', 'peh');
const OUT = path.resolve(ROOT, 'www');

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  for (const entry of fs.readdirSync(p)) {
    const full = path.join(p, entry);
    if (fs.statSync(full).isDirectory()) rimraf(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(p);
}

function rewritePaths(src) {
  return src
    // Redirects back to the SPA — must run before the generic `/peh/` rewrite
    // below, which would otherwise turn `/peh/login` into `./login`.
    .replace(/window\.location\s*=\s*['"]\/peh\/login['"]/g, "window.location = './login.html'")
    .replace(/window\.location\s*=\s*['"]\/peh['"]/g, "window.location = './index.html'")
    // Script and resource references
    .replace(/(["'])\/peh\/([^"']+)\1/g, '$1./$2$1')
    // Drop the service worker registration entirely — Android handles notifications natively
    .replace(/this\.swRegistration\s*=\s*await\s+navigator\.serviceWorker\.register\(['"][^'"]+['"]\);?/g, 'this.swRegistration = null;');
}

function copyFile(src, dest, transform) {
  const content = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(dest, transform ? transform(content) : content);
}

rimraf(OUT);
fs.mkdirSync(OUT, { recursive: true });

// Copy and rewrite the JS modules + index.html. `crypto.js` is intentionally
// excluded — it's replaced wholesale by templates/native-crypto.js, which
// routes through the ShtootCrypto Capacitor plugin so the FCM service can
// share the private key with the WebView.
const filesToTransform = [
  'index.html',
  'shtoot-peh.js',
  'shtoot-user.js',
  'shtoot-space-selector.js',
  'shtoot-add-contact.js',
];

for (const file of filesToTransform) {
  copyFile(path.join(PEH, file), path.join(OUT, file), rewritePaths);
}

// Replace the script tags in index.html — they need .html-relative paths and we
// inject the native-notification shim before shtoot-peh.js loads.
let indexHtml = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
indexHtml = indexHtml.replace(
  '<script type="module" src="./shtoot-peh.js"></script>',
  '<script type="module" src="./native-bridge.js"></script>\n  <script type="module" src="./shtoot-peh.js"></script>',
);
fs.writeFileSync(path.join(OUT, 'index.html'), indexHtml);

// Write the Android-specific login.html, native bridge, and crypto shim from
// templates in scripts/templates. `native-crypto.js` is copied to `crypto.js`
// in the output so existing `./crypto.js` imports in shtoot-peh.js and
// shtoot-user.js resolve to the native-backed implementation unchanged.
const TEMPLATES = path.join(__dirname, 'templates');
fs.copyFileSync(path.join(TEMPLATES, 'login.html'), path.join(OUT, 'login.html'));
fs.copyFileSync(path.join(TEMPLATES, 'native-bridge.js'), path.join(OUT, 'native-bridge.js'));
fs.copyFileSync(path.join(TEMPLATES, 'native-crypto.js'), path.join(OUT, 'crypto.js'));

console.log('Synced peh -> www/');
