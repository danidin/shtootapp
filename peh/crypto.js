const DB_NAME = 'shtoot-crypto';
const STORE_NAME = 'keys';
const KEY_ID = 'keypair';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

function arrayBufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const RSA_PARAMS = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

export async function getStoredKeys() {
  const db = await openDb();
  return dbGet(db, KEY_ID);
}

// Publishes the existing key to the server. Returns null if no key exists yet.
export async function initKeys(userEmail, baseApiUrl) {
  const apiBase = baseApiUrl.replace('/graphql', '');
  const db = await openDb();
  const stored = await dbGet(db, KEY_ID);
  if (!stored) return null;

  // (Re-)publish public key — server may have restarted and lost in-memory map
  await fetch(`${apiBase}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userEmail, publicKey: stored.publicKeyB64 }),
  }).catch(() => {});

  return stored;
}

// Generates a new key pair, stores it, and publishes it. Call only when the user
// explicitly chooses to start fresh on a new device.
export async function createNewKey(userEmail, baseApiUrl) {
  const apiBase = baseApiUrl.replace('/graphql', '');
  const db = await openDb();
  const keyPair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyB64 = arrayBufferToBase64(spki);
  const stored = { privateKey: keyPair.privateKey, publicKeyB64 };
  await dbPut(db, KEY_ID, stored);
  await fetch(`${apiBase}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userEmail, publicKey: publicKeyB64 }),
  }).catch(() => {});
  return stored;
}

async function importPublicKey(b64) {
  return crypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(b64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

async function rsaEncrypt(publicKey, data) {
  return arrayBufferToBase64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, data));
}

export async function encryptForSpace(text, senderEmail, recipientEmail, storedKeys, baseApiUrl) {
  const apiBase = baseApiUrl.replace('/graphql', '');

  const res = await fetch(`${apiBase}/key/${encodeURIComponent(recipientEmail)}`);
  const { publicKey: recipientB64 } = await res.json();
  if (!recipientB64) throw new Error(`No public key found for ${recipientEmail}`);

  const recipientPubKey = await importPublicKey(recipientB64);
  const senderPubKey = await importPublicKey(storedKeys.publicKeyB64);

  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(text));
  const rawAes = await crypto.subtle.exportKey('raw', aesKey);

  const [encryptedKey, senderKey] = await Promise.all([
    rsaEncrypt(recipientPubKey, rawAes),
    rsaEncrypt(senderPubKey, rawAes),
  ]);

  return JSON.stringify({
    e2e: 1,
    key: encryptedKey,
    senderKey,
    iv: arrayBufferToBase64(iv.buffer),
    ct: arrayBufferToBase64(ct),
  });
}

export async function clearStoredKey() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

async function derivePinKey(pin, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function exportKeyBundle(storedKeys) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', storedKeys.privateKey);
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pinKey = await derivePinKey(pin, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, pinKey, pkcs8);
  const bundle = {
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ct: arrayBufferToBase64(ct),
    pub: storedKeys.publicKeyB64,
  };
  return { blob: btoa(JSON.stringify(bundle)), pin };
}

export async function importKeyBundle(blob, pin) {
  const { salt, iv, ct, pub } = JSON.parse(atob(blob));
  const pinKey = await derivePinKey(pin, base64ToArrayBuffer(salt));
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
    pinKey,
    base64ToArrayBuffer(ct)
  );
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
  const stored = { privateKey, publicKeyB64: pub };
  const db = await openDb();
  await dbPut(db, KEY_ID, stored);
  return stored;
}

export async function decryptMessage(encryptedJson, privateKey) {
  const { key, senderKey, iv, ct } = JSON.parse(encryptedJson);

  let rawAes;
  for (const encKey of [key, senderKey]) {
    if (!encKey) continue;
    try {
      rawAes = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        base64ToArrayBuffer(encKey)
      );
      break;
    } catch (_) {}
  }
  if (!rawAes) throw new Error('Could not decrypt AES key');

  const aesKey = await crypto.subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
    aesKey,
    base64ToArrayBuffer(ct)
  );
  return new TextDecoder().decode(plainBuf);
}
