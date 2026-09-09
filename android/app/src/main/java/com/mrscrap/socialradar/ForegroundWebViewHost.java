package com.mrscrap.socialradar;

import android.app.Activity;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.FrameLayout;

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
        // Keep the collector fully renderable. It is inserted behind the Capacitor WebView, so
        // lowering alpha is unnecessary and can suppress Chromium's first visible paint callback.
        webView.setAlpha(1f);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setClickable(false);
        webView.setFocusable(false);
        webView.setFocusableInTouchMode(false);
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        FrameLayout host = new FrameLayout(activity);
        host.setClipChildren(true);
        host.setClipToPadding(true);
        host.setClickable(false);
        host.setFocusable(false);
        host.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);

        FrameLayout.LayoutParams hostParams = new FrameLayout.LayoutParams(48, 48);
        hostParams.gravity = Gravity.BOTTOM | Gravity.END;
        // The 1x1 intersection still produced an empty physical Facebook feed. Keep a tiny but
        // material topmost intersection while retaining a full-size child layout/JS viewport.
        root.addView(host, hostParams);

        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
            Math.max(1, width),
            Math.max(1, height)
        );
        host.addView(webView, webParams);
        webView.onResume();
        webView.resumeTimers();
        webView.requestLayout();
        webView.invalidate();
        return true;
    }

    static void destroy(WebView webView) {
        try {
            webView.stopLoading();
            webView.onPause();
            webView.clearHistory();
            android.view.ViewParent parent = webView.getParent();
            if (parent instanceof ViewGroup) {
                ViewGroup host = (ViewGroup) parent;
                host.removeView(webView);
                android.view.ViewParent hostParent = host.getParent();
                if (host.getChildCount() == 0 && hostParent instanceof ViewGroup) {
                    ((ViewGroup) hostParent).removeView(host);
                }
            }
            webView.removeAllViews();
            webView.destroy();
        } catch (Exception ignored) {}
    }
}
