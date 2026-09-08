package com.mrscrap.socialradar;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;

import java.time.Instant;

/**
 * Stores only non-secret session metadata. Raw WebView cookies remain owned by CookieManager
 * and are never copied into SharedPreferences, JavaScript, logs, or backend requests.
 */
final class SessionStateStore {
    private static final String PREFS = "mrscrap_device_session_meta";
    private static final String CONNECTED_AT = "connected_at";
    private static final String LAST_CHECKED_AT = "last_checked_at";

    private SessionStateStore() {}

    static boolean isFacebookConnected() {
        String cookies = CookieManager.getInstance().getCookie("https://www.facebook.com/");
        return cookies != null && cookies.contains("c_user=");
    }

    static void markConnected(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(CONNECTED_AT, Instant.now().toString())
            .apply();
    }

    static void markChecked(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(LAST_CHECKED_AT, Instant.now().toString())
            .apply();
    }

    static String connectedAt(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getString(CONNECTED_AT, null);
    }

    static String lastCheckedAt(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getString(LAST_CHECKED_AT, null);
    }

    static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }
}
