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
            // Facebook aborted this collector surface with Android WebView's default identity on the
            // physical phone. The same authenticated WebView navigates successfully as a desktop
            // Chromium client; keep this scoped to the Facebook collector only.
            settings.setUserAgentString(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            );

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

            final String[] lastStage = {"page_load"};
            final Runnable[] timeout = new Runnable[1];
            timeout[0] = () -> {
                Log.w(TAG, "event=graphql_timeout attempts=" + attempts[0] +
                    " progress=" + webView.getProgress());
                finishError(main, null, webView, finished, callback,
                    "GRAPHQL_TIMEOUT_" + lastStage[0].toUpperCase(java.util.Locale.ROOT) + "|attempts=" + attempts[0]);
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
                            JSONObject pendingDiagnostics = result.optJSONObject("diagnostics");
                            String stage = pendingDiagnostics == null ? "unknown" : pendingDiagnostics.optString("waitingFor", "unknown");
                            if (!java.util.Set.of("surface", "source_id", "request", "response_body", "unknown").contains(stage)) stage = "unknown";
                            if (!stage.equals(lastStage[0])) {
                                lastStage[0] = stage;
                                Log.i(TAG, "event=graphql_stage stage=" + stage);
                            }
                            main.postDelayed(poll[0], POLL_MS);
                            return;
                        }
                        JSONArray posts = result.optJSONArray("posts");
                        int postCount = posts == null ? 0 : posts.length();
                        JSONObject diagnostics = result.optJSONObject("diagnostics");
                        int pages = diagnostics == null ? 0 : diagnostics.optInt("pages", 0);
                        int nodes = diagnostics == null ? 0 : diagnostics.optInt("nodes", 0);
                        int candidatesTried = diagnostics == null ? 0 : diagnostics.optInt("candidatesTried", 0);
                        int winningCandidate = diagnostics == null ? -1 : diagnostics.optInt("winningCandidate", -1);
                        int queryErrors = diagnostics == null ? 0 : diagnostics.optInt("queryErrors", 0);
                        int winningResolverPattern = diagnostics == null ? -99 : diagnostics.optInt("winningResolverPattern", -99);
                        int winningResolverOccurrence = diagnostics == null ? -1 : diagnostics.optInt("winningResolverOccurrence", -1);
                        int p0 = diagnostics == null ? 0 : diagnostics.optInt("p0", 0);
                        int p1 = diagnostics == null ? 0 : diagnostics.optInt("p1", 0);
                        int p2 = diagnostics == null ? 0 : diagnostics.optInt("p2", 0);
                        int p3 = diagnostics == null ? 0 : diagnostics.optInt("p3", 0);
                        int p4 = diagnostics == null ? 0 : diagnostics.optInt("p4", 0);
                        Log.i(TAG, "event=graphql_result posts=" + postCount +
                            " pages=" + pages + " nodes=" + nodes +
                            " candidates=" + candidatesTried + " qerr=" + queryErrors +
                            " winner=" + winningCandidate + " winp=" + winningResolverPattern +
                            " wino=" + winningResolverOccurrence + " p0=" + p0 + " p1=" + p1 +
                            " p2=" + p2 + " p3=" + p3 + " p4=" + p4);
                        if (postCount <= 0) {
                            finishError(main, timeout[0], webView, finished, callback,
                                "GRAPHQL_NO_POSTS|pages=" + pages + "|nodes=" + nodes);
                            return;
                        }
                        finishSuccess(main, timeout[0], webView, finished, callback, result);
                    } catch (Exception parseError) {
                        Log.w(TAG, "event=graphql_error code=GRAPHQL_SCRIPT_RESULT_INVALID");
                        finishError(main, timeout[0], webView, finished, callback, "GRAPHQL_SCRIPT_RESULT_INVALID");
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
            Uri.Builder builder = uri.buildUpon().authority("www.facebook.com");
            if (uri.getQueryParameter("locale") == null) {
                builder.appendQueryParameter("locale", "en_US");
            }
            return builder.build().toString();
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
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', waitingFor:'surface'}});
              }

              const prior = window[KEY];
              if (prior?.status === 'done') return JSON.stringify(prior.result);
              if (prior?.status === 'error') return JSON.stringify({error: prior.code || 'GRAPHQL_FETCH_FAILED'});
              if (prior?.status === 'pending') return JSON.stringify({pending:true, diagnostics:{collector:'graphql', waitingFor:prior.stage || 'request'}});

              const abs = (raw) => { try { return new URL(raw, location.href).href; } catch (_) { return ''; } };
              const requested = abs(REQUESTED);
              const sourceUrl = requested || abs(location.href);
              let requestedHandle = '';
              try {
                const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean);
                if (parts[0] && !['profile.php','groups'].includes(parts[0].toLowerCase())) requestedHandle = parts[0].replace('@','');
              } catch (_) {}

              let sourceId = '';
              let resolverPattern = -99;
              let resolverOccurrence = -1;
              const sourceCandidates = [];
              const sourceCandidatePatterns = [];
              const sourceCandidateOccurrences = [];
              const numericId = (raw) => {
                const value = String(raw || '').trim();
                if (value.length < 5 || value.length > 32) return '';
                return [...value].every(ch => ch >= '0' && ch <= '9') ? value : '';
              };
              const addCandidate = (raw, pattern, occurrence) => {
                const value = numericId(raw);
                if (!value || sourceCandidates.includes(value) || sourceCandidates.length >= 24) return;
                sourceCandidates.push(value);
                sourceCandidatePatterns.push(pattern);
                sourceCandidateOccurrences.push(occurrence);
              };
              try {
                const u = new URL(sourceUrl);
                addCandidate(u.searchParams.get('id') || '', -2, 0);
              } catch (_) {}

              const html = document.documentElement?.innerHTML || '';
              const scanAll = (marker, pattern, maxHits) => {
                let from = 0, occurrence = 0;
                while (occurrence < maxHits && sourceCandidates.length < 24) {
                  const at = html.indexOf(marker, from);
                  if (at < 0) break;
                  let pos = at + marker.length;
                  let digits = '';
                  while (pos < html.length && html[pos] >= '0' && html[pos] <= '9') digits += html[pos++];
                  addCandidate(digits, pattern, occurrence);
                  occurrence++;
                  from = at + marker.length;
                }
              };

              // Strong, source-specific markers first. Generic JSON id is last because an
              // authenticated Facebook document contains many unrelated object IDs.
              scanAll('fb://profile/', 0, 6);
              scanAll('fb://page/', 1, 6);
              scanAll('"pageID":"', 2, 6);
              scanAll('profile_id=', 4, 8);
              scanAll('"id":"', 3, 20);

              if (sourceCandidates.length === 0) {
                return JSON.stringify({pending:true, diagnostics:{collector:'graphql', surface:host, waitingFor:'source_id'}});
              }
              sourceId = sourceCandidates[0];
              resolverPattern = sourceCandidatePatterns[0];
              resolverOccurrence = sourceCandidateOccurrences[0];
              const candidatePatternCounts = [0,0,0,0,0];
              for (const pattern of sourceCandidatePatterns) {
                if (pattern >= 0 && pattern <= 4) candidatePatternCounts[pattern]++;
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

              // Keep the timeline variables byte-for-byte equivalent in meaning to
              // facebook-graphql-scraper/scrapers/facebook_client/graphql.py::build_variables.
              const variablesFor = (cursor, count) => ({
                afterTime:null, beforeTime:null, count, cursor,
                feedLocation:'TIMELINE', feedbackSource:0, focusCommentID:null,
                memorializedSplitTimeFilter:null, omitPinnedPost:true,
                postedBy:{group:'OWNER'}, privacy:null,
                privacySelectorRenderLocation:'COMET_STREAM', referringStoryRenderLocation:null,
                renderLocation:'timeline', scale:1, stream_count:1, taggedInOnly:null,
                trackingCode:null, useDefaultActor:false, id:sourceId,
                __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider:false,
                __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider:false,
                __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider:false,
                __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider:false,
                __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider:false,
                __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider:true,
                __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider:false,
                __relay_internal__pv__IsWorkUserrelayprovider:false,
                __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider:false,
                __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider:true,
                __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider:true,
                __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider:false,
                __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider:false,
                __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider:false,
                __relay_internal__pv__IsMergQAPollsrelayprovider:false,
                __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider:true,
                __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider:false,
                __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:'AUTO_TRANSLATE',
                __relay_internal__pv__CometUFIShareActionMigrationrelayprovider:true,
                __relay_internal__pv__CometUFISingleLineUFIrelayprovider:true,
                __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider:true,
                __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider:true,
                __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider:false,
                __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider:true,
                __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider:206,
                __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider:false,
                __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider:true
              });

              window[KEY] = {status:'pending', stage:'request'};
              (async () => {
                const posts = [], seen = new Set();
                let pages = 0, nodes = 0, candidatesTried = 0, queryErrors = 0;
                let winningSourceId = '', winningCandidate = -1, winningResolverPattern = -99, winningResolverOccurrence = -1;
                const maxCandidates = Math.min(24, sourceCandidates.length);
                candidateLoop:
                for (let candidateIndex = 0; candidateIndex < maxCandidates; candidateIndex++) {
                  sourceId = sourceCandidates[candidateIndex];
                  resolverPattern = sourceCandidatePatterns[candidateIndex];
                  resolverOccurrence = sourceCandidateOccurrences[candidateIndex];
                  candidatesTried++;
                  let cursor = null;
                  for (let page = 0; page < 4 && posts.length < LIMIT; page++) {
                    const body = new URLSearchParams();
                    body.set('doc_id', DOC_ID);
                    body.set('fb_api_req_friendly_name', FRIENDLY);
                    body.set('variables', JSON.stringify(variablesFor(cursor, Math.min(10, Math.max(1, LIMIT - posts.length)))));
                    window[KEY].stage = 'request';
                    const response = await fetch('/api/graphql/', {
                      method:'POST', credentials:'include',
                      headers:{'Content-Type':'application/x-www-form-urlencoded','X-FB-Friendly-Name':FRIENDLY},
                      body:body.toString()
                    });
                    if (!response.ok) throw new Error('GRAPHQL_HTTP_' + response.status);
                    window[KEY].stage = 'response_body';
                    const parsed = parsePayload(await response.text());
                    pages++; nodes += parsed.nodes;
                    if (parsed.queryError && parsed.posts.length === 0) {
                      queryErrors++;
                      break;
                    }
                    if (parsed.posts.length === 0) break;
                    if (!winningSourceId) {
                      winningSourceId = sourceId;
                      winningCandidate = candidateIndex;
                      winningResolverPattern = resolverPattern;
                      winningResolverOccurrence = resolverOccurrence;
                    }
                    for (const post of parsed.posts) {
                      if (seen.has(post.externalPostId)) continue;
                      seen.add(post.externalPostId); posts.push(post);
                      if (posts.length >= LIMIT) break;
                    }
                    if (posts.length >= LIMIT) break candidateLoop;
                    if (!parsed.hasNext || !parsed.endCursor) break candidateLoop;
                    cursor = parsed.endCursor;
                  }
                  if (winningSourceId) break;
                }
                if (posts.length === 0 && candidatesTried > 0 && queryErrors === candidatesTried) {
                  throw new Error('GRAPHQL_QUERY_ERROR');
                }
                const stableExternalId = handle || requestedHandle || winningSourceId || sourceId;
                window[KEY] = {
                  status:'done',
                  result:{
                    source:{platform:'facebook', externalId:stableExternalId, url:sourceUrl, displayName:title || (handle ? '@'+handle : 'Facebook'), handle, avatarUrl:avatar, visibilityType:'authenticated'},
                    posts:posts.slice(0, LIMIT),
                    diagnostics:{collector:'graphql', surface:host, pages, nodes, candidatesTried, queryErrors, winningCandidate, winningResolverPattern, winningResolverOccurrence, p0:candidatePatternCounts[0], p1:candidatePatternCounts[1], p2:candidatePatternCounts[2], p3:candidatePatternCounts[3], p4:candidatePatternCounts[4]}
                  }
                };
              })().catch((error) => {
                const raw = String(error?.message || 'GRAPHQL_FETCH_FAILED');
                const code = /^GRAPHQL_[A-Z0-9_]+$/.test(raw) ? raw : 'GRAPHQL_FETCH_FAILED';
                window[KEY] = {status:'error', code};
              });

              return JSON.stringify({pending:true, diagnostics:{collector:'graphql', waitingFor:'request', started:true}});
            })()
            """
            .replace("__LIMIT__", Integer.toString(limit))
            .replace("__REQUESTED__", JSONObject.quote(requestedUrl))
            .replace("__DOC_ID__", TIMELINE_DOC_ID);
    }
}
