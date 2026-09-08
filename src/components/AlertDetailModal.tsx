import React, { useState } from 'react';
import { X, ExternalLink, Bookmark, Sparkles, Share2, SlidersHorizontal, Copy, Check } from 'lucide-react';
import { AlertMatch } from '../types';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';
import { SourceAvatar } from './SourceAvatar';

interface AlertDetailModalProps {
  alert: AlertMatch;
  onClose: () => void;
}

export const AlertDetailModal: React.FC<AlertDetailModalProps> = ({ alert, onClose }) => {
  const { toggleSaveMatch, locale, setCurrentScreen } = useRadar();
  const t = translations[locale];
  const [copiedShare, setCopiedShare] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const postText = alert.post?.text || (alert as any).postSnippet || (alert as any).text || '';
  const postUrl = alert.post?.originalUrl || (alert as any).postUrl || (alert as any).url || '';
  const sourceName = alert.sourceName || (alert as any).displayName || (locale === 'ar' ? 'مصدر مراقب' : 'Monitored source');
  const sourceAvatar = alert.sourceAvatar || alert.post?.authorAvatar || (alert as any).authorAvatar || '';
  const sourcePlatform = alert.sourcePlatform || (alert as any).platform || 'other';
  const ruleName = alert.ruleName || (alert as any).ruleNaturalLanguage || '';
  const reason = alert.reason || (alert as any).whyMatched || '';
  const mediaItems = Array.isArray(alert.post?.media) ? alert.post.media : [];

  const copyLink = async () => {
    if (!postUrl) return;
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 1800);
    } catch { }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm">
      <div id="modal-alert-detail" className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SourceAvatar src={sourceAvatar} name={sourceName} platform={sourcePlatform} className="w-9 h-9 rounded-lg" />
            <div className="min-w-0"><h3 className="text-sm font-bold text-slate-100 truncate">{sourceName}</h3><p className="text-[11px] text-slate-400">{alert.createdAt || (locale === 'ar' ? 'حديث' : 'Recent')}</p></div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-400"><Sparkles className="w-4 h-4" /><span>{t.whyYouReceivedThis}</span></div>
            {ruleName && <p className="text-xs text-slate-400"><strong>{t.ruleMatchedLabel}:</strong> “{ruleName}”</p>}
            {reason && <div className="text-sm font-medium text-slate-100 bg-slate-950/60 p-3 rounded-lg border border-cyan-500/20">{reason}</div>}
          </div>

          {alert.extracted && Object.keys(alert.extracted).length > 0 && (
            <div className="space-y-2"><span className="text-xs font-semibold text-slate-400">{t.extractedDataLabel}</span><div className="grid grid-cols-2 gap-2">{Object.entries(alert.extracted).map(([key, value]) => <div key={key} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"><span className="text-slate-500 block text-[10px]">{key.replace(/_/g, ' ')}</span><span className="font-bold text-slate-200 break-words">{String(value)}</span></div>)}</div></div>
          )}

          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-400">{t.originalExcerpt}</span>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{postText || (locale === 'ar' ? 'لا يتوفر نص للمنشور.' : 'No post text is available.')}</div>
            {mediaItems.length > 0 && /^https?:\/\//i.test(mediaItems[0].url) && <div className="rounded-xl overflow-hidden border border-slate-800 max-h-72 bg-slate-950"><img src={mediaItems[0].url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" /></div>}
          </div>

          {postUrl && (
            <div className="pt-1">
              <button onClick={() => setShowShareCard(value => !value)} className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2"><Share2 className="w-4 h-4 text-cyan-400" />{t.shareAlertCard}</button>
              {showShareCard && <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-cyan-500/30 space-y-3"><div className="flex items-center justify-between text-[11px] text-cyan-400 font-semibold"><span>{BRAND.name}</span>{alert.category && <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300">{alert.category}</span>}</div><h4 className="font-bold text-sm text-slate-100">{sourceName}</h4>{reason && <p className="text-xs text-slate-300">{reason}</p>}<button onClick={() => void copyLink()} className="ms-auto px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold flex items-center gap-1.5">{copiedShare ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copiedShare ? t.copied : (locale === 'ar' ? 'نسخ رابط المنشور' : 'Copy post link')}</button></div>}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => void toggleSaveMatch(alert.id).catch(() => {})} className={`px-3 py-2 rounded-xl text-xs font-medium border flex items-center gap-1.5 ${alert.isSaved ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'}`}><Bookmark className={`w-3.5 h-3.5 ${alert.isSaved ? 'fill-current' : ''}`} />{alert.isSaved ? t.savedAlert : t.saveAlert}</button>
            <button onClick={() => { onClose(); setCurrentScreen('rules'); }} className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700 flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /><span className="hidden sm:inline">{t.adjustRule}</span></button>
          </div>
          {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"><span>{t.openOriginal}</span><ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      </div>
    </div>
  );
};
