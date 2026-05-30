package net.shtoot.app.cryptoplugin;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "ShtootCrypto")
public class ShtootCryptoPlugin extends Plugin {

    private CryptoStore store() throws Exception {
        return new CryptoStore(getContext());
    }

    private static String requireUserID(PluginCall call) {
        String id = call.getString("userID");
        if (id == null || id.isEmpty()) {
            call.reject("userID required");
            return null;
        }
        return id;
    }

    @PluginMethod
    public void hasKey(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        try {
            CryptoStore s = store();
            JSObject res = new JSObject();
            boolean has = s.hasKey(userId);
            res.put("has", has);
            if (has) res.put("publicKeyB64", s.getPublicKeyB64(userId));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("hasKey failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void createKey(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        try {
            String pub = store().createKey(userId);
            JSObject res = new JSObject();
            res.put("publicKeyB64", pub);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("createKey failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void clearKey(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        try {
            store().clearKey(userId);
            JSObject res = new JSObject();
            res.put("ok", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("clearKey failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void decryptEnvelope(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        String env = call.getString("envelope");
        if (env == null) { call.reject("envelope required"); return; }
        try {
            String plain = store().decryptEnvelope(userId, env);
            JSObject res = new JSObject();
            res.put("plaintext", plain);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("decryptEnvelope failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void encryptForRecipients(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        String plaintext = call.getString("plaintext");
        String recipientPubB64 = call.getString("recipientPubB64");
        String senderPubB64 = call.getString("senderPubB64");
        if (plaintext == null || recipientPubB64 == null) {
            call.reject("plaintext and recipientPubB64 required");
            return;
        }
        try {
            String envelope = store().encryptForRecipients(plaintext, recipientPubB64, senderPubB64);
            JSObject res = new JSObject();
            res.put("envelope", envelope);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("encryptForRecipients failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void exportBundle(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        try {
            JSONObject out = store().exportBundle(userId);
            JSObject res = new JSObject();
            res.put("blob", out.getString("blob"));
            res.put("pin", out.getString("pin"));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("exportBundle failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void importBundle(PluginCall call) {
        String userId = requireUserID(call);
        if (userId == null) return;
        String blob = call.getString("blob");
        String pin = call.getString("pin");
        if (blob == null || pin == null) { call.reject("blob and pin required"); return; }
        try {
            String pub = store().importBundle(userId, blob, pin);
            JSObject res = new JSObject();
            res.put("publicKeyB64", pub);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("importBundle failed: " + e.getMessage(), e);
        }
    }
}
