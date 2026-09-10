from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old[:120]!r}")
    p.write_text(s.replace(old, new))


# Media-detail opt-in and trusted source identity enrichment.
path = "src/connectors/deviceSessionConnector.ts"
replace_once(path,
"""export interface GrabDetailOptions {
  commentsMode?: CommentGrabMode;
  commentLimit?: number;
  includeReplies?: boolean;
}""",
"""export interface GrabDetailOptions {
  commentsMode?: CommentGrabMode;
  commentLimit?: number;
  includeReplies?: boolean;
  includeMedia?: boolean;
}""")
replace_once(path,
"""  return output;
}

function toNormalizedPost(source: { id: string; platform: SourcePlatform; url: string; externalId: string }, post: NativeCollectedPost): NormalizedPost {""",
"""  return output;
}

function normalizedIdentity(value?: string): string {
  return (value || '').trim().replace(/^@/, '').toLowerCase();
}

function isGenericIdentityName(value: string | undefined, externalId: string): boolean {
  const name = normalizedIdentity(value);
  const id = normalizedIdentity(externalId);
  return !name || name === id || ['facebook', 'instagram', 'page', 'profile'].includes(name);
}

function toNormalizedPost(source: { id: string; platform: SourcePlatform; url: string; externalId: string; displayName?: string; avatarUrl?: string }, post: NativeCollectedPost): NormalizedPost {""")
replace_once(path,
"""    authorName: post.authorName || source.externalId,
    authorAvatar: post.authorAvatar,""",
"""    authorName: !isGenericIdentityName(post.authorName, source.externalId)
      ? post.authorName!.trim()
      : (!isGenericIdentityName(source.displayName, source.externalId) ? source.displayName!.trim() : source.externalId),
    authorAvatar: post.authorAvatar || source.avatarUrl,""")
replace_once(path,
"""    source: { id: string; url: string; platform: SourcePlatform; externalId: string; displayName?: string },""",
"""    source: { id: string; url: string; platform: SourcePlatform; externalId: string; displayName?: string; avatarUrl?: string },""")
replace_once(path,
"""    const result = await NativeSession.collectSource({
      sourceId: source.id,
      url: source.url,
      platform: source.platform,
      limit: clampPostLimit(limit)
    });
    const posts = (result.posts || []).map(post => toNormalizedPost(source, post));
    const commentsMode: CommentGrabMode = ['publisher', 'top', 'all'].includes(detailOptions.commentsMode || '')
      ? detailOptions.commentsMode as CommentGrabMode
      : 'none';
    if (commentsMode === 'none' || posts.length === 0) return posts;

    const commentLimit = clampCommentLimit(detailOptions.commentLimit, commentsMode);""",
"""    let normalizedSource = source;
    const needsIdentity = isGenericIdentityName(source.displayName, source.externalId) || !source.avatarUrl?.trim();
    if (needsIdentity) {
      try {
        const resolved = await this.resolveSource({ url: source.url });
        normalizedSource = {
          ...source,
          externalId: resolved.externalId || source.externalId,
          displayName: resolved.displayName || source.displayName,
          avatarUrl: resolved.avatarUrl || source.avatarUrl
        };
      } catch { /* collection remains usable even if metadata enrichment is unavailable */ }
    }

    const result = await NativeSession.collectSource({
      sourceId: source.id,
      url: source.url,
      platform: source.platform,
      limit: clampPostLimit(limit)
    });
    const posts = (result.posts || []).map(post => toNormalizedPost(normalizedSource, post));
    const commentsMode: CommentGrabMode = ['publisher', 'top', 'all'].includes(detailOptions.commentsMode || '')
      ? detailOptions.commentsMode as CommentGrabMode
      : 'none';
    const includeMedia = detailOptions.includeMedia === true;
    if ((!includeMedia && commentsMode === 'none') || posts.length === 0) return posts;

    const commentLimit = clampCommentLimit(detailOptions.commentLimit, commentsMode);""")
replace_once(path,
"""          publisherName: post.authorName || source.displayName || source.externalId,""",
"""          publisherName: post.authorName || normalizedSource.displayName || normalizedSource.externalId,""")


# Connected native sources must not persist the short-lived @handle/blank-avatar placeholder.
path = "src/components/AddSourceModal.tsx"
replace_once(path,
"""    if (lower.includes('facebook') && (lower.includes('session') || lower.includes('login'))) return 'Connect Facebook first.';
    return 'Could not verify this source. Please try again.';""",
"""    if (lower.includes('facebook') && (lower.includes('session') || lower.includes('login'))) return 'Connect Facebook first.';
    if (message === 'INCOMPLETE_SOURCE_METADATA') return 'Could not read the real source name and profile image. Please retry.';
    return 'Could not verify this source. Please try again.';""")
replace_once(path,
"""  if (lower.includes('facebook') && (lower.includes('session') || lower.includes('login'))) return 'اربط Facebook أولًا.';
  return 'تعذر التحقق من المصدر الآن. أعد المحاولة.';""",
"""  if (lower.includes('facebook') && (lower.includes('session') || lower.includes('login'))) return 'اربط Facebook أولًا.';
  if (message === 'INCOMPLETE_SOURCE_METADATA') return 'تعذر قراءة الاسم والصورة الحقيقيين للمصدر. أعد المحاولة.';
  return 'تعذر التحقق من المصدر الآن. أعد المحاولة.';""")
replace_once(path,
"""    const realResolvers = nativePromise ? [nativePromise, serverPromise] : [serverPromise];
    const provisional = provisionalSource(clean, nativeAvailable, connected);
    try {
      let winner: ResolvedSource;
      try { winner = await Promise.race([firstSuccessful(realResolvers), timeoutAfter(2200)]); }
      catch (error) { if (!provisional) throw error; winner = provisional; }
      if (generation !== resolveGeneration.current) return;
      prepare(winner, clean, connected);
    } catch (error) {""",
"""    const realResolvers = nativePromise ? [nativePromise, serverPromise] : [serverPromise];
    const provisional = provisionalSource(clean, nativeAvailable, connected);
    try {
      let winner: ResolvedSource;
      if (nativePromise) {
        winner = await Promise.race([nativePromise, timeoutAfter(10_000)]);
        if (isGenericName(winner.displayName, winner.handle) || !winner.avatarUrl?.trim()) {
          throw new Error('INCOMPLETE_SOURCE_METADATA');
        }
      } else {
        try { winner = await Promise.race([firstSuccessful(realResolvers), timeoutAfter(2200)]); }
        catch (error) { if (!provisional) throw error; winner = provisional; }
      }
      if (generation !== resolveGeneration.current) return;
      prepare(winner, clean, connected);
    } catch (error) {""")
replace_once(path,
"""    setIsSubmitting(true);
    setResolveError(null);
    try {
      await addSourceWithRule({
        platform: resolvedSource.platform,
        externalId: resolvedSource.externalId,
        url: resolvedSource.url,
        displayName: resolvedSource.displayName,
        handle: resolvedSource.handle,
        avatarUrl: resolvedSource.avatarUrl,
        bio: resolvedSource.bio,
        visibilityType: resolvedSource.visibilityType,
        connectorType: resolvedSource.connectorType,
        connectorStatus: resolvedSource.connectorStatus
      }, ruleText, ruleName);""",
"""    setIsSubmitting(true);
    setResolveError(null);
    try {
      let sourceToPersist = resolvedSource;
      if (resolvedSource.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable() && !isDemoMode &&
          (isGenericName(resolvedSource.displayName, resolvedSource.handle) || !resolvedSource.avatarUrl?.trim())) {
        const refreshed = normalizeResolvedSource(await connector.resolveSource({ url: resolvedSource.url }), resolvedSource.url);
        if (isGenericName(refreshed.displayName, refreshed.handle) || !refreshed.avatarUrl?.trim()) throw new Error('INCOMPLETE_SOURCE_METADATA');
        sourceToPersist = { ...resolvedSource, ...refreshed, connectorType: 'device_session', connectorStatus: 'authenticated_monitoring' };
        setResolvedSource(sourceToPersist);
      }
      await addSourceWithRule({
        platform: sourceToPersist.platform,
        externalId: sourceToPersist.externalId,
        url: sourceToPersist.url,
        displayName: sourceToPersist.displayName,
        handle: sourceToPersist.handle,
        avatarUrl: sourceToPersist.avatarUrl,
        bio: sourceToPersist.bio,
        visibilityType: sourceToPersist.visibilityType,
        connectorType: sourceToPersist.connectorType,
        connectorStatus: sourceToPersist.connectorStatus
      }, ruleText, ruleName);""")


# Metadata resolver: same real foreground/desktop lifecycle already proven for feed and detail collectors.
path = "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSourceMetadataResolver.java"
replace_once(path, "import android.os.Looper;\nimport android.webkit.CookieManager;", "import android.os.Looper;\nimport android.view.View;\nimport android.webkit.CookieManager;")
replace_once(path, "private static final long TIMEOUT_MS = 7_000;", "private static final long TIMEOUT_MS = 12_000;")
replace_once(path, "private static final long FIRST_EXTRACTION_DELAY_MS = 140;", "private static final long FIRST_EXTRACTION_DELAY_MS = 450;")
replace_once(path, "private static final long RETRY_DELAY_MS = 240;", "private static final long RETRY_DELAY_MS = 500;")
replace_once(path, "private static final int MAX_EXTRACTION_ATTEMPTS = 18;", "private static final int MAX_EXTRACTION_ATTEMPTS = 20;")
replace_once(path, "private static final int AVATAR_GRACE_ATTEMPTS = 8;", "private static final int AVATAR_GRACE_ATTEMPTS = 12;")
replace_once(path, "WebView webView = new WebView(context.getApplicationContext());", "WebView webView = new WebView(ForegroundWebViewHost.contextFor(context));")
replace_once(path,
"""            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setLoadsImagesAutomatically(true);
            CookieManager manager = CookieManager.getInstance();""",
"""            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setLoadsImagesAutomatically(true);
            settings.setOffscreenPreRaster(true);
            settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36");

            int viewportWidth = Math.max(360, context.getResources().getDisplayMetrics().widthPixels);
            int viewportHeight = Math.max(740, context.getResources().getDisplayMetrics().heightPixels);
            webView.measure(
                View.MeasureSpec.makeMeasureSpec(viewportWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(viewportHeight, View.MeasureSpec.EXACTLY)
            );
            webView.layout(0, 0, viewportWidth, viewportHeight);
            ForegroundWebViewHost.attachIfPossible(context, webView, viewportWidth, viewportHeight);

            CookieManager manager = CookieManager.getInstance();""")
replace_once(path,
"""            runner[0] = () -> {
                if (finished.get()) return;
                attempts[0]++;
                webView.evaluateJavascript(extractionScript(url), value -> {""",
"""            runner[0] = () -> {
                if (finished.get()) return;
                String currentUrl = webView.getUrl();
                if (currentUrl == null || !AuthenticatedWebCollector.isAllowedSocialUrl(currentUrl)) {
                    main.postDelayed(runner[0], RETRY_DELAY_MS);
                    return;
                }
                attempts[0]++;
                webView.evaluateJavascript(extractionScript(url), value -> {""")
replace_once(path,
"""                private void schedule(long delay) {
                    if (finished.get()) return;
                    main.removeCallbacks(runner[0]);
                    main.postDelayed(runner[0], delay);
                }
                @Override public boolean shouldOverrideUrlLoading""",
"""                private void schedule(long delay) {
                    if (finished.get()) return;
                    main.postDelayed(runner[0], delay);
                }
                @Override public boolean shouldOverrideUrlLoading""")
replace_once(path,
"""                @Override public void onPageCommitVisible(WebView view, String loadedUrl) {""",
"""                @Override public void onPageStarted(WebView view, String loadedUrl, android.graphics.Bitmap favicon) {
                    super.onPageStarted(view, loadedUrl, favicon);
                    if (AuthenticatedWebCollector.isAllowedSocialUrl(loadedUrl) && !finished.get()) schedule(3_000);
                }
                @Override public void onPageCommitVisible(WebView view, String loadedUrl) {""")
replace_once(path,
"""            webView.loadUrl(preferMobileFacebookUrl(url));
        });
    }

    private static String preferMobileFacebookUrl(String rawUrl) {""",
"""            webView.loadUrl(preferDesktopFacebookUrl(url));
            main.postDelayed(runner[0], 3_000);
        });
    }

    private static String preferDesktopFacebookUrl(String rawUrl) {""")
replace_once(path, 'return uri.buildUpon().authority("m.facebook.com").build().toString();', 'return uri.buildUpon().authority("www.facebook.com").build().toString();')
replace_once(path,
"""    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                webView.stopLoading();
                webView.clearHistory();
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) { }
        });
    }""",
"""    private static void destroy(WebView webView) {
        new Handler(Looper.getMainLooper()).post(() -> ForegroundWebViewHost.destroy(webView));
    }""")

path = "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java"
replace_once(path,
    "AuthenticatedSourceMetadataResolver.resolve(getContext(), url, new AuthenticatedWebCollector.Callback() {",
    "AuthenticatedSourceMetadataResolver.resolve(foregroundContext(), url, new AuthenticatedWebCollector.Callback() {")


# Radar action button + extracted-post modal.
path = "src/screens/RadarHomeScreen.tsx"
replace_once(path,
    "import { Sparkles, RotateCw, Plus, CheckCircle2, ArrowRight, ArrowLeft, Bell } from 'lucide-react';",
    "import { Sparkles, RotateCw, Plus, CheckCircle2, ArrowRight, ArrowLeft, Bell, Images } from 'lucide-react';")
replace_once(path,
    "import { SmartGrabPanel } from '../components/SmartGrabPanel';",
    "import { SmartGrabPanel } from '../components/SmartGrabPanel';\nimport { ExtractedPostsModal } from '../components/ExtractedPostsModal';")
replace_once(path,
    "  const [scanNotice, setScanNotice] = useState<string | null>(null);",
    "  const [scanNotice, setScanNotice] = useState<string | null>(null);\n  const [showExtractedPosts, setShowExtractedPosts] = useState(false);")
replace_once(path,
"""        <div className="flex items-center gap-2">
          <button id="btn-scan-radar-home" onClick={() => void handleScan()} disabled={isScanning} className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><RotateCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} /><span>{isScanning ? t.loading : t.seedActivity}</span></button>
          <button id="btn-add-source-home" onClick={() => openAddSource()} className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-500/20"><Plus className="w-4 h-4 stroke-[2.5]" /><span>{t.watchAction}</span></button>
        </div>""",
"""        <div className="flex items-center gap-2 flex-wrap">
          <button id="btn-scan-radar-home" onClick={() => void handleScan()} disabled={isScanning} className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><RotateCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} /><span>{isScanning ? t.loading : t.seedActivity}</span></button>
          <button id="btn-extracted-posts-home" onClick={() => setShowExtractedPosts(true)} className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5"><Images className="w-3.5 h-3.5 text-cyan-400" /><span>{locale === 'ar' ? 'المنشورات المستخرجة' : 'Extracted posts'}</span></button>
          <button id="btn-add-source-home" onClick={() => openAddSource()} className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-500/20"><Plus className="w-4 h-4 stroke-[2.5]" /><span>{t.watchAction}</span></button>
        </div>""")
replace_once(path,
"""      {scanNotice && <div role="status" className="px-4 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-slate-300">{scanNotice}</div>}
      <SmartGrabPanel />""",
"""      {scanNotice && <div role="status" className="px-4 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-slate-300">{scanNotice}</div>}
      {showExtractedPosts && <ExtractedPostsModal onClose={() => setShowExtractedPosts(false)} />}
      <SmartGrabPanel />""")


Path("src/components/ExtractedPostsModal.tsx").write_text(r'''import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Images, RefreshCw, Video, X } from 'lucide-react';
import { DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { useRadar } from '../context/RadarContext';
import { NormalizedPost, Source } from '../types';
import { SourceAvatar } from './SourceAvatar';

interface ExtractedPostsModalProps { onClose: () => void; }

function timeValue(post: NormalizedPost): number {
  const value = Date.parse(post.publishedAt || post.detectedAt || '');
  return Number.isFinite(value) ? value : 0;
}

export const ExtractedPostsModal: React.FC<ExtractedPostsModalProps> = ({ onClose }) => {
  const { sources, locale } = useRadar();
  const connector = useRef(new DeviceSessionConnector()).current;
  const [posts, setPosts] = useState<NormalizedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const deviceSources = useMemo(() => sources.filter(source => source.connectorType === 'device_session' && !source.isPaused), [sources]);
  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (!DeviceSessionConnector.isNativeAvailable()) throw new Error(locale === 'ar' ? 'عرض المنشورات المستخرجة متاح داخل تطبيق Android.' : 'Extracted posts are available in the Android app.');
      const status = await DeviceSessionConnector.getLocalSession();
      const eligible = deviceSources.filter(source => DeviceSessionConnector.isPlatformConnected(status, source.platform));
      if (eligible.length === 0) throw new Error(locale === 'ar' ? 'اربط Facebook أو Instagram للمصادر المطلوبة أولًا.' : 'Connect Facebook or Instagram for the monitored sources first.');
      const collected: NormalizedPost[] = [];
      for (const source of eligible) {
        try {
          const rows = await connector.fetchLatest(source, 10, { commentsMode: 'none', includeMedia: true });
          collected.push(...rows);
        } catch (sourceError) {
          console.warn(`[ExtractedPosts] Collection failed for ${source.id}`, sourceError);
        }
      }
      const unique = [...new Map(collected.map(post => [`${post.sourceId}:${post.fingerprint || post.originalUrl}`, post])).values()]
        .sort((a, b) => timeValue(b) - timeValue(a));
      setPosts(unique);
      if (unique.length === 0) throw new Error(locale === 'ar' ? 'لم يتم استخراج منشورات حقيقية الآن.' : 'No real posts were extracted right now.');
    } catch (loadError) {
      setPosts([]);
      setError(loadError instanceof Error ? loadError.message : (locale === 'ar' ? 'تعذر استخراج المنشورات.' : 'Could not extract posts.'));
    } finally { setLoading(false); }
  }, [connector, deviceSources, locale]);

  useEffect(() => { void load(); }, [load]);

  const visible = sourceFilter === 'all' ? posts : posts.filter(post => post.sourceId === sourceFilter);
  const sourcesWithPosts = deviceSources.filter(source => posts.some(post => post.sourceId === source.id));
  const displaySource = (post: NormalizedPost): Source | undefined => sourceMap.get(post.sourceId);

  return (
    <div id="modal-extracted-posts" className="fixed inset-0 z-[65] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-5xl max-h-[92dvh] bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2"><Images className="w-5 h-5 text-cyan-400" />{locale === 'ar' ? 'المنشورات المستخرجة' : 'Extracted posts'}</h2>
            <p className="text-xs text-slate-500 mt-1">{locale === 'ar' ? 'منشورات حقيقية من جلسة الجهاز، مع الصور والفيديو المتاح.' : 'Real posts from the device session, including available images and video.'}</p>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button id="btn-refresh-extracted-posts" type="button" onClick={() => void load()} disabled={loading} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-cyan-300 disabled:opacity-40" aria-label={locale === 'ar' ? 'تحديث' : 'Refresh'}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            <button type="button" onClick={onClose} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white" aria-label={locale === 'ar' ? 'إغلاق' : 'Close'}><X className="w-4 h-4" /></button>
          </div>
        </div>

        {sourcesWithPosts.length > 1 && (
          <div className="px-4 sm:px-5 py-3 border-b border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button onClick={() => setSourceFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border ${sourceFilter === 'all' ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>{locale === 'ar' ? 'الكل' : 'All'} ({posts.length})</button>
            {sourcesWithPosts.map(source => <button key={source.id} onClick={() => setSourceFilter(source.id)} className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border ${sourceFilter === source.id ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>{source.displayName}</button>)}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && <div id="extracted-posts-loading" className="py-20 text-center"><div className="w-10 h-10 mx-auto rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" /><p className="text-sm text-slate-400 mt-4">{locale === 'ar' ? 'جاري استخراج المنشورات والصور والفيديو...' : 'Extracting posts and media...'}</p></div>}
          {!loading && error && <div id="extracted-posts-error" role="alert" className="py-16 text-center text-sm text-rose-300">{error}</div>}
          {!loading && !error && (
            <div className="space-y-4">
              <div id="extracted-post-count" data-count={visible.length} className="text-xs text-slate-500">{locale === 'ar' ? `${visible.length} منشور` : `${visible.length} post${visible.length === 1 ? '' : 's'}`}</div>
              {visible.map((post, index) => {
                const source = displaySource(post);
                const media = (post.media || []).filter(item => item && /^https?:\/\//i.test(item.url)).slice(0, 4);
                return (
                  <article key={`${post.sourceId}:${post.fingerprint || post.id}:${index}`} data-extracted-post="1" data-media-count={media.length} className="rounded-2xl overflow-hidden bg-slate-900 border border-slate-800">
                    <div className="p-4 flex items-start gap-3">
                      <SourceAvatar src={post.authorAvatar || source?.avatarUrl} name={post.authorName || source?.displayName || ''} platform={post.platform} className="w-10 h-10 rounded-xl" />
                      <div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-slate-100 truncate">{post.authorName || source?.displayName || (locale === 'ar' ? 'مصدر' : 'Source')}</h3><p className="text-[11px] text-slate-500 mt-0.5">{post.publishedAt || post.detectedAt || ''}</p></div>
                      <a href={post.originalUrl} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800" aria-label={locale === 'ar' ? 'فتح المنشور' : 'Open post'}><ExternalLink className="w-4 h-4" /></a>
                    </div>
                    {post.text && <p className="px-4 pb-4 text-sm leading-6 text-slate-200 whitespace-pre-wrap break-words">{post.text}</p>}
                    {media.length > 0 && (
                      <div data-extracted-media-grid="1" className={`grid gap-px bg-slate-950 ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        {media.map((item, mediaIndex) => item.type === 'video' ? (
                          <div key={`${item.url}:${mediaIndex}`} className="relative bg-black min-h-44 flex items-center justify-center">
                            <video data-extracted-video="1" controls playsInline preload="metadata" src={item.url} className="w-full max-h-[420px] object-contain bg-black" />
                            <span className="absolute top-2 start-2 pointer-events-none px-2 py-1 rounded-md bg-black/60 text-[10px] text-white flex items-center gap-1"><Video className="w-3 h-3" />Video</span>
                          </div>
                        ) : (
                          <img key={`${item.url}:${mediaIndex}`} data-extracted-image="1" src={item.url} alt="" loading="lazy" className="w-full h-full min-h-44 max-h-[420px] object-cover bg-slate-950" onError={event => { event.currentTarget.style.display = 'none'; }} />
                        ))}
                      </div>
                    )}
                    {media.length === 0 && post.videoPresent && <div className="px-4 pb-4 text-xs text-slate-400 flex items-center gap-1.5"><Video className="w-4 h-4 text-cyan-400" />{locale === 'ar' ? 'المنشور يتضمن فيديو؛ افتحه لعرضه على Facebook.' : 'This post contains video; open it on Facebook to view.'}</div>}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
''')

print("V155_PATCH_HELPER_COMPLETE=1")
