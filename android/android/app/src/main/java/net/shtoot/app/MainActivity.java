package net.shtoot.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import net.shtoot.app.cryptoplugin.ShtootCryptoPlugin;
import net.shtoot.app.fcm.ShtootMessagingService;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShtootCryptoPlugin.class);
        super.onCreate(savedInstanceState);
        ShtootMessagingService.ensureChannel(this);
    }
}
