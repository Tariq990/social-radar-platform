package com.mrscrap.socialradar;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
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
    private static final long TIMEOUT_MS = 75_000;
    private static final long FIRST_DELAY_MS = 450;
    private static final long RETRY_DELAY_MS = 850;
    private static final int MAX_STANDARD_ATTEMPTS = 10;
    private static final int MAX_ALL_ATTEMPTS = 18;
    private static final String TAG = "MRSCRAP_DETAIL";

    private AuthenticatedPostDetailCollector() {}

    static void collect(
        Context context,
        String url,
        String sourceUrl,
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
        final boolean photoDetailMode = isFacebookPhotoUrl(url) && sourceUrl != null &&
            !sourceUrl.isBlank() && AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl);
        final String targetUrl = preferDesktopFacebookUrl(photoDetailMode ? sourceUrl : url);
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
            boolean[] photoOpened = new boolean[] { !photoDetailMode };
            int[] lastCommentCount = new int[] { -1 };
            int[] stablePasses = new int[] { 0 };

            WebView webView = new WebView(ForegroundWebViewHost.contextFor(context));
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setLoadsImagesAutomatically(true);
            settings.setOffscreenPreRaster(true);
            settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36");
            Log.i(TAG, "event=user_agent mode=desktop");

            int viewportWidth = Math.max(360, context.getResources().getDisplayMetrics().widthPixels);
            int viewportHeight = Math.max(740, context.getResources().getDisplayMetrics().heightPixels);
            webView.measure(
                View.MeasureSpec.makeMeasureSpec(viewportWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(viewportHeight, View.MeasureSpec.EXACTLY)
            );
            webView.layout(0, 0, viewportWidth, viewportHeight);
            ForegroundWebViewHost.attachIfPossible(context, webView, viewportWidth, viewportHeight);

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
                String currentUrl = webView.getUrl();
                if (currentUrl == null || !AuthenticatedWebCollector.isAllowedSocialUrl(currentUrl)) {
                    Log.i(TAG, "event=wait_for_social_page");
                    main.postDelayed(runner[0], RETRY_DELAY_MS);
                    return;
                }
                attempts[0]++;
                Log.i(TAG, "event=extract_start attempt=" + attempts[0] + " progress=" + webView.getProgress());

                if (photoDetailMode && !photoOpened[0]) {
                    webView.evaluateJavascript(photoClickScript(url), clickedValue -> {
                        if (finished.get()) return;
                        boolean clicked = "true".equalsIgnoreCase(String.valueOf(clickedValue));
                        if (clicked) {
                            photoOpened[0] = true;
                            attempts[0] = 0;
                            main.postDelayed(runner[0], 850);
                            return;
                        }
                        if (attempts[0] < maxAttempts) {
                            webView.evaluateJavascript(
                                "(() => { const h=Math.max(window.innerHeight||700,700); window.scrollBy(0,Math.round(h*1.7)); return window.scrollY; })()",
                                ignored -> main.postDelayed(runner[0], RETRY_DELAY_MS)
                            );
                            return;
                        }
                        finishError(main, timeout, webView, finished, callback, "PHOTO_POST_NOT_FOUND_ON_SOURCE");
                    });
                    return;
                }

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
                                JSONArray media = result.optJSONArray("media");
                                int mediaCount = media == null ? 0 : media.length();
                                Log.i(TAG, "event=eval_result attempt=" + attempts[0] + " comments=" + count + " media=" + mediaCount + " hasMore=" + hasMore);

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
                    main.postDelayed(runner[0], delay);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !AuthenticatedWebCollector.isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageStarted(WebView view, String loadedUrl, android.graphics.Bitmap favicon) {
                    super.onPageStarted(view, loadedUrl, favicon);
                    if (!AuthenticatedWebCollector.isAllowedSocialUrl(loadedUrl) || finished.get()) return;
                    Log.i(TAG, "event=page_started progress=" + view.getProgress());
                    schedule(3_000);
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

            Log.i(TAG, "event=load_start");
            webView.loadUrl(targetUrl);
            main.postDelayed(runner[0], 3_000);
        });
    }

    private static boolean isFacebookPhotoUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            String path = uri.getPath();
            if (host == null || path == null) return false;
            String normalized = host.toLowerCase();
            boolean facebook = normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com");
            if (!facebook) return false;
            String p = path.toLowerCase();
            return p.equals("/photo") || p.equals("/photo/") || p.equals("/photo.php") || p.startsWith("/photo/");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String photoClickScript(String rawUrl) {
        String target = JSONObject.quote(rawUrl);
        return "(() => {" +
            "const target=" + target + ";" +
            "let wanted;try{wanted=new URL(target,location.href);}catch(e){return false;}" +
            "const fbid=wanted.searchParams.get('fbid')||'';" +
            "const anchors=[...document.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')];" +
            "const match=anchors.find(a=>{const raw=a.getAttribute('href')||a.getAttribute('data-href')||a.getAttribute('data-url')||a.getAttribute('ajaxify')||'';let u;try{u=new URL(raw,location.href);}catch(e){return false;}if(fbid&&u.searchParams.get('fbid')===fbid)return true;return u.href===wanted.href;});" +
            "if(!match)return false;match.click();return true;" +
            "})()";
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
        new Handler(Looper.getMainLooper()).post(() -> ForegroundWebViewHost.destroy(webView));
    }
}
