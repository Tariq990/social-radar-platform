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
 * Loads a watched Facebook/Instagram URL inside an app-owned WebView using the local
 * CookieManager session and returns normalized DOM data only. Cookie values never cross the
 * native bridge. If reliable source metadata cannot be read, collection fails explicitly.
 */
final class AuthenticatedWebCollector {
    interface Callback {
        void onSuccess(JSONObject result);
        void onError(String message);
    }

    private static final long TIMEOUT_MS = 15_000;
    private static final long DOM_SETTLE_MS = 750;

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
            settings.setLoadsImagesAutomatically(true);

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

            final Runnable[] pendingExtraction = new Runnable[1];

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    super.onPageFinished(view, loadedUrl);
                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;

                    if (pendingExtraction[0] != null) {
                        main.removeCallbacks(pendingExtraction[0]);
                    }

                    Runnable extraction = () -> {
                        if (finished.get()) return;
                        view.evaluateJavascript(extractionScript(), value -> {
                            if (!finished.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            try {
                                Object decoded = new JSONTokener(value).nextValue();
                                String json = decoded instanceof String ? (String) decoded : value;
                                JSONObject result = new JSONObject(json);
                                JSONObject source = result.optJSONObject("source");
                                String sourceUrl = source == null ? "" : source.optString("url", "");
                                String displayName = source == null ? "" : source.optString("displayName", "");
                                String externalId = source == null ? "" : source.optString("externalId", "");

                                if (result.has("error") || source == null ||
                                    !isAllowedSocialUrl(sourceUrl) || isBlank(displayName) || isBlank(externalId)) {
                                    destroy(view);
                                    callback.onError("Could not resolve reliable source metadata from this page");
                                    return;
                                }

                                destroy(view);
                                callback.onSuccess(result);
                            } catch (Exception error) {
                                destroy(view);
                                callback.onError("Could not parse authenticated page content");
                            }
                        });
                    };

                    pendingExtraction[0] = extraction;
                    main.postDelayed(extraction, DOM_SETTLE_MS);
                }
            });

            webView.loadUrl(url);
        });
    }

    private static boolean isBlank(String value) {
        if (value == null) return true;
        String normalized = value.trim().toLowerCase();
        return normalized.isEmpty() || normalized.equals("blank") || normalized.equals("about:blank") ||
            normalized.equals("null") || normalized.equals("undefined");
    }

    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                webView.stopLoading();
                webView.clearHistory();
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        });
    }

    private static String extractionScript() {
        return "(() => {" +
            "const abs=(u)=>{try{return new URL(u,location.href).href}catch(e){return ''}};" +
            "const allowed=(u)=>{try{const x=new URL(u);const h=x.hostname.toLowerCase();return (x.protocol==='https:'||x.protocol==='http:')&&(h==='facebook.com'||h.endsWith('.facebook.com')||h==='fb.com'||h.endsWith('.fb.com')||h==='fb.watch'||h==='instagram.com'||h.endsWith('.instagram.com')||h==='instagr.am'||h.endsWith('.instagr.am'))}catch(e){return false}};" +
            "const isPostUrl=(u)=>allowed(u)&&(/\\/(posts|permalink|reel|reels|p)\\//i.test(u)||/[?&]story_fbid=/i.test(u)||/\\/story\\.php/i.test(u));" +
            "const current=abs(location.href);" +
            "const canonicalCandidate=abs(document.querySelector('link[rel=canonical]')?.href||'');" +
            "const sourceUrl=allowed(canonicalCandidate)?canonicalCandidate:(allowed(current)?current:'');" +
            "if(!sourceUrl)return JSON.stringify({error:'SOURCE_URL_UNAVAILABLE',source:null,posts:[]});" +
            "const u=new URL(sourceUrl);" +
            "const host=u.hostname.toLowerCase();" +
            "const platform=(host.includes('instagram')||host.includes('instagr.am'))?'instagram':'facebook';" +
            "const parts=u.pathname.split('/').filter(Boolean).map(v=>{try{return decodeURIComponent(v)}catch(e){return v}});" +
            "const generic=new Set(['profile.php','groups','posts','permalink','reel','reels','p','watch','share','photo','photos','story.php','login','checkpoint','recover','help','privacy','settings']);" +
            "const first=(parts[0]||'').trim();" +
            "let handle='';" +
            "if(first&&!generic.has(first.toLowerCase()))handle=first.replace(/^@/,'');" +
            "else if(first.toLowerCase()==='groups'&&parts[1])handle=parts[1].replace(/^@/,'');" +
            "else handle=(u.searchParams.get('id')||'').trim();" +
            "if(!handle){const authorHref=[...document.querySelectorAll('a[href]')].map(a=>abs(a.getAttribute('href')||'')).find(h=>{try{if(!allowed(h))return false;const x=new URL(h);const p=x.pathname.split('/').filter(Boolean)[0]||'';return p&&!generic.has(p.toLowerCase())}catch(e){return false}});if(authorHref){try{handle=(new URL(authorHref).pathname.split('/').filter(Boolean)[0]||'').replace(/^@/,'')}catch(e){}}}" +
            "const externalId=(u.searchParams.get('id')||handle||'').trim();" +
            "const cleanTitle=(s)=>String(s||'').replace(/\\s*[|·-]\\s*Facebook\\s*$/i,'').replace(/\\s*[|·-]\\s*Instagram\\s*$/i,'').trim();" +
            "const titleCandidates=[document.querySelector('meta[property=\\\"og:title\\\"]')?.content,document.querySelector('main h1')?.innerText,document.querySelector('[role=\\\"main\\\"] h1')?.innerText,document.querySelector('h1')?.innerText,document.title].map(cleanTitle).filter(Boolean);" +
            "const title=titleCandidates.find(v=>!['facebook','instagram','blank','log into facebook'].includes(v.toLowerCase()))||(handle?('@'+handle):'');" +
            "const image=abs(document.querySelector('meta[property=\\\"og:image\\\"]')?.content||'');" +
            "const description=(document.querySelector('meta[property=\\\"og:description\\\"]')?.content||'').trim();" +
            "if(!externalId||!title)return JSON.stringify({error:'SOURCE_METADATA_UNAVAILABLE',source:{platform,externalId,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts:[]});" +
            "const findContainer=(a)=>{let n=a;for(let i=0;i<8&&n;i++,n=n.parentElement){const txt=(n.innerText||'').trim();const links=n.querySelectorAll?n.querySelectorAll('a[href]').length:0;if(txt.length>=20&&txt.length<=30000&&links>=2)return n}return a.parentElement||a};" +
            "const seen=new Set();const posts=[];let chronologicalIndex=0;" +
            "const anchors=[...document.querySelectorAll('a[href]')];" +
            "for(const anchor of anchors){if(posts.length>=30)break;const link=abs(anchor.getAttribute('href')||'');if(!isPostUrl(link)||seen.has(link))continue;const node=anchor.closest('[role=\\\"article\\\"],article')||findContainer(anchor);const text=((node&&node.innerText)||anchor.innerText||'').trim();if(text.length<5)continue;seen.add(link);const pinned=/Pinned post|منشور\\s+مثب/i.test(text);const feedIndex=pinned?-1:chronologicalIndex++;const time=node?.querySelector?.('time,[data-utime]');let publishedAt=time?.getAttribute?.('datetime')||null;const unix=time?.getAttribute?.('data-utime');if(!publishedAt&&unix&&/^\\d+$/.test(unix)){try{publishedAt=new Date(Number(unix)*1000).toISOString()}catch(e){}}const media=[];for(const img of [...(node?.querySelectorAll?.('img[src]')||[])].slice(0,6)){const src=abs(img.src);if(src&&/^https?:/i.test(src))media.push({type:'image',url:src})}for(const video of [...(node?.querySelectorAll?.('video[src]')||[])].slice(0,2)){const src=abs(video.src);if(src&&/^https?:/i.test(src))media.push({type:'video',url:src})}const idMatch=link.match(/(?:posts|permalink|reel|reels|p)\\/([^/?#]+)/i)||link.match(/[?&]story_fbid=([^&#]+)/i);posts.push({externalPostId:idMatch?.[1]||null,originalUrl:link,authorName:title,authorAvatar:image||null,text:text.slice(0,100000),media,publishedAt,metadata:{collector:'android_webview',feedIndex,pinned}})}" +
            "return JSON.stringify({source:{platform,externalId,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts});" +
          "})()";
    }
}
