package com.mrscrap.socialradar;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_NOTIFICATIONS = 2401;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(AuthenticatedSocialSessionPlugin.class);
        super.onCreate(savedInstanceState);

        RadarNotificationHelper.ensureChannel(this);
        requestRadarNotificationPermissionOnce();

        if (bridge != null && bridge.getWebView() != null) {
            // The bundled Capacitor origin (https://localhost) talks to a separately hosted HTTPS
            // MR SCRAP API. Application auth uses an HttpOnly Secure SameSite=None cookie, so the
            // main WebView must explicitly accept credential cookies for that approved API origin.
            // Exact-origin CORS remains enforced server-side; this does not expose cookie contents
            // to JavaScript and is unrelated to the separate Facebook/Instagram CookieManager session.
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(bridge.getWebView(), true);
            cookieManager.flush();

            bridge.getWebView().postDelayed(() -> deliverIntent(getIntent()), 500);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliverIntent(intent);
    }

    private void requestRadarNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        boolean prompted = getSharedPreferences("mrscrap_permissions", MODE_PRIVATE)
            .getBoolean("notifications_prompted", false);
        if (prompted) return;
        getSharedPreferences("mrscrap_permissions", MODE_PRIVATE)
            .edit()
            .putBoolean("notifications_prompted", true)
            .apply();
        getWindow().getDecorView().postDelayed(() -> ActivityCompat.requestPermissions(
            this,
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            REQUEST_NOTIFICATIONS
        ), 900);
    }

    private void deliverIntent(Intent intent) {
        if (intent == null || bridge == null || bridge.getWebView() == null) return;
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            deliverSharedIntent(intent);
            return;
        }
        if (Intent.ACTION_VIEW.equals(intent.getAction())) deliverNavigationIntent(intent.getData());
    }

    private void deliverNavigationIntent(Uri data) {
        if (data == null || !"mrscrap".equalsIgnoreCase(data.getScheme())) return;
        String screen = data.getHost();
        if (!"alerts".equals(screen) && !"radar".equals(screen) && !"watchlist".equals(screen)) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("screen", screen);
            String javascript = "window.dispatchEvent(new CustomEvent('mrscrap:navigate',{detail:" + payload.toString() + "}));";
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(javascript, null));
        } catch (Exception ignored) { }
    }

    private void deliverSharedIntent(Intent intent) {
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
