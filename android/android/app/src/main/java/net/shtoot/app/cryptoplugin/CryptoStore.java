package net.shtoot.app.cryptoplugin;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/**
 * Shared helper around EncryptedSharedPreferences for the Shtoot E2E private key.
 * Used by both ShtootCryptoPlugin (WebView side) and ShtootMessagingService (FCM side).
 */
public class CryptoStore {
    private static final String PREF_FILE = "shtoot-crypto";
    private static final String OAEP_TRANSFORM = "RSA/ECB/OAEPPadding";
    private static final String AES_TRANSFORM = "AES/GCM/NoPadding";
    private static final int AES_TAG_BITS = 128;
    private static final int PBKDF2_ITERATIONS = 600_000;

    private final SharedPreferences prefs;

    public CryptoStore(Context context) throws Exception {
        MasterKey masterKey = new MasterKey.Builder(context.getApplicationContext())
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
        this.prefs = EncryptedSharedPreferences.create(
                context.getApplicationContext(),
                PREF_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    private static String privKey(String userId) { return "key-" + userId + "-priv"; }
    private static String pubKey(String userId) { return "key-" + userId + "-pub"; }

    public boolean hasKey(String userId) {
        return prefs.contains(privKey(userId)) && prefs.contains(pubKey(userId));
    }

    public String getPublicKeyB64(String userId) {
        return prefs.getString(pubKey(userId), null);
    }

    public String createKey(String userId) throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        KeyPair pair = gen.generateKeyPair();
        byte[] pkcs8 = pair.getPrivate().getEncoded();
        byte[] spki = pair.getPublic().getEncoded();
        String pubB64 = Base64.encodeToString(spki, Base64.NO_WRAP);
        prefs.edit()
                .putString(privKey(userId), Base64.encodeToString(pkcs8, Base64.NO_WRAP))
                .putString(pubKey(userId), pubB64)
                .apply();
        return pubB64;
    }

    public void clearKey(String userId) {
        prefs.edit().remove(privKey(userId)).remove(pubKey(userId)).apply();
    }

    private PrivateKey loadPrivateKey(String userId) throws Exception {
        String b64 = prefs.getString(privKey(userId), null);
        if (b64 == null) throw new IllegalStateException("No private key for " + userId);
        byte[] pkcs8 = Base64.decode(b64, Base64.NO_WRAP);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        return kf.generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
    }

    private static PublicKey loadPublicKey(String spkiB64) throws Exception {
        byte[] spki = Base64.decode(spkiB64, Base64.NO_WRAP);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        return kf.generatePublic(new X509EncodedKeySpec(spki));
    }

    private static OAEPParameterSpec oaepSha256() {
        return new OAEPParameterSpec(
                "SHA-256", "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT
        );
    }

    private byte[] rsaDecrypt(PrivateKey key, byte[] ct) throws Exception {
        Cipher c = Cipher.getInstance(OAEP_TRANSFORM);
        c.init(Cipher.DECRYPT_MODE, key, oaepSha256());
        return c.doFinal(ct);
    }

    private byte[] rsaEncrypt(PublicKey key, byte[] pt) throws Exception {
        Cipher c = Cipher.getInstance(OAEP_TRANSFORM);
        c.init(Cipher.ENCRYPT_MODE, key, oaepSha256());
        return c.doFinal(pt);
    }

    /**
     * Decrypts an envelope JSON of the form { e2e:1, key, senderKey?, iv, ct }.
     * Tries the recipient key first, then the senderKey (so the sender's own messages
     * are also readable on their own device).
     */
    public String decryptEnvelope(String userId, String envelopeJson) throws Exception {
        JSONObject env = new JSONObject(envelopeJson);
        PrivateKey priv = loadPrivateKey(userId);
        byte[] rawAes = null;
        String[] candidates = new String[] {
                env.optString("key", null),
                env.optString("senderKey", null),
        };
        for (String b64 : candidates) {
            if (b64 == null) continue;
            try {
                rawAes = rsaDecrypt(priv, Base64.decode(b64, Base64.NO_WRAP));
                break;
            } catch (Exception ignored) {}
        }
        if (rawAes == null) throw new IllegalStateException("Could not unwrap AES key");

        byte[] iv = Base64.decode(env.getString("iv"), Base64.NO_WRAP);
        byte[] ct = Base64.decode(env.getString("ct"), Base64.NO_WRAP);
        Cipher aes = Cipher.getInstance(AES_TRANSFORM);
        aes.init(Cipher.DECRYPT_MODE, new SecretKeySpec(rawAes, "AES"), new GCMParameterSpec(AES_TAG_BITS, iv));
        return new String(aes.doFinal(ct), StandardCharsets.UTF_8);
    }

    /**
     * Mirrors peh/crypto.js encryptForSpace — generates a random AES-256 key, AES-GCM-
     * encrypts the plaintext, then RSA-OAEP-wraps the AES key for each recipient public
     * key. Returns a JSON envelope string.
     */
    public String encryptForRecipients(String plaintext, String recipientPubB64, String senderPubB64) throws Exception {
        SecureRandom rng = new SecureRandom();

        KeyGenerator kg = KeyGenerator.getInstance("AES");
        kg.init(256, rng);
        SecretKey aesKey = kg.generateKey();

        byte[] iv = new byte[12];
        rng.nextBytes(iv);

        Cipher aes = Cipher.getInstance(AES_TRANSFORM);
        aes.init(Cipher.ENCRYPT_MODE, aesKey, new GCMParameterSpec(AES_TAG_BITS, iv));
        byte[] ct = aes.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

        PublicKey recipientPub = loadPublicKey(recipientPubB64);
        byte[] wrappedForRecipient = rsaEncrypt(recipientPub, aesKey.getEncoded());

        JSONObject env = new JSONObject();
        env.put("e2e", 1);
        env.put("key", Base64.encodeToString(wrappedForRecipient, Base64.NO_WRAP));
        if (senderPubB64 != null) {
            PublicKey senderPub = loadPublicKey(senderPubB64);
            byte[] wrappedForSender = rsaEncrypt(senderPub, aesKey.getEncoded());
            env.put("senderKey", Base64.encodeToString(wrappedForSender, Base64.NO_WRAP));
        }
        env.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
        env.put("ct", Base64.encodeToString(ct, Base64.NO_WRAP));
        return env.toString();
    }

    private static SecretKey derivePinKey(String pin, byte[] salt) throws Exception {
        SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, PBKDF2_ITERATIONS, 256);
        return new SecretKeySpec(f.generateSecret(spec).getEncoded(), "AES");
    }

    /**
     * Mirrors peh/crypto.js exportKeyBundle — exports PKCS8 private key encrypted with
     * a PBKDF2-derived key from a 6-digit PIN. Returns { blob, pin }.
     */
    public JSONObject exportBundle(String userId) throws Exception {
        String privB64 = prefs.getString(privKey(userId), null);
        String pubB64 = prefs.getString(pubKey(userId), null);
        if (privB64 == null || pubB64 == null) throw new IllegalStateException("No key to export for " + userId);

        SecureRandom rng = new SecureRandom();
        byte[] salt = new byte[16];
        rng.nextBytes(salt);
        byte[] iv = new byte[12];
        rng.nextBytes(iv);

        String pin = String.format("%06d", rng.nextInt(1_000_000));
        SecretKey pinKey = derivePinKey(pin, salt);

        byte[] pkcs8 = Base64.decode(privB64, Base64.NO_WRAP);
        Cipher c = Cipher.getInstance(AES_TRANSFORM);
        c.init(Cipher.ENCRYPT_MODE, pinKey, new GCMParameterSpec(AES_TAG_BITS, iv));
        byte[] ct = c.doFinal(pkcs8);

        JSONObject bundle = new JSONObject();
        bundle.put("salt", Base64.encodeToString(salt, Base64.NO_WRAP));
        bundle.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
        bundle.put("ct", Base64.encodeToString(ct, Base64.NO_WRAP));
        bundle.put("pub", pubB64);

        String blob = Base64.encodeToString(bundle.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);

        JSONObject out = new JSONObject();
        out.put("blob", blob);
        out.put("pin", pin);
        return out;
    }

    public String importBundle(String userId, String blob, String pin) throws Exception {
        byte[] bundleBytes = Base64.decode(blob, Base64.NO_WRAP);
        JSONObject bundle = new JSONObject(new String(bundleBytes, StandardCharsets.UTF_8));
        byte[] salt = Base64.decode(bundle.getString("salt"), Base64.NO_WRAP);
        byte[] iv = Base64.decode(bundle.getString("iv"), Base64.NO_WRAP);
        byte[] ct = Base64.decode(bundle.getString("ct"), Base64.NO_WRAP);
        String pubB64 = bundle.getString("pub");

        SecretKey pinKey = derivePinKey(pin, salt);
        Cipher c = Cipher.getInstance(AES_TRANSFORM);
        c.init(Cipher.DECRYPT_MODE, pinKey, new GCMParameterSpec(AES_TAG_BITS, iv));
        byte[] pkcs8 = c.doFinal(ct);

        // Sanity-check that the decoded bytes parse as an RSA private key before we persist.
        KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));

        prefs.edit()
                .putString(privKey(userId), Base64.encodeToString(pkcs8, Base64.NO_WRAP))
                .putString(pubKey(userId), pubB64)
                .apply();
        return pubB64;
    }

    // Used to keep an unused import quiet for some toolchains.
    @SuppressWarnings("unused")
    private static byte[] sha256(byte[] in) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(in);
    }

    @SuppressWarnings("unused")
    private static JSONArray emptyArray() { return new JSONArray(); }
}
