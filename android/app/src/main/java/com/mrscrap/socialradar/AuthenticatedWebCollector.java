package com.mrscrap.socialradar;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Loads a watched Facebook/Instagram URL inside a private app-owned WebView using the local
 * CookieManager session and returns normalized DOM data only. It never exposes cookie values.
 *
 * The selectors intentionally target semantic article/link structures rather than bypassing
 * platform controls. If the platform changes its DOM or blocks the page, collection fails
 * explicitly and the source is marked as needing attention.
 */
final class AuthenticatedWebCollector {
    interface Callback {
        void onSuccess(JSONObject result);
        void onError(String message);
    }

    private static final long TIMEOUT_MS = 25_000;
    private static final long DOM_SETTLE_MS = 2_000;

    private AuthenticatedWebCollector() {}

    static boolean isAllowedSocialUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return false;
            if (!(scheme.equals("https") || scheme.equals("http"))) return false;
            String normalized = host.toLowerCase();
            return normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com") || normalized.equals("fb.watch") ||
                normalized.equals("instagram.com") || normalized.endsWith(".instagram.com") ||
                normalized.equals("instagr.am") || normalized.endsWith(".instagr.am");
        } catch (Exception ignored) {
            return false;
        }
    }

    static void collect(Context context, String url, Callback callback) {
        if (!isAllowedSocialUrl(url)) {
            callback.onError("Unsupported or invalid social URL");
            return;
        }

        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            AtomicBoolean finished = new AtomicBoolean(false);
            WebView webView = new WebView(context.getApplicationContext());
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);

            Runnable timeout = () -> {
                if (finished.compareAndSet(false, true)) {
                    destroy(webView);
                    callback.onError("Authenticated source load timed out");
                }
            };
            main.postDelayed(timeout, TIMEOUT_MS);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    super.onPageFinished(view, loadedUrl);
                    main.postDelayed(() -> {
                        if (finished.get()) return;
                        view.evaluateJavascript(extractionScript(), value -> {
                            if (!finished.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            try {
                                Object decoded = new JSONTokener(value).nextValue();
                                String json = decoded instanceof String ? (String) decoded : value;
                                JSONObject result = new JSONObject(json);
                                destroy(view);
                                callback.onSuccess(result);
                            } catch (Exception error) {
                                destroy(view);
                                callback.onError("Could not parse authenticated page content");
                            }
                        });
                    }, DOM_SETTLE_MS);
                }
            });

            webView.loadUrl(url);
        });
    }

    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.clearHistory();
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        });
    }

    private static String extractionScript() {
        return "(() => {" +
            "const abs=(u)=>{try{return new URL(u,location.href).href}catch(e){return ''}};" +
            "const canonical=abs(document.querySelector('link[rel=canonical]')?.href||location.href);" +
            "const title=(document.querySelector('meta[property=\"og:title\"]')?.content||document.title||'').trim();" +
            "const image=abs(document.querySelector('meta[property=\"og:image\"]')?.content||'');" +
            "const description=(document.querySelector('meta[property=\"og:description\"]')?.content||'').trim();" +
            "const host=location.hostname.toLowerCase();" +
            "const platform=host.includes('instagram')?'instagram':'facebook';" +
            "const pathParts=location.pathname.split('/').filter(Boolean);" +
            "const fallbackId=pathParts[0]||canonical;" +
            "const nodes=[...document.querySelectorAll('[role=\"article\"],article')].slice(0,30);" +
            "const seen=new Set();const posts=[];" +
            "for(const node of nodes){" +
              "const anchors=[...node.querySelectorAll('a[href]')];" +
              "const link=anchors.map(a=>abs(a.getAttribute('href')||'')).find(h=>/\\/(posts|permalink|reel|reels|p)\\//i.test(h)||/[?&]story_fbid=/i.test(h));" +
              "if(!link||seen.has(link))continue;seen.add(link);" +
              "const text=(node.innerText||'').trim();if(!text)continue;" +
              "const time=node.querySelector('time');const publishedAt=time?.getAttribute('datetime')||time?.dateTime||null;" +
              "const media=[];" +
              "for(const img of [...node.querySelectorAll('img[src]')].slice(0,6)){const src=abs(img.src);if(src)media.push({type:'image',url:src})}" +
              "for(const video of [...node.querySelectorAll('video[src]')].slice(0,2)){const src=abs(video.src);if(src)media.push({type:'video',url:src})}" +
              "const idMatch=link.match(/(?:posts|permalink|reel|reels|p)\\/([^/?#]+)/i)||link.match(/[?&]story_fbid=([^&#]+)/i);" +
              "posts.push({externalPostId:idMatch?.[1]||null,originalUrl:link,authorName:title,authorAvatar:image||null,text:text.slice(0,100000),media,publishedAt,metadata:{collector:'android_webview'}});" +
            "}" +
            "return JSON.stringify({source:{platform,externalId:fallbackId,url:canonical,displayName:title||fallbackId,handle:pathParts[0]||'',avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts});" +
          "})()";
    }
}
