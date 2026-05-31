package net.shtoot.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import net.shtoot.app.bridgeplugin.ShtootBridgePlugin;
import net.shtoot.app.cryptoplugin.ShtootCryptoPlugin;
import net.shtoot.app.fcm.ShtootMessagingService;

public class MainActivity extends BridgeActivity {
    // Read by ShtootMessagingService to decide whether to post a system
    // notification. ProcessLifecycleOwner is unreliable here (lifecycle-process
    // wakeup races + FCM-only process starts), so we track it directly.
    public static volatile boolean isForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShtootCryptoPlugin.class);
        registerPlugin(ShtootBridgePlugin.class);
        super.onCreate(savedInstanceState);
        ShtootMessagingService.ensureChannel(this);
        capturePendingSpace(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        capturePendingSpace(intent);
    }

    private void capturePendingSpace(Intent intent) {
        if (intent == null) return;
        String space = intent.getStringExtra("space");
        if (space != null) ShtootBridgePlugin.writePendingSpace(this, space);
    }

    @Override
    public void onResume() {
        super.onResume();
        isForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        isForeground = false;
    }
}
