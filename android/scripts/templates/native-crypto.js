/**
 * Android replacement for peh/crypto.js.
 *
 * Exports the same names as peh/crypto.js so shtoot-peh.js and shtoot-user.js
 * need no changes, but routes every crypto operation through the
 * `ShtootCrypto` Capacitor plugin (backed by EncryptedSharedPreferences).
 *
 * The plugin keeps the RSA private key in native storage so the
 * FirebaseMessagingService can decrypt E2E 1:1 messages from a killed app —
 * IndexedDB lives inside the WebView origin and is unreachable from the
 * native FCM handler.
 *
 * Conceptual mapping vs peh/crypto.js:
 *   - `privateKey` on web is a Web Crypto CryptoKey. Here it's an opaque
 *     sentinel `{ nativeKey: true, userID }` — never used for direct crypto
 *     by the JS layer.
 *   - `storedKeys.publicKeyB64` carries the SPKI public key for use in
 *     fingerprinting / publishing.
 */

const Plugins = window.Capacitor && window.Capacitor.Plugins;
const ShtootCrypto = Plugins && Plugins.ShtootCrypto;

// Cached so decryptMessage(encryptedJson, privateKey) — whose signature doesn't
// carry userID — can route to the right native key. Set during initKeys /
// createNewKey / importKeyBundle.
let activeUserID = null;

// Per-userID cache of the sentinel object (or null if we've checked and there
// is no key). shtoot-peh.js calls getStoredKeys() once per incoming message
// while replaying history, which would otherwise translate to one plugin
// round-trip + EncryptedSharedPreferences hit per shtoot.
const keyCache = new Map();

function apiBaseFrom(url) {
  return url.replace('/graphql', '');
}

async function publishPublicKey(userID, apiBase, publicKeyB64) {
  try {
    await fetch(`${apiBase}/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userID, publicKey: publicKeyB64 }),
    });
  } catch (_) {}
}

function sentinel(userID, publicKeyB64) {
  return {
    userID,
    publicKeyB64,
    privateKey: { nativeKey: true, userID },
  };
}

export async function getStoredKeys(userID) {
  if (!ShtootCrypto) return null;
  if (keyCache.has(userID)) return keyCache.get(userID);
  const res = await ShtootCrypto.hasKey({ userID });
  if (!res || !res.has) {
    keyCache.set(userID, null);
    return null;
  }
  activeUserID = userID;
  const s = sentinel(userID, res.publicKeyB64);
  keyCache.set(userID, s);
  return s;
}

export async function initKeys(userID, baseApiUrl) {
  if (!ShtootCrypto) return null;
  const apiBase = apiBaseFrom(baseApiUrl);
  const stored = await getStoredKeys(userID);
  if (!stored) return null;
  await publishPublicKey(userID, apiBase, stored.publicKeyB64);
  return stored;
}

export async function createNewKey(userID, baseApiUrl) {
  const apiBase = apiBaseFrom(baseApiUrl);
  const { publicKeyB64 } = await ShtootCrypto.createKey({ userID });
  activeUserID = userID;
  const s = sentinel(userID, publicKeyB64);
  keyCache.set(userID, s);
  await publishPublicKey(userID, apiBase, publicKeyB64);
  return s;
}

export async function encryptForSpace(text, senderEmail, recipientEmail, storedKeys, baseApiUrl) {
  const apiBase = apiBaseFrom(baseApiUrl);
  const res = await fetch(`${apiBase}/key/${encodeURIComponent(recipientEmail)}`);
  const { publicKey: recipientB64 } = await res.json();
  if (!recipientB64) throw new Error(`No public key found for ${recipientEmail}`);

  const { envelope } = await ShtootCrypto.encryptForRecipients({
    userID: senderEmail,
    plaintext: text,
    recipientPubB64: recipientB64,
    senderPubB64: storedKeys.publicKeyB64,
  });
  return envelope;
}

export async function decryptMessage(encryptedJson, _privateKey) {
  const userID = activeUserID || (_privateKey && _privateKey.userID);
  if (!userID) throw new Error('No active userID for decrypt');
  const { plaintext } = await ShtootCrypto.decryptEnvelope({ userID, envelope: encryptedJson });
  return plaintext;
}

export async function clearStoredKey(userID) {
  if (!ShtootCrypto) return;
  await ShtootCrypto.clearKey({ userID });
  keyCache.delete(userID);
  if (activeUserID === userID) activeUserID = null;
}

export async function exportKeyBundle(storedKeys) {
  const userID = storedKeys && storedKeys.userID;
  if (!userID) throw new Error('storedKeys.userID required for export');
  const { blob, pin } = await ShtootCrypto.exportBundle({ userID });
  return { blob, pin };
}

export async function importKeyBundle(blob, pin, userID) {
  const { publicKeyB64 } = await ShtootCrypto.importBundle({ userID, blob, pin });
  activeUserID = userID;
  const s = sentinel(userID, publicKeyB64);
  keyCache.set(userID, s);
  return s;
}
