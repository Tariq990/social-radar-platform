package com.mrscrap.socialradar;

import android.app.Activity;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

/**
 * Gives foreground authenticated collectors a real window lifecycle without exposing the
 * Facebook/Instagram page to the React bridge. Background WorkManager collectors deliberately
 * fall back to an application-context detached WebView because no Activity exists there.
 */
final class ForegroundWebViewHost {
    private ForegroundWebViewHost() {}

    static Context contextFor(Context context) {
        if (context instanceof Activity) {
            Activity activity = (Activity) context;
            if (!activity.isFinishing() && !activity.isDestroyed()) return activity;
        }
        return context.getApplicationContext();
    }

    static boolean attachIfPossible(Context context, WebView webView, int width, int height) {
        if (!(context instanceof Activity)) return false;
        Activity activity = (Activity) context;
        if (activity.isFinishing() || activity.isDestroyed()) return false;
        View content = activity.findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) return false;

        ViewGroup root = (ViewGroup) content;
        webView.setVisibility(View.VISIBLE);
        webView.setAlpha(0.01f);
        webView.setClickable(false);
        webView.setFocusable(false);
        webView.setFocusableInTouchMode(false);
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(
            Math.max(1, width),
            Math.max(1, height)
        );
        // Index 0 keeps the collector behind the Capacitor app while still attached/visible to
        // Android's window lifecycle, which is required by modern lazy-rendered Meta feeds.
        root.addView(webView, 0, params);
        webView.onResume();
        return true;
    }

    static void destroy(WebView webView) {
        try {
            webView.stopLoading();
            webView.onPause();
            webView.clearHistory();
            android.view.ViewParent parent = webView.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(webView);
            webView.removeAllViews();
            webView.destroy();
        } catch (Exception ignored) {}
    }
}
