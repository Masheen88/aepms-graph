package com.applespest.termitefieldbook;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register before BridgeActivity builds the Capacitor bridge.
        registerPlugin(PdfSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
