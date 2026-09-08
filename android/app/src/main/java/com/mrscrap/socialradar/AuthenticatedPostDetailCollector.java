package com.mrscrap.socialradar;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * On-demand detail collector for a single Facebook/Instagram post. It uses the same local
 * WebView CookieManager session as the app and returns only normalized post media/comments.
 * Raw cookies, browser storage and credentials never cross the native bridge.
 */
final class AuthenticatedPostDetailCollector {
    private static final long TIMEOUT_MS = 40_000;
    private static final long FIRST_DELAY_MS = 450;
    private static final long RETRY_DELAY_MS = 850;
    private static final int MAX_STANDARD_ATTEMPTS = 10;
    private static final int MAX_ALL_ATTEMPTS = 18;

    private AuthenticatedPostDetailCollector() {}

    static void collect(
        Context context,
        String url,
        String publisherName,
        String commentsMode,
        int requestedCommentLimit,
        boolean includeReplies,
        AuthenticatedWebCollector.Callback callback
    ) {
        if (!AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            callback.onError("Invalid Facebook/Instagram post URL");
            return;
        }

        final String mode = normalizeMode(commentsMode);
        final int commentLimit = "none".equals(mode)
            ? 0
            : Math.max(1, Math.min(200, requestedCommentLimit));
        final int maxAttempts = "all".equals(mode) ? MAX_ALL_ATTEMPTS : MAX_STANDARD_ATTEMPTS;
        final String targetUrl = preferDesktopFacebookUrl(url);
        final String extractorScript;
        try {
            extractorScript = readExtractorScript(context);
        } catch (Exception error) {
            callback.onError("Post detail extractor is unavailable");
            return;
        }

        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            AtomicBoolean finished = new AtomicBoolean(false);
            int[] attempts = new int[] { 0 };
            int[] lastCommentCount = new int[] { -1 };
            int[] stablePasses = new int[] { 0 };

            WebView webView = new WebView(context.getApplicationContext());
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setLoadsImagesAutomatically(true);
            settings.setOffscreenPreRaster(true);

            int viewportWidth = Math.max(360, context.getResources().getDisplayMetrics().widthPixels);
            int viewportHeight = Math.max(740, context.getResources().getDisplayMetrics().heightPixels);
            webView.measure(
                View.MeasureSpec.makeMeasureSpec(viewportWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(viewportHeight, View.MeasureSpec.EXACTLY)
            );
            webView.layout(0, 0, viewportWidth, viewportHeight);

            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setAcceptThirdPartyCookies(webView, true);

            Runnable timeout = () -> finishError(webView, finished, callback, "Authenticated post detail load timed out");
            main.postDelayed(timeout, TIMEOUT_MS);

            JSONObject options = new JSONObject();
            try {
                options.put("commentsMode", mode);
                options.put("commentLimit", commentLimit);
                options.put("includeReplies", includeReplies);
                options.put("publisherName", publisherName == null ? "" : publisherName);
            } catch (Exception ignored) {}
            String optionsJson = options.toString();

            final Runnable[] runner = new Runnable[1];
            runner[0] = () -> {
                if (finished.get()) return;
                attempts[0]++;

                webView.evaluateJavascript(extractorScript, loaded -> {
                    if (finished.get()) return;
                    Runnable extract = () -> webView.evaluateJavascript(
                        "globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__(" + optionsJson + ")",
                        value -> {
                            if (finished.get()) return;
                            try {
                                Object decoded = new JSONTokener(value).nextValue();
                                String json = decoded instanceof String ? (String) decoded : value;
                                JSONObject result = new JSONObject(json);
                                String errorCode = result.optString("error", "");
                                if ("SESSION_REQUIRED".equals(errorCode) || "SESSION_CHECKPOINT".equals(errorCode)) {
                                    finishError(main, timeout, webView, finished, callback, errorCode);
                                    return;
                                }

                                JSONArray comments = result.optJSONArray("comments");
                                int count = comments == null ? 0 : comments.length();
                                JSONObject diagnostics = result.optJSONObject("diagnostics");
                                boolean hasMore = diagnostics != null && diagnostics.optBoolean("hasMoreControls", false);

                                if (count == lastCommentCount[0]) stablePasses[0]++;
                                else stablePasses[0] = 0;
                                lastCommentCount[0] = count;

                                boolean enough = commentLimit > 0 && count >= commentLimit;
                                boolean stableComplete = !hasMore && stablePasses[0] >= 1;
                                boolean standardComplete = !"all".equals(mode) && (enough || stableComplete);
                                boolean allComplete = "all".equals(mode) && (enough || stableComplete);
                                boolean noCommentsRequested = "none".equals(mode);

                                if (noCommentsRequested || standardComplete || allComplete || attempts[0] >= maxAttempts) {
                                    finishSuccess(main, timeout, webView, finished, callback, result);
                                    return;
                                }
                                main.postDelayed(runner[0], RETRY_DELAY_MS);
                            } catch (Exception error) {
                                if (attempts[0] >= maxAttempts) {
                                    finishError(main, timeout, webView, finished, callback, "Could not parse authenticated post details");
                                } else {
                                    main.postDelayed(runner[0], RETRY_DELAY_MS);
                                }
                            }
                        }
                    );

                    if (!"none".equals(mode)) {
                        webView.evaluateJavascript("globalThis.__MR_SCRAP_EXPAND_POST_DETAIL__()", ignored ->
                            main.postDelayed(extract, 280)
                        );
                    } else {
                        extract.run();
                    }
                });
            };

            webView.setWebViewClient(new WebViewClient() {
                private void schedule(long delay) {
                    if (finished.get()) return;
                    main.removeCallbacks(runner[0]);
                    main.postDelayed(runner[0], delay);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !AuthenticatedWebCollector.isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageCommitVisible(WebView view, String loadedUrl) {
                    super.onPageCommitVisible(view, loadedUrl);
                    if (AuthenticatedWebCollector.isAllowedSocialUrl(loadedUrl)) schedule(FIRST_DELAY_MS);
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    super.onPageFinished(view, loadedUrl);
                    if (AuthenticatedWebCollector.isAllowedSocialUrl(loadedUrl)) schedule(180);
                }
            });

            webView.loadUrl(targetUrl);
        });
    }

    private static String normalizeMode(String value) {
        if ("publisher".equals(value) || "top".equals(value) || "all".equals(value)) return value;
        return "none";
    }

    private static String preferDesktopFacebookUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null) return rawUrl;
            String normalized = host.toLowerCase();
            boolean facebook = normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com");
            if (!facebook || normalized.equals("fb.watch")) return rawUrl;
            return uri.buildUpon().authority("www.facebook.com").build().toString();
        } catch (Exception ignored) {
            return rawUrl;
        }
    }

    private static String readExtractorScript(Context context) throws Exception {
        try (InputStream input = context.getResources().openRawResource(R.raw.mrscrap_post_detail_extractor);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void finishSuccess(
        Handler main,
        Runnable timeout,
        WebView webView,
        AtomicBoolean finished,
        AuthenticatedWebCollector.Callback callback,
        JSONObject result
    ) {
        if (!finished.compareAndSet(false, true)) return;
        main.removeCallbacks(timeout);
        destroy(webView);
        callback.onSuccess(result);
    }

    private static void finishError(
        Handler main,
        Runnable timeout,
        WebView webView,
        AtomicBoolean finished,
        AuthenticatedWebCollector.Callback callback,
        String message
    ) {
        if (!finished.compareAndSet(false, true)) return;
        main.removeCallbacks(timeout);
        destroy(webView);
        callback.onError(message);
    }

    private static void finishError(
        WebView webView,
        AtomicBoolean finished,
        AuthenticatedWebCollector.Callback callback,
        String message
    ) {
        if (!finished.compareAndSet(false, true)) return;
        destroy(webView);
        callback.onError(message);
    }

    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                webView.stopLoading();
                webView.clearHistory();
                android.view.ViewParent parent = webView.getParent();
                if (parent instanceof android.view.ViewGroup) ((android.view.ViewGroup) parent).removeView(webView);
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        });
    }
}
