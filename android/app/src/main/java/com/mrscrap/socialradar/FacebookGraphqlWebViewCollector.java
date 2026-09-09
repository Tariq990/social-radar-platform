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

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Facebook-first timeline collector that executes the same ProfileCometTimelineFeedRefetchQuery
 * used by the working facebook-graphql-scraper, but from inside the authenticated app WebView.
 * Browser cookies remain owned by WebView/CookieManager and are never copied across the native
 * bridge or sent to the MR SCRAP backend. Non-Facebook sources delegate to the DOM collector.
 */
final class FacebookGraphqlWebViewCollector {
    private static final String TAG = "MRSCRAP_COLLECTOR";
    private static final String TIMELINE_DOC_ID = "27465012859856795";
    private static final long TIMEOUT_MS = 30_000;
    private static final long POLL_MS = 500;
    private static final long EVAL_WATCHDOG_MS = 3_000;

    private FacebookGraphqlWebViewCollector() {}

    static void collect(
        Context context,
        String url,
        int requestedLimit,
        AuthenticatedWebCollector.Callback callback
    ) {
        if (!isFacebookUrl(url)) {
            AuthenticatedWebCollector.collect(context, url, requestedLimit, callback);
            return;
        }

        final int limit = Math.max(1, Math.min(20, requestedLimit));
        final String targetUrl = desktopUrl(url);
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            AtomicBoolean finished = new AtomicBoolean(false);
            AtomicBoolean evaluationInFlight = new AtomicBoolean(false);
            int[] generation = new int[] { 0 };
            int[] attempts = new int[] { 0 };

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

            final Runnable[] timeout = new Runnable[1];
            timeout[0] = () -> {
                Log.w(TAG, "event=graphql_timeout attempts=" + attempts[0] +
                    " progress=" + webView.getProgress());
                finishError(main, null, webView, finished, callback,
                    "GRAPHQL_TIMEOUT|attempts=" + attempts[0]);
            };
            main.postDelayed(timeout[0], TIMEOUT_MS);

            final Runnable[] poll = new Runnable[1];
            poll[0] = () -> {
                if (finished.get()) return;
                if (!evaluationInFlight.compareAndSet(false, true)) return;
                attempts[0]++;
                int currentGeneration = ++generation[0];
                Log.i(TAG, "event=graphql_poll attempt=" + attempts[0] +
                    " progress=" + webView.getProgress() + " attached=" + webView.isAttachedToWindow());

                main.postDelayed(() -> {
                    if (finished.get() || generation[0] != currentGeneration ||
                        !evaluationInFlight.compareAndSet(true, false)) return;
                    generation[0]++;
                    Log.w(TAG, "event=graphql_eval_watchdog attempt=" + attempts[0]);
                    main.postDelayed(poll[0], POLL_MS);
                }, EVAL_WATCHDOG_MS);

                webView.evaluateJavascript(graphqlScript(url, limit), value -> {
                    if (finished.get() || generation[0] != currentGeneration) return;
                    evaluationInFlight.set(false);
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        String json = decoded instanceof String ? (String) decoded : value;
                        JSONObject result = new JSONObject(json);
                        String error = result.optString("error", "");
                        if (!error.isBlank()) {
                            Log.w(TAG, "event=graphql_error code=" + safeCode(error));
                            finishError(main, timeout[0], webView, finished, callback, error);
                            return;
                        }
                        if (result.optBoolean("pending", false)) {
                            JSONObject diagnostics = result.optJSONObject("diagnostics");
                            String waitingFor = diagnostics == null ? "" : diagnostics.optString("waitingFor", "");
                            String phase = "source_id".equals(waitingFor) ? "source_id" : "request";
                            Log.i(TAG, "event=graphql_pending attempt=" + attempts[0] + " phase=" + phase);
                            main.postDelayed(poll[0], POLL_MS);
                            return;
                        }
                        JSONArray posts = result.optJSONArray("posts");
                        int postCount = posts == null ? 0 : posts.length();
                        JSONObject diagnostics = result.optJSONObject("diagnostics");
                        int pages = diagnostics == null ? 0 : diagnostics.optInt("pages", 0);
                        int nodes = diagnostics == null ? 0 : diagnostics.optInt("nodes", 0);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes);
                        if (postCount <= 0) {
                            finishError(main, timeout[0], webView, finished, callback,
                                "GRAPHQL_NO_POSTS|pages=" + pages + "|nodes=" + nodes);
                            return;
                        }
                        finishSuccess(main, timeout[0], webView, finished, callback, result);
                    } catch (Exception parseError) {
                        main.postDelayed(poll[0], POLL_MS);
                    }
                });
            };

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !AuthenticatedWebCollector.isAllowedSocialUrl(request.getUrl().toString());
                }

                @Override
                public void onPageStarted(WebView view, String loadedUrl, android.graphics.Bitmap favicon) {
                    super.onPageStarted(view, loadedUrl, favicon);
                    if (finished.get()) return;
                    Log.i(TAG, "event=graphql_page_started progress=" + view.getProgress());
                    main.postDelayed(poll[0], 700);
                }

                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    super.onPageFinished(view, loadedUrl);
                    if (finished.get()) return;
                    Log.i(TAG, "event=graphql_page_finished progress=" + view.getProgress());
                    main.postDelayed(poll[0], 120);
                }
            });

            Log.i(TAG, "event=graphql_load_start attached=" + webView.isAttachedToWindow());
            webView.loadUrl(targetUrl);
            main.postDelayed(poll[0], 900);
        });
    }

    private static boolean isFacebookUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null) return false;
            String normalized = host.toLowerCase();
            return normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                normalized.equals("fb.com") || normalized.endsWith(".fb.com") || normalized.equals("fb.watch");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String desktopUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            if (host == null || host.equalsIgnoreCase("fb.watch")) return rawUrl;
            return uri.buildUpon().authority("www.facebook.com").build().toString();
        } catch (Exception ignored) {
            return rawUrl;
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
        if (timeout != null) main.removeCallbacks(timeout);
        ForegroundWebViewHost.destroy(webView);
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
        if (timeout != null) main.removeCallbacks(timeout);
        ForegroundWebViewHost.destroy(webView);
        callback.onError(message);
    }

    private static String safeCode(String value) {
        if (value == null || value.isBlank()) return "unknown";
        String code = value.split("\\|", 2)[0].replaceAll("[^A-Za-z0-9_.:-]", "_");
        return code.substring(0, Math.min(80, code.length()));
    }

    private static String graphqlScript(String requestedUrl, int limit) {
        return """
            (() => {
              const LIMIT = __LIMIT__;
              const REQUESTED = __REQUESTED__;
              const DOC_ID = '__DOC_ID__';
              const FRIENDLY = 'ProfileCometTimelineFeedRefetchQuery';
              const KEY = '__mrscrapFacebookTimelineGraphqlV1';
              const host = String(location.hostname || '').toLowerCase();
              const path = String(location.pathname || '').toLowerCase();
              const loginForm = Boolean(document.querySelector('form[action*="login"], input[name="email"], input[name="pass"]'));
              if (path.includes('/checkpoint')) return JSON.stringify({error:'SESSION_CHECKPOINT'});
              if (path.includes('/login') || loginForm) return JSON.stringify({error:'SESSION_REQUIRED'});
              if (!(host === 'facebook.com' || host.endsWith('.facebook.com'))) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host}});
              }

              const prior = window[KEY];
              if (prior?.status === 'done') return JSON.stringify(prior.result);
              if (prior?.status === 'error') return JSON.stringify({error: prior.code || 'GRAPHQL_FETCH_FAILED'});
              if (prior?.status === 'pending') return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host}});

              const abs = (raw) => { try { return new URL(raw, location.href).href; } catch (_) { return ''; } };
              const requested = abs(REQUESTED);
              const sourceUrl = requested || abs(location.href);
              let sourceId = '';
              try {
                const u = new URL(sourceUrl);
                sourceId = (u.searchParams.get('id') || '').trim();
              } catch (_) {}

              const metaApp = document.querySelector('meta[property="al:ios:url"], meta[property="al:android:url"]')?.content || '';
              const html = document.documentElement?.innerHTML || '';
              const idPatterns = [
                /fb:\\/\\/(?:profile|page)\\/(\\d{5,})/i,
                /["']profile_id["']\\s*[:=]\\s*["']?(\\d{5,})/i,
                /["']pageID["']\\s*:\\s*["'](\\d{5,})["']/i,
                /profile_id=(\\d{5,})/i
              ];
              if (!sourceId) {
                for (const pattern of idPatterns) {
                  const match = String(metaApp).match(pattern) || html.match(pattern);
                  if (match?.[1]) { sourceId = match[1]; break; }
                }
              }
              if (!/^\\d{5,}$/.test(sourceId)) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }

              const cleanTitle = (raw) => String(raw || '').replace(/\\s*[|·-]\\s*Facebook\\s*$/i, '').trim();
              const title = cleanTitle(
                document.querySelector('meta[property="og:title"]')?.content ||
                document.querySelector('h1')?.innerText || document.title
              );
              const avatar = abs(document.querySelector('meta[property="og:image"]')?.content || '');
              let handle = '';
              try {
                const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean);
                if (parts[0] && !['profile.php','groups'].includes(parts[0].toLowerCase())) handle = parts[0].replace('@','');
              } catch (_) {}

              const mediaFrom = (node) => {
                const out = [], seen = new Set();
                const add = (type, url) => {
                  const value = abs(url || '');
                  if (!value || seen.has(value) || out.length >= 12) return;
                  seen.add(value); out.push({type, url:value});
                };
                const walk = (value, depth) => {
                  if (depth > 8 || value == null || out.length >= 12) return;
                  if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
                  if (typeof value !== 'object') return;
                  if (typeof value.browser_native_hd_url === 'string') add('video', value.browser_native_hd_url);
                  else if (typeof value.browser_native_sd_url === 'string') add('video', value.browser_native_sd_url);
                  for (const key of ['photo_image','image','viewer_image']) {
                    const candidate = value[key];
                    if (candidate && typeof candidate.uri === 'string') add('image', candidate.uri);
                  }
                  for (const [key, child] of Object.entries(value)) {
                    if (key === 'tracking' || key === 'extensions') continue;
                    walk(child, depth + 1);
                  }
                };
                walk(node?.attachments || [], 0);
                return out;
              };

              const nodeToPost = (node) => {
                const postId = String(node?.post_id || '');
                if (!postId) return null;
                const actor = Array.isArray(node?.actors) ? (node.actors[0] || {}) : {};
                let text = String(node?.comet_sections?.content?.story?.message?.text || node?.message?.text || '').trim();
                if (!text && Array.isArray(node?.attachments)) {
                  for (const att of node.attachments) {
                    const candidate = att?.description?.text || att?.media?.title?.text || att?.title?.text || '';
                    if (String(candidate).trim()) { text = String(candidate).trim(); break; }
                  }
                }
                const creation = Number(node?.creation_time || 0);
                let publishedAt = null;
                if (Number.isFinite(creation) && creation > 0) {
                  try { publishedAt = new Date(creation * 1000).toISOString(); } catch (_) {}
                }
                return {
                  externalPostId: postId,
                  originalUrl: abs(node?.permalink_url || ''),
                  authorName: String(actor?.name || actor?.short_name || title || ''),
                  authorAvatar: abs(actor?.profile_picture?.uri || avatar || '') || null,
                  text,
                  media: mediaFrom(node),
                  publishedAt,
                  metadata: {collector:'facebook_graphql_webview', pinned:false}
                };
              };

              const parsePayload = (text) => {
                const posts = [], seen = new Set();
                let hasNext = false, endCursor = null, nodes = 0, queryError = false;
                const add = (node) => {
                  if (!node || !node.post_id) return;
                  nodes++;
                  const post = nodeToPost(node);
                  if (!post || seen.has(post.externalPostId)) return;
                  seen.add(post.externalPostId); posts.push(post);
                };
                for (const line of String(text || '').split('\\n')) {
                  if (!line.trim()) continue;
                  let payload;
                  try { payload = JSON.parse(line); } catch (_) { continue; }
                  if (Array.isArray(payload?.errors) && payload.errors.length && !payload?.data) queryError = true;
                  const data = payload?.data;
                  if (!data || typeof data !== 'object') continue;
                  const pageInfo = data.page_info || data?.node?.timeline_list_feed_units?.page_info;
                  if (pageInfo) {
                    hasNext = Boolean(pageInfo.has_next_page);
                    endCursor = pageInfo.end_cursor || null;
                  }
                  const node = data.node;
                  if (node?.post_id) add(node);
                  const edges = node?.timeline_list_feed_units?.edges;
                  if (Array.isArray(edges)) for (const edge of edges) add(edge?.node);
                }
                return {posts, hasNext, endCursor, nodes, queryError};
              };

              const variablesFor = (cursor, count) => ({
                afterTime:null, beforeTime:null, count, cursor,
                feedLocation:'TIMELINE', feedbackSource:0, focusCommentID:null,
                memorializedSplitTimeFilter:null, omitPinnedPost:true,
                postedBy:{group:'OWNER'}, privacy:null,
                privacySelectorRenderLocation:'COMET_STREAM', referringStoryRenderLocation:null,
                renderLocation:'timeline', scale:1, stream_count:1, taggedInOnly:null,
                trackingCode:null, useDefaultActor:false, id:sourceId,
                __relay_internal__pv__IsWorkUserrelayprovider:false,
                __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider:true,
                __relay_internal__pv__CometUFISingleLineUFIrelayprovider:true
              });

              window[KEY] = {status:'pending'};
              (async () => {
                const posts = [], seen = new Set();
                let cursor = null, pages = 0, nodes = 0;
                for (let page = 0; page < 4 && posts.length < LIMIT; page++) {
                  const body = new URLSearchParams();
                  body.set('doc_id', DOC_ID);
                  body.set('fb_api_req_friendly_name', FRIENDLY);
                  body.set('variables', JSON.stringify(variablesFor(cursor, Math.min(10, Math.max(1, LIMIT - posts.length)))));
                  const response = await fetch('/api/graphql/', {
                    method:'POST', credentials:'include',
                    headers:{'Content-Type':'application/x-www-form-urlencoded','X-FB-Friendly-Name':FRIENDLY},
                    body:body.toString()
                  });
                  if (!response.ok) throw new Error('GRAPHQL_HTTP_' + response.status);
                  const parsed = parsePayload(await response.text());
                  pages++; nodes += parsed.nodes;
                  if (parsed.queryError && parsed.posts.length === 0) throw new Error('GRAPHQL_QUERY_ERROR');
                  for (const post of parsed.posts) {
                    if (seen.has(post.externalPostId)) continue;
                    seen.add(post.externalPostId); posts.push(post);
                    if (posts.length >= LIMIT) break;
                  }
                  if (!parsed.hasNext || !parsed.endCursor) break;
                  cursor = parsed.endCursor;
                }
                window[KEY] = {
                  status:'done',
                  result:{
                    source:{platform:'facebook', externalId:sourceId, url:sourceUrl, displayName:title || (handle ? '@'+handle : 'Facebook'), handle, avatarUrl:avatar, visibilityType:'authenticated'},
                    posts:posts.slice(0, LIMIT),
                    diagnostics:{collector:'graphql', surface:host, pages, nodes}
                  }
                };
              })().catch((error) => {
                const raw = String(error?.message || 'GRAPHQL_FETCH_FAILED');
                const code = /^GRAPHQL_[A-Z0-9_]+$/.test(raw) ? raw : 'GRAPHQL_FETCH_FAILED';
                window[KEY] = {status:'error', code};
              });

              return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, started:true}});
            })()
            """
            .replace("__LIMIT__", Integer.toString(limit))
            .replace("__REQUESTED__", JSONObject.quote(requestedUrl))
            .replace("__DOC_ID__", TIMELINE_DOC_ID);
    }
}
