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

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Fast metadata-only resolver used while adding a source. Unlike the post collector, this path
 * never waits for feed/permalink discovery: it returns as soon as a real account/page name is
 * visible (and briefly gives the profile image time to appear). The authenticated Meta session
 * remains local to Android's CookieManager and raw cookies never cross the bridge.
 */
final class AuthenticatedSourceMetadataResolver {
    private static final long TIMEOUT_MS = 6_000;
    private static final long FIRST_EXTRACTION_DELAY_MS = 120;
    private static final long RETRY_DELAY_MS = 220;
    private static final int MAX_EXTRACTION_ATTEMPTS = 14;
    private static final int AVATAR_GRACE_ATTEMPTS = 3;

    private AuthenticatedSourceMetadataResolver() {}

    static void resolve(Context context, String url, AuthenticatedWebCollector.Callback callback) {
        if (!AuthenticatedWebCollector.isAllowedSocialUrl(url)) {
            callback.onError("Unsupported or invalid social URL");
            return;
        }

        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            AtomicBoolean finished = new AtomicBoolean(false);
            int[] attempts = new int[] { 0 };
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
                    callback.onError("Source metadata unavailable");
                }
            };
            main.postDelayed(timeout, TIMEOUT_MS);

            final Runnable[] extractionRunner = new Runnable[1];
            extractionRunner[0] = () -> {
                if (finished.get()) return;
                attempts[0]++;
                webView.evaluateJavascript(extractionScript(url), value -> {
                    if (finished.get()) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        String json = decoded instanceof String ? (String) decoded : value;
                        JSONObject result = new JSONObject(json);
                        JSONObject source = result.optJSONObject("source");
                        String sourceUrl = source == null ? "" : source.optString("url", "");
                        String displayName = source == null ? "" : source.optString("displayName", "");
                        String externalId = source == null ? "" : source.optString("externalId", "");
                        String avatarUrl = source == null ? "" : source.optString("avatarUrl", "");

                        boolean reliable = !result.has("error") && source != null &&
                            AuthenticatedWebCollector.isAllowedSocialUrl(sourceUrl) &&
                            !isBlank(displayName) && !isBlank(externalId);

                        // Give lazy-loaded profile images a few hundred milliseconds, but never
                        // block onboarding on an image that Meta chooses not to expose in this DOM.
                        if (reliable && (!isBlank(avatarUrl) || attempts[0] >= AVATAR_GRACE_ATTEMPTS)) {
                            if (!finished.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            destroy(webView);
                            JSONObject output = new JSONObject();
                            output.put("source", source);
                            output.put("posts", new JSONArray());
                            callback.onSuccess(output);
                            return;
                        }
                    } catch (Exception ignored) {
                        // Dynamic Meta pages can be between DOM states; retry below.
                    }

                    if (attempts[0] < MAX_EXTRACTION_ATTEMPTS) {
                        main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);
                        return;
                    }

                    if (!finished.compareAndSet(false, true)) return;
                    main.removeCallbacks(timeout);
                    destroy(webView);
                    callback.onError("Source metadata unavailable");
                });
            };

            webView.setWebViewClient(new WebViewClient() {
                private void scheduleExtraction(long delayMs) {
                    if (finished.get()) return;
                    main.removeCallbacks(extractionRunner[0]);
                    main.postDelayed(extractionRunner[0], delayMs);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !AuthenticatedWebCollector.isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageCommitVisible(WebView view, String loadedUrl) {
                    super.onPageCommitVisible(view, loadedUrl);
                    if (!AuthenticatedWebCollector.isAllowedSocialUrl(loadedUrl) || finished.get()) return;
                    scheduleExtraction(FIRST_EXTRACTION_DELAY_MS);
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    super.onPageFinished(view, loadedUrl);
                    if (!AuthenticatedWebCollector.isAllowedSocialUrl(loadedUrl) || finished.get()) return;
                    scheduleExtraction(60);
                }
            });

            webView.loadUrl(preferMobileFacebookUrl(url));
        });
    }

    private static String preferMobileFacebookUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null) return rawUrl;
            String normalized = host.toLowerCase();
            boolean facebook = normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com");
            if (!facebook || normalized.equals("fb.watch")) return rawUrl;
            return uri.buildUpon().authority("m.facebook.com").build().toString();
        } catch (Exception ignored) {
            return rawUrl;
        }
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

    private static String extractionScript(String requestedUrl) {
        String requested = JSONObject.quote(requestedUrl);
        return "(() => {" +
            "const requested=" + requested + ";" +
            "const abs=(u)=>{try{return new URL(u,location.href).href}catch(e){return ''}};" +
            "const allowed=(u)=>{try{const x=new URL(u);const h=x.hostname.toLowerCase();return (x.protocol==='https:'||x.protocol==='http:')&&(h==='facebook.com'||h.endsWith('.facebook.com')||h==='fb.com'||h.endsWith('.fb.com')||h==='fb.watch'||h==='instagram.com'||h.endsWith('.instagram.com')||h==='instagr.am'||h.endsWith('.instagr.am'))}catch(e){return false}};" +
            "const blockedPath=(u)=>{try{const p=new URL(u).pathname.toLowerCase();return p.includes('/login')||p.includes('/checkpoint')||p.includes('/recover')}catch(e){return true}};" +
            "const current=abs(location.href);const canonical=abs(document.querySelector('link[rel=canonical]')?.href||'');" +
            "const sourceUrl=(allowed(canonical)&&!blockedPath(canonical))?canonical:((allowed(current)&&!blockedPath(current))?current:requested);" +
            "if(!allowed(sourceUrl)||blockedPath(sourceUrl))return JSON.stringify({error:'SOURCE_URL_UNAVAILABLE'});" +
            "const identityUrl=allowed(requested)?requested:sourceUrl;const u=new URL(identityUrl);" +
            "const host=u.hostname.toLowerCase();const platform=(host.includes('instagram')||host.includes('instagr.am'))?'instagram':'facebook';" +
            "const parts=u.pathname.split('/').filter(Boolean).map(v=>{try{return decodeURIComponent(v)}catch(e){return v}});" +
            "const generic=new Set(['profile.php','groups','posts','permalink','permalink.php','reel','reels','p','watch','share','photo','photo.php','photos','story.php','videos','login','checkpoint','recover','help','privacy','settings']);" +
            "const first=(parts[0]||'').trim();let handle='';" +
            "if(first.toLowerCase()==='profile.php')handle=(u.searchParams.get('id')||'').trim();else if(first.toLowerCase()==='groups'&&parts[1])handle=parts[1].replace(/^@/,'');else if(first&&!generic.has(first.toLowerCase()))handle=first.replace(/^@/,'');else handle=(u.searchParams.get('id')||'').trim();" +
            "const cleanTitle=(s)=>String(s||'').replace(/\\s*[|·-]\\s*Facebook\\s*$/i,'').replace(/\\s*[|·-]\\s*Instagram\\s*$/i,'').trim();" +
            "const headings=[document.querySelector('main h1'),document.querySelector('[role=\\\"main\\\"] h1'),document.querySelector('h1')].filter(Boolean);" +
            "const candidates=[document.querySelector('meta[property=\\\"og:title\\\"]')?.content,...headings.map(x=>x.innerText),document.querySelector('main strong[dir=\\\"auto\\\"]')?.innerText,document.querySelector('[role=\\\"main\\\"] strong[dir=\\\"auto\\\"]')?.innerText,document.title].map(cleanTitle).filter(Boolean);" +
            "const bad=(v)=>{const n=v.toLowerCase();return !n||n==='facebook'||n==='instagram'||n==='blank'||n==='log into facebook'||n==='log in to facebook'||n==='error facebook'||(handle&&(n===handle.toLowerCase()||n===('@'+handle).toLowerCase()))};" +
            "const title=candidates.find(v=>!bad(v))||'';if(!handle||!title)return JSON.stringify({error:'SOURCE_METADATA_PENDING'});" +
            "const score=(img)=>{if(!img)return -999;const src=abs(img.getAttribute('src')||img.src||'');if(!/^https?:/i.test(src))return -999;const alt=((img.getAttribute('alt')||'')+' '+(img.getAttribute('aria-label')||'')).toLowerCase();let s=0;if(alt.includes(title.toLowerCase()))s+=10;if(alt.includes(handle.toLowerCase()))s+=6;if(/profile|avatar|صورة الملف|الصورة الشخصية/i.test(alt))s+=5;if(/cover|غلاف/i.test(alt))s-=6;const w=Number(img.getAttribute('width')||img.width||0),h=Number(img.getAttribute('height')||img.height||0);if(w&&h&&Math.abs(w-h)<Math.max(w,h)*0.2)s+=3;if(w>700||h>700)s-=2;return s};" +
            "const main=document.querySelector('main')||document.querySelector('[role=\\\"main\\\"]')||document.body;const imgs=[...(main?.querySelectorAll?.('img[src]')||[])].slice(0,40);imgs.sort((a,b)=>score(b)-score(a));" +
            "const image=abs(document.querySelector('meta[property=\\\"og:image\\\"]')?.content||imgs[0]?.getAttribute('src')||imgs[0]?.src||'');" +
            "const description=(document.querySelector('meta[property=\\\"og:description\\\"]')?.content||document.querySelector('meta[name=\\\"description\\\"]')?.content||'').trim();" +
            "return JSON.stringify({source:{platform,externalId:handle,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'}});" +
          "})()";
    }
}
