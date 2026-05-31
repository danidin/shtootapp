package net.shtoot.app.bridgeplugin;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ShtootBridge")
public class ShtootBridgePlugin extends Plugin {

    public static final String PREF_FILE = "shtoot-ui";
    public static final String PREF_CURRENT_SPACE = "current-space";

    @PluginMethod
    public void setCurrentSpace(PluginCall call) {
        String space = call.getString("space", "");
        SharedPreferences prefs = getContext().getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
        prefs.edit().putString(PREF_CURRENT_SPACE, space == null ? "" : space).apply();
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    public static String readCurrentSpace(Context ctx) {
        return ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
                .getString(PREF_CURRENT_SPACE, "");
    }
}
