package com.mrscrap.socialradar;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.CookieManager;

import java.time.Instant;

/** Stores only non-secret Meta session metadata. Raw cookies stay inside Android CookieManager. */
final class SessionStateStore {
    private static final String PREFS = "mrscrap_device_session_meta";
    private static final String FACEBOOK_CONNECTED_AT = "facebook_connected_at";
    private static final String INSTAGRAM_CONNECTED_AT = "instagram_connected_at";
    private static final String LAST_CHECKED_AT = "last_checked_at";

    private SessionStateStore() {}

    static boolean isFacebookConnected() {
        String cookies = CookieManager.getInstance().getCookie("https://www.facebook.com/");
        return hasCookie(cookies, "c_user");
    }

    static boolean isInstagramConnected() {
        String cookies = CookieManager.getInstance().getCookie("https://www.instagram.com/");
        return hasCookie(cookies, "sessionid") || hasCookie(cookies, "ds_user_id");
    }

    static boolean isAnyMetaConnected() {
        return isFacebookConnected() || isInstagramConnected();
    }

    static boolean isConnectedForUrl(String rawUrl) {
        return isConnectedForPlatform(platformForUrl(rawUrl));
    }

    static boolean isConnectedForPlatform(String platform) {
        if ("instagram".equalsIgnoreCase(platform)) return isInstagramConnected();
        if ("facebook".equalsIgnoreCase(platform)) return isFacebookConnected();
        return false;
    }

    static String platformForUrl(String rawUrl) {
        try {
            String host = Uri.parse(rawUrl).getHost();
            if (host == null) return "";
            String normalized = host.toLowerCase();
            if (normalized.equals("instagram.com") || normalized.endsWith(".instagram.com") ||
                normalized.equals("instagr.am") || normalized.endsWith(".instagr.am")) return "instagram";
            if (normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com") || normalized.equals("fb.watch")) return "facebook";
        } catch (Exception ignored) {}
        return "";
    }

    static void markFacebookConnected(Context context) {
        markConnected(context, FACEBOOK_CONNECTED_AT);
    }

    static void markInstagramConnected(Context context) {
        markConnected(context, INSTAGRAM_CONNECTED_AT);
    }

    private static void markConnected(Context context, String key) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(key, Instant.now().toString()).apply();
    }

    static void markChecked(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(LAST_CHECKED_AT, Instant.now().toString()).apply();
    }

    static String facebookConnectedAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(FACEBOOK_CONNECTED_AT, null);
    }

    static String instagramConnectedAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(INSTAGRAM_CONNECTED_AT, null);
    }

    static String connectedAt(Context context) {
        String facebook = facebookConnectedAt(context);
        return facebook != null ? facebook : instagramConnectedAt(context);
    }

    static String lastCheckedAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LAST_CHECKED_AT, null);
    }

    static void clearFacebook(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(FACEBOOK_CONNECTED_AT).apply();
    }

    static void clearInstagram(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(INSTAGRAM_CONNECTED_AT).apply();
    }

    static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    private static boolean hasCookie(String raw, String name) {
        if (raw == null || raw.isBlank()) return false;
        String prefix = name + "=";
        for (String part : raw.split(";")) {
            if (part.trim().startsWith(prefix) && part.trim().length() > prefix.length()) return true;
        }
        return false;
    }
}
