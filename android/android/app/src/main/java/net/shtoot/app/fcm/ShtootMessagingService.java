package net.shtoot.app.fcm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import net.shtoot.app.MainActivity;
import net.shtoot.app.R;
import net.shtoot.app.bridgeplugin.ShtootBridgePlugin;
import net.shtoot.app.cryptoplugin.CryptoStore;

import java.util.Map;

public class ShtootMessagingService extends FirebaseMessagingService {
    private static final String TAG = "ShtootFCM";
    public static final String CHANNEL_ID = "shtoot-messages";
    private static final String PREF_FILE = "shtoot-fcm";
    private static final String PREF_LAST_TOKEN = "last-token";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;
        if (!"shtoot".equals(data.get("type"))) return;

        String space = data.get("space");
        if (MainActivity.isForeground && spacesMatch(space, ShtootBridgePlugin.readCurrentSpace(this))) {
            // The user is looking at this exact space; the WebSocket-driven UI
            // already shows the message. Other-space messages still notify.
            return;
        }

        String senderID = data.get("senderID");
        String targetUser = data.get("targetUser");
        String payload = data.get("payload");
        String shtootId = data.get("shtootId");

        String body = resolveBody(targetUser, payload);
        String title = senderID != null ? senderID : "Shtoot";

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (shtootId != null) intent.putExtra("shtootId", shtootId);
        if (space != null) intent.putExtra("space", space);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, shtootId != null ? shtootId.hashCode() : 0, intent, piFlags
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent);

        try {
            NotificationManagerCompat.from(this).notify(
                    shtootId != null ? shtootId.hashCode() : (int) System.currentTimeMillis(),
                    builder.build()
            );
        } catch (SecurityException e) {
            Log.w(TAG, "POST_NOTIFICATIONS not granted", e);
        }
    }

    private String resolveBody(String targetUser, String payload) {
        if (payload == null) return "New message";
        if (!payload.startsWith("{\"e2e\":1") && !payload.startsWith("{\"e2e\": 1")) {
            return payload;
        }
        if (targetUser == null) return "New encrypted message";
        try {
            CryptoStore store = new CryptoStore(this);
            if (!store.hasKey(targetUser)) return "New encrypted message";
            return store.decryptEnvelope(targetUser, payload);
        } catch (Exception e) {
            Log.w(TAG, "FCM decrypt failed for " + targetUser, e);
            return "New encrypted message";
        }
    }

    @Override
    public void onNewToken(String token) {
        Log.i(TAG, "FCM token refreshed");
        SharedPreferences prefs = getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
        prefs.edit().putString(PREF_LAST_TOKEN, token).apply();
        // The WebView side reads this via @capacitor/push-notifications' registration
        // event on next launch; the explicit broadcast isn't needed because the plugin
        // also delivers token refresh events through its own pipeline.
    }

    public static String readLastToken(Context ctx) {
        return ctx.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
                .getString(PREF_LAST_TOKEN, null);
    }

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("New shtoots delivered while the app is in the background");
        nm.createNotificationChannel(channel);
    }

    private static boolean spacesMatch(String fcmSpace, String currentSpace) {
        String a = fcmSpace == null ? "" : fcmSpace;
        String b = currentSpace == null ? "" : currentSpace;
        return a.equals(b);
    }
}
