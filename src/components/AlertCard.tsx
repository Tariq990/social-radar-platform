import React from 'react';
import { ExternalLink, Bookmark, ThumbsDown, Sparkles, CheckCircle2, Clock } from 'lucide-react';
import { AlertMatch } from '../types';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { SourceAvatar } from './SourceAvatar';

interface AlertCardProps {
  alert: AlertMatch;
  onOpenDetail: (alert: AlertMatch) => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, onOpenDetail }) => {
  const { toggleSaveMatch, rateMatchFeedback, markMatchRead, locale } = useRadar();
  const t = translations[locale];
  const postText = alert.post?.text || (alert as any).postSnippet || (alert as any).text || '';
  const postUrl = alert.post?.originalUrl || (alert as any).postUrl || (alert as any).url || '';
  const sourceName = alert.sourceName || (alert as any).displayName || (locale === 'ar' ? 'مصدر مراقب' : 'Monitored source');
  const sourceAvatar = alert.sourceAvatar || alert.post?.authorAvatar || (alert as any).authorAvatar || '';
  const sourcePlatform = alert.sourcePlatform || (alert as any).platform || 'other';
  const ruleName = alert.ruleName || (alert as any).ruleNaturalLanguage || '';
  const reason = alert.reason || (alert as any).whyMatched || '';
  const mediaItems = Array.isArray(alert.post?.media) ? alert.post.media : [];

  const openDetail = () => {
    void markMatchRead(alert.id).catch(() => {});
    onOpenDetail(alert);
  };

  return (
    <article
      id={`alert-card-${alert.id}`}
      onClick={openDetail}
      className={`group relative rounded-2xl border transition-all cursor-pointer p-4 sm:p-5 ${alert.isRead ? 'bg-slate-900/40 hover:bg-slate-900/80 border-slate-800/80' : 'bg-slate-900 border-cyan-500/30 shadow-lg shadow-cyan-950/20'}`}
    >
      {!alert.isRead && <span className="absolute top-4 end-4 w-2 h-2 rounded-full bg-cyan-400" />}

      <div className="flex items-start gap-3 mb-3 pe-4">
        <SourceAvatar src={sourceAvatar} name={sourceName} platform={sourcePlatform} className="w-10 h-10 rounded-xl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm text-slate-100 truncate group-hover:text-cyan-300">{sourceName}</h4>
            {sourcePlatform !== 'other' && <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">{sourcePlatform}</span>}
            {alert.category && <span className="text-[11px] px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800/40 font-medium">{alert.category}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 min-w-0">
            <span className="flex items-center gap-1 flex-none"><Clock className="w-3 h-3" />{alert.createdAt || (locale === 'ar' ? 'حديث' : 'Recent')}</span>
            {ruleName && <><span>•</span><span className="truncate">{ruleName}</span></>}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 my-2.5">
        <p className="flex-1 min-w-0 text-xs sm:text-sm text-slate-200 line-clamp-3 leading-relaxed">{postText || (locale === 'ar' ? 'منشور مطابق للقاعدة.' : 'A post matched this rule.')}</p>
        {mediaItems.length > 0 && /^https?:\/\//i.test(mediaItems[0].url) && (
          <div className="w-full sm:w-24 h-20 rounded-xl overflow-hidden bg-slate-950 flex-none border border-slate-800"><img src={mediaItems[0].url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" /></div>
        )}
      </div>

      {reason && (
        <div className="mt-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 text-xs text-slate-300 flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-none mt-0.5" />
          <div className="flex-1 min-w-0"><span className="font-semibold text-cyan-300 me-1">{t.whyMatchedTitle}</span><span>{reason}</span></div>
          {Number.isFinite(alert.confidence) && alert.confidence > 0 && <span className="text-[10px] font-semibold text-cyan-400/80 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/30 flex-none">{Math.round(alert.confidence * 100)}%</span>}
        </div>
      )}

      <div className="mt-3.5 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1">
          {postUrl && <button onClick={e => { e.stopPropagation(); window.open(postUrl, '_blank', 'noopener,noreferrer'); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-cyan-300 hover:bg-slate-800"><ExternalLink className="w-3.5 h-3.5" /><span className="hidden sm:inline">{t.openOriginal}</span></button>}
          <button onClick={e => { e.stopPropagation(); void toggleSaveMatch(alert.id).catch(() => {}); }} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg ${alert.isSaved ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}><Bookmark className={`w-3.5 h-3.5 ${alert.isSaved ? 'fill-current' : ''}`} /><span className="hidden sm:inline">{alert.isSaved ? t.savedAlert : t.saveAlert}</span></button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={e => { e.stopPropagation(); void rateMatchFeedback(alert.id, 'relevant').catch(() => {}); }} className={`p-1.5 sm:px-2 rounded-lg ${alert.feedback === 'relevant' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'}`} title={t.isRelevant}><CheckCircle2 className="w-3.5 h-3.5" /></button>
          <button onClick={e => { e.stopPropagation(); void rateMatchFeedback(alert.id, 'not_relevant').catch(() => {}); }} className={`p-1.5 sm:px-2 rounded-lg ${alert.feedback === 'not_relevant' ? 'bg-rose-500/20 text-rose-400' : 'text-slate-400 hover:bg-slate-800'}`} title={t.notRelevant}><ThumbsDown className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </article>
  );
};
