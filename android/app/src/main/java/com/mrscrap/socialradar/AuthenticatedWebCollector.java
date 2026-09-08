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

    private static final long TIMEOUT_MS = 30_000;
    private static final long FIRST_EXTRACTION_DELAY_MS = 450;
    private static final long RETRY_DELAY_MS = 750;
    private static final int SURFACE_FALLBACK_ATTEMPT = 4;
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
        final String desktopUrl = preferDesktopFacebookUrl(url);
        final String mobileUrl = preferMobileFacebookUrl(url);
        final String basicFallbackUrl = preferBasicFacebookUrl(url);
        Handler main = new Handler(Looper.getMainLooper());

        main.post(() -> {
            AtomicBoolean finished = new AtomicBoolean(false);
            int[] attempts = new int[] { 0 };
            boolean[] triedMobileFallback = new boolean[] { false };
            boolean[] triedBasicFallback = new boolean[] { false };

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

            // Detached WebViews can otherwise have a zero-sized viewport. Meta feeds lazily render
            // based on viewport/scroll state, so give the headless collector a real layout.
            int viewportWidth = Math.max(360, context.getResources().getDisplayMetrics().widthPixels);
            int viewportHeight = Math.max(740, context.getResources().getDisplayMetrics().heightPixels);
            webView.measure(
                View.MeasureSpec.makeMeasureSpec(viewportWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(viewportHeight, View.MeasureSpec.EXACTLY)
            );
            webView.layout(0, 0, viewportWidth, viewportHeight);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);

            final Runnable[] timeoutHolder = new Runnable[1];
            timeoutHolder[0] = () -> finishError(main, null, webView, finished, callback, "Authenticated source load timed out");
            main.postDelayed(timeoutHolder[0], TIMEOUT_MS);

            final Runnable[] extractionRunner = new Runnable[1];
            extractionRunner[0] = () -> {
                if (finished.get()) return;
                attempts[0]++;

                webView.evaluateJavascript(extractionScript(url, targetLimit), value -> {
                    if (finished.get()) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        String json = decoded instanceof String ? (String) decoded : value;
                        JSONObject result = new JSONObject(json);
                        String errorCode = result.optString("error", "");

                        if ("SESSION_REQUIRED".equals(errorCode) || "SESSION_CHECKPOINT".equals(errorCode)) {
                            finishError(main, timeoutHolder[0], webView, finished, callback, errorCode);
                            return;
                        }

                        JSONObject source = result.optJSONObject("source");
                        String sourceUrl = source == null ? "" : source.optString("url", "");
                        String displayName = source == null ? "" : source.optString("displayName", "");
                        String externalId = source == null ? "" : source.optString("externalId", "");
                        JSONArray posts = result.optJSONArray("posts");
                        int postCount = posts == null ? 0 : posts.length();
                        boolean reliableSource = errorCode.isBlank() && source != null &&
                            isAllowedSocialUrl(sourceUrl) && !isBlank(displayName) && !isBlank(externalId);

                        if (reliableSource && postCount >= targetLimit) {
                            finishSuccess(main, timeoutHolder[0], webView, finished, callback, result);
                            return;
                        }

                        if (postCount == 0 && attempts[0] >= SURFACE_FALLBACK_ATTEMPT) {
                            if (!triedMobileFallback[0] && mobileUrl != null && !mobileUrl.equals(desktopUrl)) {
                                triedMobileFallback[0] = true;
                                attempts[0] = 0;
                                webView.loadUrl(mobileUrl);
                                return;
                            }
                            if (!triedBasicFallback[0] && basicFallbackUrl != null &&
                                !basicFallbackUrl.equals(desktopUrl) && !basicFallbackUrl.equals(mobileUrl)) {
                                triedBasicFallback[0] = true;
                                attempts[0] = 0;
                                webView.loadUrl(basicFallbackUrl);
                                return;
                            }
                        }

                        if (attempts[0] < MAX_EXTRACTION_ATTEMPTS) {
                            if (reliableSource) {
                                webView.evaluateJavascript(
                                    "(() => { const h=Math.max(window.innerHeight||700,700); const max=Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0); window.scrollBy(0,Math.round(h*1.7)); if(window.scrollY+h>=max-80) window.scrollTo(0,max); return window.scrollY; })()",
                                    ignored -> main.postDelayed(extractionRunner[0], RETRY_DELAY_MS)
                                );
                            } else {
                                main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);
                            }
                            return;
                        }

                        if (reliableSource) {
                            if (postCount == 0 && !result.optBoolean("explicitEmptyState", false)) {
                                finishError(main, timeoutHolder[0], webView, finished, callback, noPostsDiagnostic(result));
                            } else {
                                finishSuccess(main, timeoutHolder[0], webView, finished, callback, result);
                            }
                            return;
                        }

                        finishError(
                            main,
                            timeoutHolder[0],
                            webView,
                            finished,
                            callback,
                            errorCode.isBlank() ? "Could not resolve reliable source metadata from this page" : errorCode
                        );
                    } catch (Exception error) {
                        if (attempts[0] < MAX_EXTRACTION_ATTEMPTS) {
                            main.postDelayed(extractionRunner[0], RETRY_DELAY_MS);
                            return;
                        }
                        finishError(main, timeoutHolder[0], webView, finished, callback, "Could not parse authenticated page content");
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
                    scheduleExtraction(180);
                }
            });

            webView.loadUrl(desktopUrl);
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
        if (timeout != null) main.removeCallbacks(timeout);
        destroy(webView);
        callback.onSuccess(result);
    }

    private static void finishError(
        Handler main,
        Runnable timeout,
        WebView webView,
        AtomicBoolean finished,
        Callback callback,
        String message
    ) {
        if (!finished.compareAndSet(false, true)) return;
        if (timeout != null) main.removeCallbacks(timeout);
        destroy(webView);
        callback.onError(message);
    }

    private static String noPostsDiagnostic(JSONObject result) {
        JSONObject diagnostics = result.optJSONObject("diagnostics");
        if (diagnostics == null) return "NO_EXTRACTABLE_POSTS";
        String surface = diagnostics.optString("surface", "meta").replace("|", "").replace("=", "");
        int containers = diagnostics.optInt("containers", 0);
        int anchors = diagnostics.optInt("anchors", 0);
        int postLinks = diagnostics.optInt("postLinks", 0);
        int bodyTextLength = diagnostics.optInt("bodyTextLength", 0);
        return "NO_EXTRACTABLE_POSTS|surface=" + surface +
            "|containers=" + containers +
            "|anchors=" + anchors +
            "|postLinks=" + postLinks +
            "|body=" + bodyTextLength;
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

    private static String preferBasicFacebookUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null) return null;
            String normalized = host.toLowerCase();
            boolean facebook = normalized.equals("facebook.com") || normalized.endsWith(".facebook.com");
            if (!facebook || normalized.equals("fb.watch")) return null;
            return uri.buildUpon().authority("mbasic.facebook.com").build().toString();
        } catch (Exception ignored) {
            return null;
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
                android.view.ViewParent parent = webView.getParent();
                if (parent instanceof android.view.ViewGroup) ((android.view.ViewGroup) parent).removeView(webView);
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        });
    }

    private static String extractionScript(String requestedUrl, int limit) {
        String requested = JSONObject.quote(requestedUrl);
        return """
            (() => {
              const LIMIT = __LIMIT__;
              const requested = __REQUESTED__;
              const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ''; } };
              const allowed = (u) => {
                try {
                  const x = new URL(u);
                  const h = x.hostname.toLowerCase();
                  return (x.protocol === 'https:' || x.protocol === 'http:') && (
                    h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.com' || h.endsWith('.fb.com') || h === 'fb.watch' ||
                    h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'instagr.am' || h.endsWith('.instagr.am')
                  );
                } catch (e) { return false; }
              };
              const blocked = (u) => {
                try {
                  const p = new URL(u).pathname.toLowerCase();
                  return p.includes('/login') || p.includes('/checkpoint') || p.includes('/recover');
                } catch (e) { return true; }
              };
              const rawLink = (a) => a?.getAttribute?.('href') || a?.getAttribute?.('data-href') || a?.getAttribute?.('data-url') || a?.getAttribute?.('ajaxify') || '';
              const normalizeLink = (raw) => {
                let full = abs(raw);
                if (!full) return '';
                try {
                  const x = new URL(full);
                  const wrapped = x.searchParams.get('u');
                  if ((x.pathname === '/l.php' || x.hostname.toLowerCase() === 'l.facebook.com' || x.hostname.toLowerCase() === 'lm.facebook.com') && wrapped) {
                    const inner = abs(wrapped);
                    if (allowed(inner)) full = inner;
                  }
                } catch (e) {}
                return full;
              };
              const postId = (u) => {
                try {
                  const x = new URL(u);
                  const fromQuery = x.searchParams.get('story_fbid') || x.searchParams.get('fbid') || x.searchParams.get('v');
                  if (fromQuery) return fromQuery;
                  const parts = x.pathname.split('/').filter(Boolean);
                  const markers = ['posts','permalink','reel','reels','p','tv','videos'];
                  for (let i = 0; i < parts.length - 1; i++) {
                    if (markers.includes(parts[i].toLowerCase())) return parts[i + 1];
                  }
                  if (parts[0] === 'share' && parts.length >= 3) return parts[2];
                  return '';
                } catch (e) { return ''; }
              };
              const isPostUrl = (u) => {
                if (!allowed(u)) return false;
                try {
                  const x = new URL(u);
                  const p = x.pathname.toLowerCase();
                  const parts = p.split('/').filter(Boolean);
                  const markers = ['posts','permalink','reel','reels','p','tv','videos'];
                  const pathMatch = parts.some((part, index) => markers.includes(part) && index < parts.length - 1);
                  const scriptMatch = p.endsWith('/story.php') || p.endsWith('/permalink.php') || p.endsWith('/photo.php') || p.endsWith('/photo');
                  const shareMatch = parts[0] === 'share' && ['p','r','v'].includes(parts[1] || '') && Boolean(parts[2]);
                  return pathMatch || scriptMatch || shareMatch ||
                    (p.includes('/watch') && x.searchParams.has('v')) ||
                    x.searchParams.has('story_fbid') || x.searchParams.has('fbid');
                } catch (e) { return false; }
              };

              const current = abs(location.href);
              const currentPath = (() => { try { return new URL(current).pathname.toLowerCase(); } catch (e) { return ''; } })();
              const checkpoint = currentPath.includes('/checkpoint');
              const loginForm = Boolean(document.querySelector('form[action*="login"], input[name="email"], input[name="pass"]'));
              if (checkpoint) return JSON.stringify({ error: 'SESSION_CHECKPOINT', diagnostics: { surface: location.hostname, path: currentPath } });
              if (blocked(current) || loginForm) return JSON.stringify({ error: 'SESSION_REQUIRED', diagnostics: { surface: location.hostname, path: currentPath } });

              const canonicalCandidate = abs(document.querySelector('link[rel="canonical"]')?.href || '');
              const identityUrl = allowed(requested) && !blocked(requested)
                ? requested
                : ((allowed(canonicalCandidate) && !blocked(canonicalCandidate)) ? canonicalCandidate : current);
              if (!allowed(identityUrl) || blocked(identityUrl)) {
                return JSON.stringify({ error: 'SOURCE_URL_UNAVAILABLE', diagnostics: { surface: location.hostname, path: currentPath } });
              }

              const u = new URL(identityUrl);
              const host = u.hostname.toLowerCase();
              const platform = (host.includes('instagram') || host.includes('instagr.am')) ? 'instagram' : 'facebook';
              const parts = u.pathname.split('/').filter(Boolean).map(v => { try { return decodeURIComponent(v); } catch (e) { return v; } });
              const generic = new Set(['profile.php','groups','posts','permalink','permalink.php','reel','reels','p','tv','watch','share','photo','photo.php','photos','story.php','videos','login','checkpoint','recover','help','privacy','settings','accounts','explore']);
              const first = (parts[0] || '').trim();
              let handle = '';
              if (first.toLowerCase() === 'profile.php') handle = (u.searchParams.get('id') || '').trim();
              else if (first.toLowerCase() === 'groups' && parts[1]) handle = parts[1].replace('@', '');
              else if (first && !generic.has(first.toLowerCase())) handle = first.replace('@', '');
              else handle = (u.searchParams.get('id') || '').trim();

              if (!handle) {
                const authorHref = [...document.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')]
                  .map(a => normalizeLink(rawLink(a)))
                  .find(h => {
                    try {
                      if (!allowed(h) || isPostUrl(h) || blocked(h)) return false;
                      const x = new URL(h);
                      const ps = x.pathname.split('/').filter(Boolean);
                      const p = ps[0] || '';
                      return ps.length === 1 && p && !generic.has(p.toLowerCase());
                    } catch (e) { return false; }
                  });
                if (authorHref) {
                  try { handle = (new URL(authorHref).pathname.split('/').filter(Boolean)[0] || '').replace('@', ''); } catch (e) {}
                }
              }

              const externalId = (u.searchParams.get('id') || handle || '').trim();
              const cleanTitle = (s) => {
                let value = String(s || '').trim();
                for (const suffix of [' | Facebook',' · Facebook',' - Facebook',' | Instagram',' · Instagram',' - Instagram',' • Instagram photos and videos']) {
                  if (value.toLowerCase().endsWith(suffix.toLowerCase())) value = value.slice(0, -suffix.length).trim();
                }
                return value;
              };
              const headings = [document.querySelector('main h1'), document.querySelector('[role="main"] h1'), document.querySelector('header h1'), document.querySelector('h1')].filter(Boolean);
              const titleCandidates = [
                document.querySelector('meta[property="og:title"]')?.content,
                document.querySelector('meta[name="twitter:title"]')?.content,
                ...headings.map(x => x.innerText),
                document.querySelector('main strong[dir="auto"]')?.innerText,
                document.querySelector('[role="main"] strong[dir="auto"]')?.innerText,
                document.title
              ].map(cleanTitle).filter(Boolean);
              const title = titleCandidates.find(v => !['facebook','instagram','blank','log into facebook','log in to facebook'].includes(v.toLowerCase())) || (handle ? ('@' + handle) : '');

              const imgSrc = (img) => {
                if (!img) return '';
                const direct = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
                if (direct) return abs(direct);
                const set = img.getAttribute('srcset') || '';
                if (!set) return '';
                const firstItem = set.split(',')[0].trim().split(' ')[0];
                return abs(firstItem);
              };
              const imageScore = (img) => {
                if (!img) return -999;
                const src = imgSrc(img);
                if (!(src.startsWith('http://') || src.startsWith('https://'))) return -999;
                const alt = ((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('aria-label') || '')).toLowerCase();
                let score = 0;
                if (title && alt.includes(title.toLowerCase())) score += 8;
                if (handle && alt.includes(handle.toLowerCase())) score += 6;
                if (alt.includes('profile') || alt.includes('avatar') || alt.includes('صورة الملف') || alt.includes('الصورة الشخصية')) score += 6;
                if (alt.includes('cover') || alt.includes('غلاف')) score -= 6;
                if (src.includes('fbcdn') || src.includes('scontent') || src.includes('cdninstagram')) score += 2;
                const r = img.getBoundingClientRect?.();
                const w = Number(img.naturalWidth || img.width || r?.width || 0);
                const h = Number(img.naturalHeight || img.height || r?.height || 0);
                if (w && h && Math.abs(w - h) < Math.max(w, h) * 0.2) score += 3;
                if (w > 800 || h > 800) score -= 3;
                return score;
              };

              const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
              const nearby = [...(main?.querySelectorAll?.('img') || [])].slice(0, 100).filter(img => imgSrc(img));
              nearby.sort((a, b) => imageScore(b) - imageScore(a));
              const image = abs(
                document.querySelector('meta[property="og:image:secure_url"]')?.content ||
                document.querySelector('meta[property="og:image"]')?.content ||
                document.querySelector('meta[name="twitter:image"]')?.content ||
                document.querySelector('link[rel="image_src"]')?.href ||
                imgSrc(nearby[0]) || ''
              );
              const description = (document.querySelector('meta[property="og:description"]')?.content || document.querySelector('meta[name="description"]')?.content || '').trim();

              if (!externalId || !title) {
                return JSON.stringify({
                  error: 'SOURCE_METADATA_UNAVAILABLE',
                  source: { platform, externalId, url: identityUrl, displayName: title, handle, avatarUrl: image || '', bio: description || '', visibilityType: 'authenticated' },
                  posts: [],
                  diagnostics: { surface: location.hostname, path: currentPath }
                });
              }

              const seen = new Set();
              const posts = [];
              let feedIndex = 0;
              const containerSelector = '[role="article"],article,[data-pagelet*="FeedUnit"],[data-pagelet*="ProfileTimeline"],[data-testid*="post"],[data-ft*="top_level_post_id"]';
              const textFor = (node, anchor) => {
                let text = ((node && node.innerText) || '').trim();
                if (text.length >= 3) return text;
                const alts = [...(node?.querySelectorAll?.('img[alt]') || [])].map(x => (x.getAttribute('alt') || '').trim()).filter(Boolean);
                text = alts.join(' ').trim();
                if (text.length >= 3) return text;
                return ((anchor?.getAttribute?.('aria-label') || anchor?.innerText || '') + '').trim();
              };
              const canonicalPostKey = (link, id) => {
                if (id) return id;
                try {
                  const x = new URL(link);
                  for (const key of ['fbclid','__cft__','__tn__','ref','refid','mibextid']) x.searchParams.delete(key);
                  return x.toString();
                } catch (e) { return link; }
              };
              const addPost = (node, anchor, raw) => {
                if (posts.length >= Math.max(LIMIT * 3, 30)) return;
                const link = normalizeLink(raw);
                if (!link || !isPostUrl(link)) return;
                const id = postId(link);
                const key = canonicalPostKey(link, id);
                if (seen.has(key)) return;
                const text = textFor(node, anchor);
                if (text.length < 3) return;
                seen.add(key);
                const lower = text.toLowerCase();
                const pinned = lower.includes('pinned post') || lower === 'pinned' || text.includes('منشور مثبت') || text.includes('مثبت');
                const time = node?.querySelector?.('time,abbr[data-utime],[data-utime],abbr');
                let publishedAt = time?.getAttribute?.('datetime') || time?.dateTime || null;
                const unix = time?.getAttribute?.('data-utime');
                if (!publishedAt && unix && Number.isFinite(Number(unix))) {
                  try { publishedAt = new Date(Number(unix) * 1000).toISOString(); } catch (e) {}
                }
                const media = [];
                const mediaSeen = new Set();
                for (const img of [...(node?.querySelectorAll?.('img') || [])].slice(0, 12)) {
                  const src = imgSrc(img);
                  if (src && (src.startsWith('http://') || src.startsWith('https://')) && src !== image && !mediaSeen.has(src)) {
                    mediaSeen.add(src);
                    media.push({ type: 'image', url: src });
                  }
                }
                for (const video of [...(node?.querySelectorAll?.('video[src],video source[src]') || [])].slice(0, 4)) {
                  const src = abs(video.getAttribute('src') || video.src || '');
                  if (src && (src.startsWith('http://') || src.startsWith('https://')) && !mediaSeen.has(src)) {
                    mediaSeen.add(src);
                    media.push({ type: 'video', url: src });
                  }
                }
                posts.push({
                  externalPostId: id || null,
                  originalUrl: link,
                  authorName: title,
                  authorAvatar: image || null,
                  text: text.slice(0, 100000),
                  media,
                  publishedAt,
                  metadata: { collector: 'android_webview', feedIndex: feedIndex++, pinned }
                });
              };

              const containers = [...document.querySelectorAll(containerSelector)];
              for (const node of containers) {
                const candidateAnchors = [...node.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')];
                const anchor = candidateAnchors.find(a => isPostUrl(normalizeLink(rawLink(a))));
                if (anchor) addPost(node, anchor, rawLink(anchor));
              }

              const anchors = [...document.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')];
              for (const anchor of anchors) {
                const link = normalizeLink(rawLink(anchor));
                if (!isPostUrl(link)) continue;
                let node = anchor.closest(containerSelector);
                if (!node) {
                  let candidate = anchor;
                  for (let i = 0; i < 12 && candidate; i++, candidate = candidate.parentElement) {
                    const text = (candidate.innerText || '').trim();
                    const alt = candidate.querySelector?.('img[alt]')?.getAttribute?.('alt') || '';
                    if ((text.length >= 3 && text.length <= 100000) || alt.length >= 3) {
                      node = candidate;
                      if (candidate.querySelector?.('time,abbr[data-utime],[data-utime],abbr') || text.length >= 20 || alt.length >= 20) break;
                    }
                  }
                }
                addPost(node || anchor.parentElement, anchor, link);
              }

              posts.sort((a, b) => {
                const ap = Boolean(a.metadata?.pinned), bp = Boolean(b.metadata?.pinned);
                if (ap !== bp) return ap ? 1 : -1;
                const at = Date.parse(a.publishedAt || '') || 0, bt = Date.parse(b.publishedAt || '') || 0;
                if (at && bt && at !== bt) return bt - at;
                return Number(a.metadata?.feedIndex || 0) - Number(b.metadata?.feedIndex || 0);
              });

              const bodyText = (document.body?.innerText || '').trim();
              const emptyPhrases = ['No posts available','No posts yet','No posts to show','لا توجد منشورات','لا توجد أي منشورات','لم يتم نشر أي شيء'];
              const explicitEmptyState = emptyPhrases.some(phrase => bodyText.includes(phrase));
              const postLinks = anchors.reduce((count, anchor) => count + (isPostUrl(normalizeLink(rawLink(anchor))) ? 1 : 0), 0);
              return JSON.stringify({
                source: { platform, externalId, url: identityUrl, displayName: title, handle, avatarUrl: image || '', bio: description || '', visibilityType: 'authenticated' },
                posts: posts.slice(0, LIMIT),
                explicitEmptyState,
                diagnostics: {
                  surface: location.hostname,
                  path: currentPath.slice(0, 180),
                  readyState: document.readyState,
                  containers: containers.length,
                  anchors: anchors.length,
                  postLinks,
                  bodyTextLength: bodyText.length
                }
              });
            })()
            """
            .replace("__LIMIT__", Integer.toString(limit))
            .replace("__REQUESTED__", requested);
    }
}
