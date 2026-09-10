import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Images, RefreshCw, Video, X } from 'lucide-react';
import { DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { useRadar } from '../context/RadarContext';
import { NormalizedPost, Source } from '../types';
import { SourceAvatar } from './SourceAvatar';
import { apiFetchSources } from '../services/api';
import { mergeCachedSourceIdentity } from '../lib/sourceIdentityCache';
import { extractSupportedSocialUrl } from '../lib/socialUrl';

interface ExtractedPostsModalProps { onClose: () => void; }

function timeValue(post: NormalizedPost): number {
  const value = Date.parse(post.publishedAt || post.detectedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function safeHttpsMediaUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export const ExtractedPostsModal: React.FC<ExtractedPostsModalProps> = ({ onClose }) => {
  const { sources, locale } = useRadar();
  const connector = useRef(new DeviceSessionConnector()).current;
  const [posts, setPosts] = useState<NormalizedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [runtimeSources, setRuntimeSources] = useState<Source[]>(() => sources.map(mergeCachedSourceIdentity));

  useEffect(() => { if (sources.length > 0) setRuntimeSources(sources.map(mergeCachedSourceIdentity)); }, [sources]);
  const sourceMap = useMemo(() => new Map(runtimeSources.map(source => [source.id, source])), [runtimeSources]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (!DeviceSessionConnector.isNativeAvailable()) throw new Error(locale === 'ar' ? 'عرض المنشورات المستخرجة متاح داخل تطبيق Android.' : 'Extracted posts are available in the Android app.');
      const status = await DeviceSessionConnector.getLocalSession();
      let availableSources = sources;
      try {
        const fresh = await apiFetchSources();
        if (Array.isArray(fresh) && fresh.length > 0) availableSources = fresh.map(mergeCachedSourceIdentity);
      } catch { /* use hydrated context as a fallback */ }
      if (availableSources.length === 0) {
        await new Promise(resolve => window.setTimeout(resolve, 800));
        try {
          const retry = await apiFetchSources();
          if (Array.isArray(retry) && retry.length > 0) availableSources = retry.map(mergeCachedSourceIdentity);
        } catch { /* final fallback remains the context snapshot */ }
      }
      setRuntimeSources(availableSources.map(mergeCachedSourceIdentity));
      const eligible = availableSources.filter(source => source.connectorType === 'device_session' && !source.isPaused && DeviceSessionConnector.isPlatformConnected(status, source.platform));
      if (eligible.length === 0) throw new Error(locale === 'ar' ? 'اربط Facebook أو Instagram للمصادر المطلوبة أولًا.' : 'Connect Facebook or Instagram for the monitored sources first.');
      const collected: NormalizedPost[] = [];
      for (const source of eligible) {
        try {
          const rows = await connector.fetchLatest(source, 10, { commentsMode: 'none' });
          collected.push(...rows);
        } catch {
          // Per-source collector errors are intentionally not echoed because native/provider
          // diagnostics may contain implementation details. The modal reports aggregate failure.
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
  }, [connector, sources, locale]);

  useEffect(() => { void load(); }, [load]);

  const visible = sourceFilter === 'all' ? posts : posts.filter(post => post.sourceId === sourceFilter);
  const sourcesWithPosts = runtimeSources.filter(source => source.connectorType === 'device_session' && posts.some(post => post.sourceId === source.id));
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
                const postUrl = extractSupportedSocialUrl(post.originalUrl) || '';
                const media = (post.media || []).flatMap(item => {
                  const url = safeHttpsMediaUrl(item?.url);
                  return url ? [{ ...item, url }] : [];
                }).slice(0, 4);
                return (
                  <article key={`${post.sourceId}:${post.fingerprint || post.id}:${index}`} data-extracted-post="1" data-media-count={media.length} className="rounded-2xl overflow-hidden bg-slate-900 border border-slate-800">
                    <div className="p-4 flex items-start gap-3">
                      <SourceAvatar src={post.authorAvatar || source?.avatarUrl} name={post.authorName || source?.displayName || ''} platform={post.platform} className="w-10 h-10 rounded-xl" />
                      <div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-slate-100 truncate">{post.authorName || source?.displayName || (locale === 'ar' ? 'مصدر' : 'Source')}</h3><p className="text-[11px] text-slate-500 mt-0.5">{post.publishedAt || post.detectedAt || ''}</p></div>
                      {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800" aria-label={locale === 'ar' ? 'فتح المنشور' : 'Open post'}><ExternalLink className="w-4 h-4" /></a>}
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
                          <img key={`${item.url}:${mediaIndex}`} data-extracted-image="1" src={item.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full min-h-44 max-h-[420px] object-cover bg-slate-950" onError={event => { event.currentTarget.style.display = 'none'; }} />
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
