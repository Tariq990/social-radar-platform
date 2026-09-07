import React, { useState } from 'react';
import { 
  X, 
  ExternalLink, 
  Bookmark, 
  Sparkles, 
  CheckCircle2, 
  ThumbsDown, 
  Share2, 
  SlidersHorizontal,
  Clock,
  ShieldCheck,
  Copy,
  Check
} from 'lucide-react';
import { AlertMatch } from '../types';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

interface AlertDetailModalProps {
  alert: AlertMatch;
  onClose: () => void;
}

export const AlertDetailModal: React.FC<AlertDetailModalProps> = ({ alert, onClose }) => {
  const { toggleSaveMatch, rateMatchFeedback, locale, setCurrentScreen } = useRadar();
  const t = translations[locale];
  const [copiedShare, setCopiedShare] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);

  const postText = alert.post?.text || (alert as any).postSnippet || (alert as any).text || '';
  const postUrl = alert.post?.originalUrl || (alert as any).postUrl || (alert as any).url || 'https://facebook.com';
  const sourceName = alert.sourceName || (alert as any).displayName || 'Monitored Source';
  const sourceAvatar = alert.sourceAvatar || (alert as any).authorAvatar || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';
  const ruleName = alert.ruleName || (alert as any).ruleNaturalLanguage || 'Watch Rule';
  const reason = alert.reason || (alert as any).whyMatched || '';
  const mediaItems = alert.post?.media && Array.isArray(alert.post.media) ? alert.post.media : [];

  const handleCopyLink = () => {
    navigator.clipboard.writeText(postUrl);
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="modal-alert-detail"
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={sourceAvatar}
              alt={sourceName}
              className="w-8 h-8 rounded-lg object-cover border border-slate-700"
            />
            <div>
              <h3 className="text-sm font-bold text-slate-100">{sourceName}</h3>
              <p className="text-[11px] text-slate-400">{alert.createdAt || 'Recent'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Why you received this: HIGHLIGHTED SECTION 15 */}
          <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>{t.whyYouReceivedThis}</span>
            </div>
            <p className="text-xs text-slate-400">
              <strong>{t.ruleMatchedLabel}:</strong> "{ruleName}"
            </p>
            {reason && (
              <div className="text-sm font-medium text-slate-100 bg-slate-950/60 p-3 rounded-lg border border-cyan-500/20">
                {reason}
              </div>
            )}
          </div>

          {/* Extracted Structured Data if available */}
          {alert.extracted && Object.keys(alert.extracted).length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {t.extractedDataLabel}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(alert.extracted).map(([key, val]) => (
                  <div key={key} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <span className="text-slate-400 capitalize block text-[10px]">{key.replace('_', ' ')}</span>
                    <span className="font-bold text-slate-200">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Original Post Excerpt & Media */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {t.originalExcerpt}
            </span>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {postText}
            </div>

            {mediaItems.length > 0 && (
              <div className="rounded-xl overflow-hidden border border-slate-800 max-h-64 bg-slate-950">
                <img
                  src={mediaItems[0].url}
                  alt="Post visual"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>

          {/* Section 26: Share Alert Card Generator Toggle */}
          <div className="pt-2">
            <button
              onClick={() => setShowShareCard(!showShareCard)}
              className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition-colors"
            >
              <Share2 className="w-4 h-4 text-cyan-400" />
              <span>{t.shareAlertCard}</span>
            </button>

            {showShareCard && (
              <div className="mt-3 p-4 rounded-2xl bg-gradient-to-br from-slate-950 to-slate-900 border border-cyan-500/30 space-y-3">
                <div className="flex items-center justify-between text-[11px] text-cyan-400 font-semibold">
                  <span>{BRAND.name} • {BRAND.category}</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40">{alert.category || 'Alert'}</span>
                </div>
                <h4 className="font-bold text-sm text-slate-100">{sourceName}</h4>
                {reason && <p className="text-xs text-slate-300 italic">"{reason}"</p>}
                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                  >
                    {copiedShare ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedShare ? t.copied : 'Copy Share Card'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleSaveMatch(alert.id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-colors ${
                alert.isSaved
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <Bookmark className={`w-3.5 h-3.5 ${alert.isSaved ? 'fill-current' : ''}`} />
              <span>{alert.isSaved ? t.savedAlert : t.saveAlert}</span>
            </button>

            <button
              onClick={() => {
                onClose();
                setCurrentScreen('rules');
              }}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t.adjustRule}</span>
            </button>
          </div>

          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-500/20 transition-all"
          >
            <span>{t.openOriginal}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
