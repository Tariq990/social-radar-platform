import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ExternalLink, Search, Sparkles, Tags, WandSparkles } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { CommentGrabMode, DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { Source } from '../types';
import { apiExploreDevicePosts, ExploreMode, ExploreResponse, ExploreSourceBatch } from '../services/explore';
import { SourceAvatar } from './SourceAvatar';

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

function describeCollectionFailure(raw: string | undefined, source: Source, locale: 'ar' | 'en'): string {
  const message = String(raw || '').trim();
  const platform = source.platform === 'instagram' ? 'Instagram' : 'Facebook';
  if (/SESSION_CHECKPOINT/i.test(message)) {
    return locale === 'ar'
      ? `${platform} يطلب تحققًا إضافيًا على الجهاز. افتح الاتصال من الإعدادات وأكمل التحقق ثم أعد المحاولة.`
      : `${platform} requires an additional on-device verification. Open the connection in Settings, complete it, then retry.`;
  }
  if (/SESSION_REQUIRED|session expired|session is not connected/i.test(message)) {
    return locale === 'ar'
      ? `انتهت جلسة ${platform} على الجهاز أو لم تعد صالحة. أعد ربط ${platform} من الإعدادات.`
      : `The on-device ${platform} session expired or is no longer usable. Reconnect ${platform} in Settings.`;
  }
  if (message.startsWith('NO_EXTRACTABLE_POSTS')) {
    const safeDiagnostics = message.split('|').slice(1).filter(part => /^(surface|containers|anchors|postLinks|body)=[A-Za-z0-9._:-]+$/.test(part));
    const suffix = safeDiagnostics.length ? ` [${safeDiagnostics.join(' · ')}]` : '';
    return locale === 'ar'
      ? `فتح الجهاز صفحة ${platform} لكنه لم يجد منشورات قابلة للاستخراج.${suffix}`
      : `The device opened the ${platform} page but found no extractable posts.${suffix}`;
  }
  if (/timed out/i.test(message)) {
    return locale === 'ar'
      ? `انتهت مهلة تحميل صفحة ${platform} على الجهاز قبل اكتمال الجلب.`
      : `The on-device ${platform} page timed out before collection completed.`;
  }
  if (/SOURCE_METADATA_UNAVAILABLE|Could not resolve reliable source metadata/i.test(message)) {
    return locale === 'ar'
      ? `تم فتح ${platform} لكن تعذر تثبيت هوية المصدر من الصفحة الحالية.`
      : `${platform} opened, but the source identity could not be resolved from the current page.`;
  }
  return locale === 'ar'
    ? `تعذر استخراج منشورات حقيقية من ${platform} على الجهاز الآن.`
    : `Could not extract real ${platform} posts on this device right now.`;
}

export const SmartGrabPanel: React.FC = () => {
  const { sources, locale } = useRadar();
  const connector = useRef(new DeviceSessionConnector()).current;
  const initialized = useRef(false);
  const eligible = useMemo(
    () => sources.filter(source => source.connectorType === 'device_session' && !source.isPaused && (source.platform === 'facebook' || source.platform === 'instagram')).slice(0, 10),
    [sources]
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [limit, setLimit] = useState(10);
  const [mode, setMode] = useState<ExploreMode>('filter');
  const [prompt, setPrompt] = useState(locale === 'ar' ? 'عروض AI أو إرشادات في التصميم' : 'AI offers or design guidance');
  const [categoryText, setCategoryText] = useState(locale === 'ar' ? 'عروض، تعليم، أخبار، إرشادات، أخرى' : 'Offers, Education, News, Guidance, Other');
  const [commentsMode, setCommentsMode] = useState<CommentGrabMode>('none');
  const [commentLimit, setCommentLimit] = useState(20);
  const [includeReplies, setIncludeReplies] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResponse | null>(null);

  useEffect(() => {
    if (initialized.current || eligible.length === 0) return;
    initialized.current = true;
    setSelectedIds(eligible.map(source => source.id));
  }, [eligible]);

  const categories = useMemo(() => categoryText.split(/[،,\n]/).map(value => value.trim()).filter(Boolean).slice(0, 12), [categoryText]);
  const visibleItems = useMemo(() => {
    if (!result) return [];
    return mode === 'filter' ? result.items.filter(item => item.relevant) : result.items;
  }, [result, mode]);
  const groupedItems = useMemo(() => {
    const groups = new Map<string, typeof visibleItems>();
    for (const item of visibleItems) {
      const key = item.category || (locale === 'ar' ? 'غير مصنف' : 'Uncategorized');
      const existing = groups.get(key) || [];
      existing.push(item);
      groups.set(key, existing);
    }
    return [...groups.entries()];
  }, [visibleItems, locale]);

  const toggleSource = (sourceId: string) => {
    setResult(null);
    setSelectedIds(current => current.includes(sourceId) ? current.filter(id => id !== sourceId) : [...current, sourceId].slice(0, 10));
  };

  const chooseMode = (next: ExploreMode) => {
    setMode(next);
    setResult(null);
    setError(null);
    setNotice(null);
  };

  const run = async () => {
    setError(null);
    setNotice(null);
    setResult(null);
    if (!DeviceSessionConnector.isNativeAvailable()) {
      setError(locale === 'ar' ? 'الجلب المباشر يحتاج تطبيق Android لأن جلسات Facebook وInstagram تبقى محليًا على الجهاز.' : 'Live grabbing requires the Android app because Facebook and Instagram sessions stay on-device.');
      return;
    }
    const chosen = eligible.filter(source => selectedIds.includes(source.id));
    if (chosen.length === 0) {
      setError(locale === 'ar' ? 'اختر مصدرًا واحدًا على الأقل.' : 'Choose at least one source.');
      return;
    }
    if (chosen.length * limit > 100) {
      setError(locale === 'ar' ? `الحد الأقصى للتحليل في العملية الواحدة 100 منشور. اختر ${Math.floor(100 / limit)} مصادر أو أقل لهذا العدد.` : `One analysis run is limited to 100 posts. Select ${Math.floor(100 / limit)} sources or fewer at this per-source limit.`);
      return;
    }
    if (commentsMode !== 'none' && chosen.length * limit > 20) {
      setError(locale === 'ar' ? 'عند جلب التعليقات، الحد الأقصى 20 منشور في العملية الواحدة.' : 'Comment collection is limited to 20 posts per operation.');
      return;
    }
    if (commentsMode === 'all' && chosen.length * limit > 5) {
      setError(locale === 'ar' ? 'جلب كل التعليقات المتاحة محدود إلى 5 منشورات في العملية الواحدة.' : 'Collecting all accessible comments is limited to 5 posts per operation.');
      return;
    }
    if (mode === 'filter' && !prompt.trim()) {
      setError(locale === 'ar' ? 'اكتب ما الذي تريد البحث عنه في المنشورات.' : 'Describe what you want to find in the posts.');
      return;
    }
    if (mode === 'custom' && categories.length === 0) {
      setError(locale === 'ar' ? 'أدخل تصنيفًا واحدًا على الأقل.' : 'Enter at least one category.');
      return;
    }

    setBusy(true);
    try {
      const session = await DeviceSessionConnector.getLocalSession();
      const disconnected = chosen.filter(source => !DeviceSessionConnector.isPlatformConnected(session, source.platform));
      const connected = chosen.filter(source => DeviceSessionConnector.isPlatformConnected(session, source.platform));
      if (connected.length === 0) {
        const names = [...new Set(disconnected.map(source => source.platform === 'instagram' ? 'Instagram' : 'Facebook'))].join(' / ');
        throw new Error(locale === 'ar' ? `اربط ${names} من الإعدادات أولًا.` : `Connect ${names} in Settings first.`);
      }

      const collected = await mapWithConcurrency<Source, { source: Source; posts: Awaited<ReturnType<DeviceSessionConnector['fetchLatest']>>; error?: string }>(
        connected,
        2,
        async source => {
          try {
            const posts = await connector.fetchLatest(source, limit, {
              commentsMode,
              commentLimit: commentsMode === 'all' ? 200 : commentLimit,
              includeReplies
            });
            return { source, posts };
          } catch (err: any) {
            return { source, posts: [], error: err?.message || 'Collection failed' };
          }
        }
      );

      const batches: ExploreSourceBatch[] = collected.filter(item => item.posts.length > 0).map(item => ({ sourceId: item.source.id, posts: item.posts }));
      const failed = collected.filter(item => item.posts.length === 0);
      if (batches.length === 0) {
        const firstFailure = failed.find(item => item.error);
        if (firstFailure) throw new Error(describeCollectionFailure(firstFailure.error, firstFailure.source, locale));
        throw new Error(locale === 'ar' ? 'لم يجد الجهاز منشورات متاحة للاستخراج من المصادر المختارة الآن.' : 'The device found no extractable posts in the selected sources right now.');
      }

      const response = await apiExploreDevicePosts(batches, { mode, prompt: prompt.trim(), categories, locale });
      setResult(response);
      const skipped = disconnected.length + failed.length;
      if (skipped > 0) {
        setNotice(locale === 'ar'
          ? `تم تحليل المصادر التي نجح جلبها. تم تخطي ${skipped} مصدر لعدم وجود جلسة أو منشورات قابلة للاستخراج.`
          : `Analyzed the sources that were collected successfully. ${skipped} source(s) were skipped because a session or extractable posts were unavailable.`);
      } else {
        setNotice(locale === 'ar' ? `تم تحليل ${response.postsAnalyzed} منشور حقيقي.` : `Analyzed ${response.postsAnalyzed} real post${response.postsAnalyzed === 1 ? '' : 's'}.`);
      }
    } catch (err: any) {
      setError(err?.message || (locale === 'ar' ? 'تعذر إكمال التحليل.' : 'Could not complete the analysis.'));
    } finally {
      setBusy(false);
    }
  };

  if (eligible.length === 0) return null;
  const requestedTotal = selectedIds.length * limit;

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-900/80 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-800 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-none"><Sparkles className="w-4 h-4 text-cyan-400" /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-100">{locale === 'ar' ? 'الجلب والتحليل الذكي' : 'Smart Grab & Analyze'}</h2>
          <p className="text-xs text-slate-400 mt-1 leading-5">{locale === 'ar' ? 'اجلب آخر المنشورات الحقيقية من مصادر محددة ثم ابحث فيها أو صنّفها بالذكاء الاصطناعي. هذه العملية لا تنشئ تنبيهات قديمة.' : 'Grab the latest real posts from selected sources, then search or classify them with AI. This does not create historical watch alerts.'}</p>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-300">{locale === 'ar' ? 'المصادر' : 'Sources'}</span><button type="button" onClick={() => { setResult(null); setSelectedIds(selectedIds.length === eligible.length ? [] : eligible.map(source => source.id)); }} className="text-[11px] text-cyan-400">{selectedIds.length === eligible.length ? (locale === 'ar' ? 'إلغاء الكل' : 'Clear all') : (locale === 'ar' ? 'اختيار الكل' : 'Select all')}</button></div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {eligible.map(source => {
              const selected = selectedIds.includes(source.id);
              return <button key={source.id} type="button" onClick={() => toggleSource(source.id)} className={`flex items-center gap-2 min-w-0 px-2.5 py-2 rounded-xl border text-start ${selected ? 'bg-cyan-500/10 border-cyan-500/35 text-cyan-200' : 'bg-slate-950 border-slate-800 text-slate-400'}`}><SourceAvatar src={source.avatarUrl} name={source.displayName} platform={source.platform} className="w-7 h-7 rounded-lg" iconClassName="w-3.5 h-3.5" /><span className="text-xs max-w-32 truncate">{source.displayName}</span>{selected && <Check className="w-3.5 h-3.5 flex-none" />}</button>;
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => chooseMode('filter')} className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${mode === 'filter' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}><Search className="w-3.5 h-3.5" />{locale === 'ar' ? 'بحث ذكي' : 'Smart search'}</button>
          <button type="button" onClick={() => chooseMode('custom')} className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${mode === 'custom' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}><Tags className="w-3.5 h-3.5" />{locale === 'ar' ? 'تصنيف مخصص' : 'Custom'}</button>
          <button type="button" onClick={() => chooseMode('auto')} className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${mode === 'auto' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}><WandSparkles className="w-3.5 h-3.5" />{locale === 'ar' ? 'تلقائي' : 'Auto'}</button>
        </div>

        <div className="grid sm:grid-cols-[150px_1fr] gap-3">
          <label className="space-y-1"><span className="text-[11px] font-semibold text-slate-400">{locale === 'ar' ? 'عدد المنشورات لكل مصدر' : 'Posts per source'}</span><select value={limit} onChange={event => { setLimit(Number(event.target.value)); setResult(null); }} className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500"><option value={5}>5</option><option value={10}>10</option><option value={15}>15</option><option value={20}>20</option></select><span className={`block text-[10px] ${requestedTotal > 100 ? 'text-rose-400' : 'text-slate-600'}`}>{requestedTotal}/100 {locale === 'ar' ? 'حد أقصى للعملية' : 'max per run'}</span></label>
          {mode === 'filter' && <label className="space-y-1"><span className="text-[11px] font-semibold text-slate-400">{locale === 'ar' ? 'شو بدك تلاقي؟' : 'What do you want to find?'}</span><input value={prompt} onChange={event => { setPrompt(event.target.value); setResult(null); }} className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 outline-none focus:border-cyan-500" placeholder={locale === 'ar' ? 'مثال: عروض AI أو إرشادات في التصميم' : 'Example: AI offers or design guidance'} /></label>}
          {mode === 'custom' && <label className="space-y-1"><span className="text-[11px] font-semibold text-slate-400">{locale === 'ar' ? 'التصنيفات — افصل بفاصلة' : 'Categories — comma separated'}</span><input value={categoryText} onChange={event => { setCategoryText(event.target.value); setResult(null); }} className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 outline-none focus:border-cyan-500" /></label>}
          {mode === 'auto' && <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs text-slate-400 flex items-center">{locale === 'ar' ? 'سيختار AI تصنيفًا عامًا مناسبًا لكل منشور بدون اختراع معلومات.' : 'AI will assign a useful general category to every post without inventing facts.'}</div>}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1"><span className="text-[11px] font-semibold text-slate-400">{locale === 'ar' ? 'التعليقات' : 'Comments'}</span><select value={commentsMode} onChange={event => { setCommentsMode(event.target.value as CommentGrabMode); setResult(null); }} className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500"><option value="none">{locale === 'ar' ? 'بدون تعليقات' : 'No comments'}</option><option value="publisher">{locale === 'ar' ? 'تعليقات الناشر فقط' : 'Publisher comments only'}</option><option value="top">{locale === 'ar' ? 'أول تعليقات ظاهرة' : 'Top visible comments'}</option><option value="all">{locale === 'ar' ? 'كل التعليقات المتاحة' : 'All accessible comments'}</option></select></label>
            {commentsMode !== 'none' && commentsMode !== 'all' && <label className="space-y-1"><span className="text-[11px] font-semibold text-slate-400">{locale === 'ar' ? 'عدد التعليقات لكل منشور' : 'Comments per post'}</span><select value={commentLimit} onChange={event => { setCommentLimit(Number(event.target.value)); setResult(null); }} className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500"><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>}
          </div>
          {commentsMode !== 'none' && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={includeReplies} onChange={event => { setIncludeReplies(event.target.checked); setResult(null); }} className="accent-cyan-500" />{locale === 'ar' ? 'تضمين الردود على التعليقات' : 'Include comment replies'}</label>}
          <p className="text-[10px] leading-4 text-slate-500">{locale === 'ar' ? 'صور وفيديو المنشور تُجمع تلقائيًا عند توفرها. «كل التعليقات المتاحة» يعني ما تستطيع جلستك الحالية رؤيته فعليًا، وبحد أقصى 200 تعليق لكل منشور.' : 'Post images/video are collected automatically when available. “All accessible comments” means what the current session can actually view, capped at 200 comments per post.'}</p>
        </div>

        {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex gap-2"><AlertCircle className="w-4 h-4 flex-none" /><span>{error}</span></div>}
        {notice && <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 text-xs text-slate-300">{notice}</div>}

        <button type="button" onClick={() => void run()} disabled={busy || selectedIds.length === 0 || requestedTotal > 100 || (commentsMode !== 'none' && requestedTotal > 20) || (commentsMode === 'all' && requestedTotal > 5)} className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2"><Sparkles className={`w-4 h-4 ${busy ? 'animate-pulse' : ''}`} />{busy ? (locale === 'ar' ? 'جاري جلب وتحليل المنشورات...' : 'Grabbing and analyzing posts...') : (locale === 'ar' ? `اجلب آخر ${limit} وحللها` : `Grab latest ${limit} and analyze`)}</button>

        {result && (
          <div className="pt-2 space-y-4">
            <div className="flex flex-wrap gap-2 text-[11px]"><span className="px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-slate-300">{locale === 'ar' ? `${result.postsAnalyzed} تم تحليلها` : `${result.postsAnalyzed} analyzed`}</span>{mode === 'filter' && <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">{locale === 'ar' ? `${visibleItems.length} مطابق` : `${visibleItems.length} matched`}</span>}</div>
            {groupedItems.length === 0 ? <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-500">{locale === 'ar' ? 'لم يطابق أي منشور حقيقي شرط البحث.' : 'No real post matched this search.'}</div> : groupedItems.map(([category, items]) => <div key={category} className="space-y-2"><div className="flex items-center gap-2"><span className="text-xs font-bold text-cyan-300">{category}</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{items.length}</span></div><div className="grid gap-2">{items.map(item => <article key={`${item.post.sourceId}:${item.post.id}`} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800"><div className="flex items-start gap-3"><SourceAvatar src={item.sourceAvatar || item.post.authorAvatar} name={item.sourceName} platform={item.post.platform} className="w-9 h-9 rounded-lg" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold text-slate-200 truncate">{item.sourceName}</h3><span className="text-[10px] text-cyan-400">{Math.round(item.confidence * 100)}%</span></div><p className="text-xs text-slate-300 mt-1.5 leading-5 line-clamp-3">{item.post.text}</p><p className="text-[11px] text-slate-500 mt-2">{item.reason}</p>{Array.isArray(item.post.comments) && item.post.comments.length > 0 && <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2 space-y-1.5"><div className="flex items-center justify-between text-[10px] text-slate-500"><span>{locale === 'ar' ? `${item.post.comments.length} تعليق` : `${item.post.comments.length} comments`}</span>{item.post.commentsTruncated && <span>{locale === 'ar' ? 'جزئي' : 'partial'}</span>}</div>{item.post.comments.slice(0, 3).map((comment, index) => <p key={`${comment.externalCommentId || index}`} className="text-[10px] leading-4 text-slate-400 line-clamp-2"><span className={comment.isPublisher ? 'text-cyan-300 font-semibold' : 'text-slate-300 font-semibold'}>{comment.authorName}: </span>{comment.text}</p>)}</div>}<div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-600">{item.post.publishedAt || (locale === 'ar' ? 'التاريخ غير ظاهر' : 'Date unavailable')}</span><a href={item.post.originalUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-400 inline-flex items-center gap-1">{locale === 'ar' ? 'فتح المنشور' : 'Open post'}<ExternalLink className="w-3 h-3" /></a></div></div></div></article>)}</div></div>)}
          </div>
        )}
      </div>
    </section>
  );
};
