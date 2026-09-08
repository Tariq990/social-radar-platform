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
 * Loads a watched Facebook/Instagram URL inside an app-owned WebView using the local
 * CookieManager session and returns normalized DOM data only. Cookie values never cross the
 * native bridge. The collector reads only content the user's authenticated WebView can render.
 */
final class AuthenticatedWebCollector {
    interface Callback {
        void onSuccess(JSONObject result);
        void onError(String message);
    }

    private static final long TIMEOUT_MS = 20_000;
    private static final long FIRST_EXTRACTION_DELAY_MS = 350;
    private static final long RETRY_DELAY_MS = 650;
    private static final int MAX_EXTRACTION_ATTEMPTS = 12;
    private static final int DEFAULT_LIMIT = 10;
    private static final int MAX_LIMIT = 20;

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
        collect(context, url, DEFAULT_LIMIT, callback);
    }

    static void collect(Context context, String url, int requestedLimit, Callback callback) {
        if (!isAllowedSocialUrl(url)) {
            callback.onError("Unsupported or invalid social URL");
            return;
        }
        final int targetLimit = Math.max(1, Math.min(MAX_LIMIT, requestedLimit));
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
                    callback.onError("Authenticated source load timed out");
                }
            };
            main.postDelayed(timeout, TIMEOUT_MS);

            final Runnable[] extractionRunner = new Runnable[1];
            extractionRunner[0] = () -> {
                if (finished.get()) return;
                attempts[0]++;
                webView.evaluateJavascript(extractionScript(targetLimit), value -> {
                    if (finished.get()) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        String json = decoded instanceof String ? (String) decoded : value;
                        JSONObject result = new JSONObject(json);
                        JSONObject source = result.optJSONObject("source");
                        String sourceUrl = source == null ? "" : source.optString("url", "");
                        String displayName = source == null ? "" : source.optString("displayName", "");
                        String externalId = source == null ? "" : source.optString("externalId", "");
                        JSONArray posts = result.optJSONArray("posts");
                        int postCount = posts == null ? 0 : posts.length();
                        boolean reliableSource = !result.has("error") && source != null &&
                            isAllowedSocialUrl(sourceUrl) && !isBlank(displayName) && !isBlank(externalId);

                        if (reliableSource && (postCount >= targetLimit || attempts[0] >= MAX_EXTRACTION_ATTEMPTS)) {
                            finishSuccess(main, timeout, webView, finished, callback, result);
                            return;
                        }

                        if (attempts[0] < MAX_EXTRACTION_ATTEMPTS) {
                            if (reliableSource) {
                                // Meta feeds are lazy/infinite. Scroll only inside the user's own WebView
                                // and re-read the DOM until the requested number of real posts is present.
                                webView.evaluateJavascript(
                                    "(() => { const h=Math.max(window.innerHeight||700,700); window.scrollBy(0,Math.round(h*1.65)); return window.scrollY; })()",
                                    ignored -> main.postDelayed(extractionRunner[0], RETRY_DELAY_MS)
                                );
                            } else {
                                main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);
                            }
                            return;
                        }

                        if (reliableSource) {
                            finishSuccess(main, timeout, webView, finished, callback, result);
                            return;
                        }
                        if (!finished.compareAndSet(false, true)) return;
                        main.removeCallbacks(timeout);
                        destroy(webView);
                        callback.onError("Could not resolve reliable source metadata from this page");
                    } catch (Exception error) {
                        if (attempts[0] < MAX_EXTRACTION_ATTEMPTS) {
                            main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);
                            return;
                        }
                        if (!finished.compareAndSet(false, true)) return;
                        main.removeCallbacks(timeout);
                        destroy(webView);
                        callback.onError("Could not parse authenticated page content");
                    }
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
                    return !isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageCommitVisible(WebView view, String loadedUrl) {
                    super.onPageCommitVisible(view, loadedUrl);
                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;
                    scheduleExtraction(FIRST_EXTRACTION_DELAY_MS);
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    super.onPageFinished(view, loadedUrl);
                    if (!isAllowedSocialUrl(loadedUrl) || finished.get()) return;
                    scheduleExtraction(120);
                }
            });

            webView.loadUrl(preferMobileFacebookUrl(url));
        });
    }

    private static void finishSuccess(
        Handler main,
        Runnable timeout,
        WebView webView,
        AtomicBoolean finished,
        Callback callback,
        JSONObject result
    ) {
        if (!finished.compareAndSet(false, true)) return;
        main.removeCallbacks(timeout);
        destroy(webView);
        callback.onSuccess(result);
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

    private static String extractionScript(int limit) {
        return "(() => {" +
            "const LIMIT=" + limit + ";" +
            "const abs=(u)=>{try{return new URL(u,location.href).href}catch(e){return ''}};" +
            "const allowed=(u)=>{try{const x=new URL(u);const h=x.hostname.toLowerCase();return (x.protocol==='https:'||x.protocol==='http:')&&(h==='facebook.com'||h.endsWith('.facebook.com')||h==='fb.com'||h.endsWith('.fb.com')||h==='fb.watch'||h==='instagram.com'||h.endsWith('.instagram.com')||h==='instagr.am'||h.endsWith('.instagr.am'))}catch(e){return false}};" +
            "const postId=(u)=>{try{const x=new URL(u);const q=x.searchParams.get('story_fbid')||x.searchParams.get('fbid')||x.searchParams.get('v');if(q)return q;const m=x.pathname.match(/(?:posts|permalink|reel|reels|p|videos|share\\/(?:p|r|v))\\/([^/?#]+)/i);return m?.[1]||''}catch(e){return ''}};" +
            "const isPostUrl=(u)=>{if(!allowed(u))return false;try{const x=new URL(u);const p=x.pathname.toLowerCase();return /\\/(posts|permalink|reel|reels|p|videos)(?:\\/|$)/i.test(p)||/\\/(story|permalink|photo)\\.php$/i.test(p)||/\\/share\\/(p|r|v)\\//i.test(p)||(p.includes('/watch')&&x.searchParams.has('v'))||x.searchParams.has('story_fbid')||x.searchParams.has('fbid')}catch(e){return false}};" +
            "const current=abs(location.href);const canonicalCandidate=abs(document.querySelector('link[rel=canonical]')?.href||'');" +
            "const sourceUrl=allowed(canonicalCandidate)?canonicalCandidate:(allowed(current)?current:'');" +
            "if(!sourceUrl)return JSON.stringify({error:'SOURCE_URL_UNAVAILABLE',source:null,posts:[]});" +
            "const u=new URL(sourceUrl);const host=u.hostname.toLowerCase();const platform=(host.includes('instagram')||host.includes('instagr.am'))?'instagram':'facebook';" +
            "const parts=u.pathname.split('/').filter(Boolean).map(v=>{try{return decodeURIComponent(v)}catch(e){return v}});" +
            "const generic=new Set(['profile.php','groups','posts','permalink','permalink.php','reel','reels','p','watch','share','photo','photo.php','photos','story.php','videos','login','checkpoint','recover','help','privacy','settings']);" +
            "const first=(parts[0]||'').trim();let handle='';" +
            "if(first.toLowerCase()==='profile.php')handle=(u.searchParams.get('id')||'').trim();else if(first.toLowerCase()==='groups'&&parts[1])handle=parts[1].replace(/^@/,'');else if(first&&!generic.has(first.toLowerCase()))handle=first.replace(/^@/,'');else handle=(u.searchParams.get('id')||'').trim();" +
            "if(!handle){const authorHref=[...document.querySelectorAll('a[href]')].map(a=>abs(a.getAttribute('href')||'')).find(h=>{try{if(!allowed(h)||isPostUrl(h))return false;const x=new URL(h);const p=x.pathname.split('/').filter(Boolean)[0]||'';return p&&!generic.has(p.toLowerCase())}catch(e){return false}});if(authorHref){try{handle=(new URL(authorHref).pathname.split('/').filter(Boolean)[0]||'').replace(/^@/,'')}catch(e){}}}" +
            "const externalId=(u.searchParams.get('id')||handle||'').trim();" +
            "const cleanTitle=(s)=>String(s||'').replace(/\\s*[|·-]\\s*Facebook\\s*$/i,'').replace(/\\s*[|·-]\\s*Instagram\\s*$/i,'').replace(/\\s*[•|·-]\\s*Instagram photos and videos\\s*$/i,'').trim();" +
            "const headings=[document.querySelector('main h1'),document.querySelector('[role=\\\"main\\\"] h1'),document.querySelector('h1')].filter(Boolean);" +
            "const titleCandidates=[document.querySelector('meta[property=\\\"og:title\\\"]')?.content,...headings.map(x=>x.innerText),document.querySelector('main strong[dir=\\\"auto\\\"]')?.innerText,document.querySelector('[role=\\\"main\\\"] strong[dir=\\\"auto\\\"]')?.innerText,document.title].map(cleanTitle).filter(Boolean);" +
            "const title=titleCandidates.find(v=>!['facebook','instagram','blank','log into facebook','log in to facebook'].includes(v.toLowerCase()))||(handle?('@'+handle):'');" +
            "const imageScore=(img)=>{if(!img)return -999;const src=abs(img.getAttribute('src')||img.src||'');if(!/^https?:/i.test(src))return -999;const alt=((img.getAttribute('alt')||'')+' '+(img.getAttribute('aria-label')||'')).toLowerCase();let score=0;if(title&&alt.includes(title.toLowerCase()))score+=8;if(handle&&alt.includes(handle.toLowerCase()))score+=6;if(/profile|avatar|صورة الملف|الصورة الشخصية/i.test(alt))score+=5;if(/cover|غلاف/i.test(alt))score-=5;const w=Number(img.getAttribute('width')||img.width||0),h=Number(img.getAttribute('height')||img.height||0);if(w&&h&&Math.abs(w-h)<Math.max(w,h)*0.2)score+=3;if(w>700||h>700)score-=2;return score};" +
            "const main=document.querySelector('main')||document.querySelector('[role=\\\"main\\\"]')||document.body;const nearby=[...(main?.querySelectorAll?.('img[src]')||[])].slice(0,50);nearby.sort((a,b)=>imageScore(b)-imageScore(a));" +
            "const image=abs(document.querySelector('meta[property=\\\"og:image\\\"]')?.content||document.querySelector('meta[name=\\\"twitter:image\\\"]')?.content||nearby[0]?.getAttribute('src')||nearby[0]?.src||'');" +
            "const description=(document.querySelector('meta[property=\\\"og:description\\\"]')?.content||document.querySelector('meta[name=\\\"description\\\"]')?.content||'').trim();" +
            "if(!externalId||!title)return JSON.stringify({error:'SOURCE_METADATA_UNAVAILABLE',source:{platform,externalId,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts:[]});" +
            "const seen=new Set();const posts=[];let feedIndex=0;" +
            "const textFor=(node,anchor)=>{let t=((node&&node.innerText)||'').trim();if(t.length>=3)return t;const alts=[...(node?.querySelectorAll?.('img[alt]')||[])].map(x=>(x.getAttribute('alt')||'').trim()).filter(Boolean);t=alts.join(' ').trim();if(t.length>=3)return t;return ((anchor?.getAttribute?.('aria-label')||anchor?.innerText||'')+'').trim()};" +
            "const addPost=(node,anchor,link)=>{if(posts.length>=Math.max(LIMIT*3,30)||!link||!isPostUrl(link))return;const id=postId(link);const key=id||link.replace(/([?&])(fbclid|__cft__|__tn__|ref|refid)=[^&#]*/gi,'$1');if(seen.has(key))return;const text=textFor(node,anchor);if(text.length<3)return;seen.add(key);const pinned=/Pinned post|Pinned|منشور\\s+مثب|مثبت/i.test(text);const time=node?.querySelector?.('time,[data-utime]');let publishedAt=time?.getAttribute?.('datetime')||time?.dateTime||null;const unix=time?.getAttribute?.('data-utime');if(!publishedAt&&unix&&/^\\d+$/.test(unix)){try{publishedAt=new Date(Number(unix)*1000).toISOString()}catch(e){}}const media=[];const mediaSeen=new Set();for(const img of [...(node?.querySelectorAll?.('img[src]')||[])].slice(0,10)){const src=abs(img.getAttribute('src')||img.src||'');if(src&&/^https?:/i.test(src)&&src!==image&&!mediaSeen.has(src)){mediaSeen.add(src);media.push({type:'image',url:src})}}for(const video of [...(node?.querySelectorAll?.('video[src]')||[])].slice(0,3)){const src=abs(video.getAttribute('src')||video.src||'');if(src&&/^https?:/i.test(src)&&!mediaSeen.has(src)){mediaSeen.add(src);media.push({type:'video',url:src})}}posts.push({externalPostId:id||null,originalUrl:link,authorName:title,authorAvatar:image||null,text:text.slice(0,100000),media,publishedAt,metadata:{collector:'android_webview',feedIndex:feedIndex++,pinned}})};" +
            "const containers=[...document.querySelectorAll('[role=\\\"article\\\"],article,[data-pagelet*=\\\"FeedUnit\\\"],[data-pagelet*=\\\"ProfileTimeline\\\"]')];" +
            "for(const node of containers){const anchors=[...node.querySelectorAll('a[href]')];const anchor=anchors.find(a=>isPostUrl(abs(a.getAttribute('href')||'')));if(anchor)addPost(node,anchor,abs(anchor.getAttribute('href')||''))}" +
            "const anchors=[...document.querySelectorAll('a[href]')];for(const anchor of anchors){const link=abs(anchor.getAttribute('href')||'');if(!isPostUrl(link))continue;let node=anchor.closest('[role=\\\"article\\\"],article,[data-pagelet*=\\\"FeedUnit\\\"],[data-pagelet*=\\\"ProfileTimeline\\\"]');if(!node){let n=anchor;for(let i=0;i<10&&n;i++,n=n.parentElement){const txt=(n.innerText||'').trim();const alt=n.querySelector?.('img[alt]')?.getAttribute?.('alt')||'';if((txt.length>=3&&txt.length<=100000)||alt.length>=3){node=n;if(n.querySelector?.('time,[data-utime]')||txt.length>=20||alt.length>=20)break}}}addPost(node||anchor.parentElement,anchor,link)}" +
            "posts.sort((a,b)=>{const ap=Boolean(a.metadata?.pinned),bp=Boolean(b.metadata?.pinned);if(ap!==bp)return ap?1:-1;const at=Date.parse(a.publishedAt||'')||0,bt=Date.parse(b.publishedAt||'')||0;if(at&&bt&&at!==bt)return bt-at;return Number(a.metadata?.feedIndex||0)-Number(b.metadata?.feedIndex||0)});" +
            "return JSON.stringify({source:{platform,externalId,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts:posts.slice(0,LIMIT)});" +
          "})()";
    }
}
