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
 * native bridge. The collector intentionally reads only content the user's authenticated
 * WebView can legitimately render; it does not bypass access controls or challenge pages.
 */
final class AuthenticatedWebCollector {
    interface Callback {
        void onSuccess(JSONObject result);
        void onError(String message);
    }

    private static final long TIMEOUT_MS = 12_000;
    private static final long FIRST_EXTRACTION_DELAY_MS = 300;
    private static final long RETRY_DELAY_MS = 450;
    private static final int MAX_EXTRACTION_ATTEMPTS = 7;

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
                webView.evaluateJavascript(extractionScript(), value -> {
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

                        boolean reliableSource = !result.has("error") && source != null &&
                            isAllowedSocialUrl(sourceUrl) && !isBlank(displayName) && !isBlank(externalId);
                        boolean hasPosts = posts != null && posts.length() > 0;

                        if (reliableSource && hasPosts) {
                            if (!finished.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            destroy(webView);
                            callback.onSuccess(result);
                            return;
                        }

                        if (attempts[0] < MAX_EXTRACTION_ATTEMPTS) {
                            main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);
                            return;
                        }

                        if (reliableSource) {
                            // Preserve useful source metadata even when the current page exposes no
                            // recognizable post permalink. Callers can surface an honest empty scan.
                            if (!finished.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            destroy(webView);
                            callback.onSuccess(result);
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
                    scheduleExtraction(100);
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

    private static String extractionScript() {
        return "(() => {" +
            "const abs=(u)=>{try{return new URL(u,location.href).href}catch(e){return ''}};" +
            "const allowed=(u)=>{try{const x=new URL(u);const h=x.hostname.toLowerCase();return (x.protocol==='https:'||x.protocol==='http:')&&(h==='facebook.com'||h.endsWith('.facebook.com')||h==='fb.com'||h.endsWith('.fb.com')||h==='fb.watch'||h==='instagram.com'||h.endsWith('.instagram.com')||h==='instagr.am'||h.endsWith('.instagr.am'))}catch(e){return false}};" +
            "const postId=(u)=>{try{const x=new URL(u);const q=x.searchParams.get('story_fbid')||x.searchParams.get('fbid')||x.searchParams.get('v');if(q)return q;const m=x.pathname.match(/(?:posts|permalink|reel|reels|p|videos|share\\/(?:p|r|v))\\/([^/?#]+)/i);return m?.[1]||''}catch(e){return ''}};" +
            "const isPostUrl=(u)=>{if(!allowed(u))return false;try{const x=new URL(u);const p=x.pathname.toLowerCase();return /\\/(posts|permalink|reel|reels|p|videos)(?:\\/|$)/i.test(p)||/\\/(story|permalink|photo)\\.php$/i.test(p)||/\\/share\\/(p|r|v)\\//i.test(p)||(p.includes('/watch')&&x.searchParams.has('v'))||x.searchParams.has('story_fbid')||x.searchParams.has('fbid')}catch(e){return false}};" +
            "const current=abs(location.href);" +
            "const canonicalCandidate=abs(document.querySelector('link[rel=canonical]')?.href||'');" +
            "const sourceUrl=allowed(canonicalCandidate)?canonicalCandidate:(allowed(current)?current:'');" +
            "if(!sourceUrl)return JSON.stringify({error:'SOURCE_URL_UNAVAILABLE',source:null,posts:[]});" +
            "const u=new URL(sourceUrl);" +
            "const host=u.hostname.toLowerCase();" +
            "const platform=(host.includes('instagram')||host.includes('instagr.am'))?'instagram':'facebook';" +
            "const parts=u.pathname.split('/').filter(Boolean).map(v=>{try{return decodeURIComponent(v)}catch(e){return v}});" +
            "const generic=new Set(['profile.php','groups','posts','permalink','permalink.php','reel','reels','p','watch','share','photo','photo.php','photos','story.php','videos','login','checkpoint','recover','help','privacy','settings']);" +
            "const first=(parts[0]||'').trim();" +
            "let handle='';" +
            "if(first.toLowerCase()==='profile.php')handle=(u.searchParams.get('id')||'').trim();" +
            "else if(first.toLowerCase()==='groups'&&parts[1])handle=parts[1].replace(/^@/,'');" +
            "else if(first&&!generic.has(first.toLowerCase()))handle=first.replace(/^@/,'');" +
            "else handle=(u.searchParams.get('id')||'').trim();" +
            "if(!handle){const authorHref=[...document.querySelectorAll('a[href]')].map(a=>abs(a.getAttribute('href')||'')).find(h=>{try{if(!allowed(h)||isPostUrl(h))return false;const x=new URL(h);const p=x.pathname.split('/').filter(Boolean)[0]||'';return p&&!generic.has(p.toLowerCase())}catch(e){return false}});if(authorHref){try{handle=(new URL(authorHref).pathname.split('/').filter(Boolean)[0]||'').replace(/^@/,'')}catch(e){}}}" +
            "const externalId=(u.searchParams.get('id')||handle||'').trim();" +
            "const cleanTitle=(s)=>String(s||'').replace(/\\s*[|·-]\\s*Facebook\\s*$/i,'').replace(/\\s*[|·-]\\s*Instagram\\s*$/i,'').trim();" +
            "const headings=[document.querySelector('main h1'),document.querySelector('[role=\\\"main\\\"] h1'),document.querySelector('h1')].filter(Boolean);" +
            "const titleCandidates=[document.querySelector('meta[property=\\\"og:title\\\"]')?.content,...headings.map(x=>x.innerText),document.querySelector('main strong[dir=\\\"auto\\\"]')?.innerText,document.querySelector('[role=\\\"main\\\"] strong[dir=\\\"auto\\\"]')?.innerText,document.title].map(cleanTitle).filter(Boolean);" +
            "const title=titleCandidates.find(v=>!['facebook','instagram','blank','log into facebook','log in to facebook'].includes(v.toLowerCase()))||(handle?('@'+handle):'');" +
            "const imageScore=(img)=>{if(!img)return -999;const src=abs(img.getAttribute('src')||img.src||'');if(!/^https?:/i.test(src))return -999;const alt=((img.getAttribute('alt')||'')+' '+(img.getAttribute('aria-label')||'')).toLowerCase();let score=0;if(title&&alt.includes(title.toLowerCase()))score+=8;if(handle&&alt.includes(handle.toLowerCase()))score+=6;if(/profile|avatar|صورة الملف|الصورة الشخصية/i.test(alt))score+=5;if(/cover|غلاف/i.test(alt))score-=5;const w=Number(img.getAttribute('width')||img.width||0),h=Number(img.getAttribute('height')||img.height||0);if(w&&h&&Math.abs(w-h)<Math.max(w,h)*0.2)score+=3;if(w>500||h>500)score-=2;return score};" +
            "const nearby=[...new Set([...headings.flatMap(h=>[...(h.parentElement?.parentElement?.querySelectorAll?.('img[src]')||[])]),...[...(document.querySelector('main')?.querySelectorAll?.('img[src]')||[])].slice(0,20),...[...(document.querySelector('[role=\\\"main\\\"]')?.querySelectorAll?.('img[src]')||[])].slice(0,20)])];" +
            "nearby.sort((a,b)=>imageScore(b)-imageScore(a));" +
            "const image=abs(document.querySelector('meta[property=\\\"og:image\\\"]')?.content||nearby[0]?.getAttribute('src')||nearby[0]?.src||'');" +
            "const description=(document.querySelector('meta[property=\\\"og:description\\\"]')?.content||document.querySelector('meta[name=\\\"description\\\"]')?.content||'').trim();" +
            "if(!externalId||!title)return JSON.stringify({error:'SOURCE_METADATA_UNAVAILABLE',source:{platform,externalId,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts:[]});" +
            "const seen=new Set();const posts=[];let chronologicalIndex=0;" +
            "const addPost=(node,link)=>{if(posts.length>=30||!link||!isPostUrl(link))return;const id=postId(link);const key=id||link.replace(/([?&])(fbclid|__cft__|__tn__|ref|refid)=[^&#]*/gi,'$1');if(seen.has(key))return;const text=((node&&node.innerText)||'').trim();if(text.length<5)return;seen.add(key);const pinned=/Pinned post|Pinned|منشور\\s+مثب|مثبت/i.test(text);const feedIndex=pinned?-1:chronologicalIndex++;const time=node?.querySelector?.('time,[data-utime]');let publishedAt=time?.getAttribute?.('datetime')||time?.dateTime||null;const unix=time?.getAttribute?.('data-utime');if(!publishedAt&&unix&&/^\\d+$/.test(unix)){try{publishedAt=new Date(Number(unix)*1000).toISOString()}catch(e){}}const media=[];for(const img of [...(node?.querySelectorAll?.('img[src]')||[])].slice(0,8)){const src=abs(img.getAttribute('src')||img.src||'');if(src&&/^https?:/i.test(src)&&src!==image)media.push({type:'image',url:src})}for(const video of [...(node?.querySelectorAll?.('video[src]')||[])].slice(0,3)){const src=abs(video.getAttribute('src')||video.src||'');if(src&&/^https?:/i.test(src))media.push({type:'video',url:src})}posts.push({externalPostId:id||null,originalUrl:link,authorName:title,authorAvatar:image||null,text:text.slice(0,100000),media,publishedAt,metadata:{collector:'android_webview',feedIndex,pinned}})};" +
            "const containers=[...document.querySelectorAll('[role=\\\"article\\\"],article,[data-pagelet*=\\\"FeedUnit\\\"],[data-pagelet*=\\\"ProfileTimeline\\\"]')];" +
            "for(const node of containers){if(posts.length>=30)break;const links=[...node.querySelectorAll('a[href]')].map(a=>abs(a.getAttribute('href')||'')).filter(isPostUrl);addPost(node,links[0]||'')}" +
            "if(posts.length===0){const anchors=[...document.querySelectorAll('a[href]')];for(const anchor of anchors){if(posts.length>=30)break;const link=abs(anchor.getAttribute('href')||'');if(!isPostUrl(link))continue;let node=anchor.closest('[role=\\\"article\\\"],article,[data-pagelet*=\\\"FeedUnit\\\"]');if(!node){let n=anchor;for(let i=0;i<9&&n;i++,n=n.parentElement){const txt=(n.innerText||'').trim();if(txt.length>=5&&txt.length<=40000){node=n;const hasTime=Boolean(n.querySelector?.('time,[data-utime]'));if(hasTime||txt.length>=20)break}}}addPost(node||anchor.parentElement,link)}}" +
            "return JSON.stringify({source:{platform,externalId,url:sourceUrl,displayName:title,handle,avatarUrl:image||'',bio:description||'',visibilityType:'authenticated'},posts});" +
          "})()";
    }
}
