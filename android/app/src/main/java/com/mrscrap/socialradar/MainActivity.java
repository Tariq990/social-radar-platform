package com.mrscrap.socialradar;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthenticatedSocialSessionPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().postDelayed(() -> deliverSharedIntent(getIntent()), 500);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliverSharedIntent(intent);
    }

    private void deliverSharedIntent(Intent intent) {
        if (intent == null || bridge == null || bridge.getWebView() == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;

        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null || text.trim().isEmpty()) return;

        try {
            JSONObject payload = new JSONObject();
            payload.put("text", text);
            if (subject != null) payload.put("subject", subject);
            String javascript = "window.dispatchEvent(new CustomEvent('mrscrap:share',{detail:" + payload.toString() + "}));";
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(javascript, null));
        } catch (Exception ignored) {
            // Shared text is non-critical; user can still paste the URL manually.
        }
    }
}
