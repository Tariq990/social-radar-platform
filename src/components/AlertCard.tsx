import React from 'react';
import { 
  ExternalLink, 
  Bookmark, 
  Check, 
  ThumbsDown, 
  VolumeX, 
  Sparkles,
  CheckCircle2,
  Clock,
  Share2
} from 'lucide-react';
import { AlertMatch } from '../types';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';

interface AlertCardProps {
  alert: AlertMatch;
  onOpenDetail: (alert: AlertMatch) => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, onOpenDetail }) => {
  const { toggleSaveMatch, rateMatchFeedback, markMatchRead, locale } = useRadar();
  const t = translations[locale];

  const postText = alert.post?.text || (alert as any).postSnippet || (alert as any).text || '';
  const postUrl = alert.post?.originalUrl || (alert as any).postUrl || (alert as any).url || '#';
  const sourceName = alert.sourceName || (alert as any).displayName || 'Monitored Source';
  const sourceAvatar = alert.sourceAvatar || (alert as any).authorAvatar || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';
  const sourcePlatform = alert.sourcePlatform || (alert as any).platform || 'facebook';
  const ruleName = alert.ruleName || (alert as any).ruleNaturalLanguage || '';
  const reason = alert.reason || (alert as any).whyMatched || '';
  const mediaItems = alert.post?.media && Array.isArray(alert.post.media) ? alert.post.media : [];

  const handleCardClick = () => {
    markMatchRead(alert.id);
    onOpenDetail(alert);
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSaveMatch(alert.id);
  };

  const handleFeedbackClick = (e: React.MouseEvent, type: 'relevant' | 'not_relevant') => {
    e.stopPropagation();
    rateMatchFeedback(alert.id, type);
  };

  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (postUrl && postUrl !== '#') {
      window.open(postUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      id={`alert-card-${alert.id}`}
      onClick={handleCardClick}
      className={`group relative rounded-2xl border transition-all cursor-pointer p-4 sm:p-5 ${
        alert.isRead
          ? 'bg-slate-900/40 hover:bg-slate-900/80 border-slate-800/80'
          : 'bg-slate-900 hover:bg-slate-850 border-cyan-500/30 shadow-lg shadow-cyan-950/20'
      }`}
    >
      {/* Unread dot indicator */}
      {!alert.isRead && (
        <span className="absolute top-4 end-4 w-2 h-2 rounded-full bg-cyan-400" />
      )}

      {/* Top Source Meta Bar */}
      <div className="flex items-start gap-3 mb-3">
        <img
          src={sourceAvatar}
          alt={sourceName}
          className="w-10 h-10 rounded-xl object-cover border border-slate-700/80 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm text-slate-100 truncate group-hover:text-cyan-300 transition-colors">
              {sourceName}
            </h4>
            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">
              {sourcePlatform}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800/40 font-medium">
              {alert.category || 'Target'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {alert.createdAt || 'Recent'}
            </span>
            {ruleName && (
              <>
                <span>•</span>
                <span className="truncate text-slate-400 font-medium">
                  {ruleName}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Post Excerpt & Media */}
      <div className="flex flex-col sm:flex-row gap-3 my-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-slate-200 line-clamp-2 leading-relaxed">
            {postText}
          </p>
        </div>
        {mediaItems.length > 0 && (
          <div className="w-full sm:w-24 h-20 sm:h-20 rounded-xl overflow-hidden bg-slate-950 flex-shrink-0 border border-slate-800">
            <img
              src={mediaItems[0].url}
              alt="Media preview"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}
      </div>

      {/* AI Reason Callout Box */}
      {reason && (
        <div className="mt-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 text-xs text-slate-300">
          <div className="flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold text-cyan-300 mr-1">{t.whyMatchedTitle}</span>
              <span>{reason}</span>
            </div>
            {alert.confidence && (
              <span className="text-[10px] font-semibold text-cyan-400/80 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/30 flex-shrink-0">
                {Math.round(alert.confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bottom Actions Bar */}
      <div className="mt-3.5 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Open Original Source */}
          <button
            onClick={handleOpenOriginal}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
            title={t.openOriginal}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.openOriginal}</span>
          </button>

          {/* Bookmark / Save */}
          <button
            onClick={handleSaveClick}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
              alert.isSaved 
                ? 'text-amber-400 bg-amber-400/10' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={alert.isSaved ? t.savedAlert : t.saveAlert}
          >
            <Bookmark className={`w-3.5 h-3.5 ${alert.isSaved ? 'fill-current' : ''}`} />
            <span className="hidden sm:inline">{alert.isSaved ? t.savedAlert : t.saveAlert}</span>
          </button>
        </div>

        {/* Feedback buttons (Helpful / Not relevant) */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => handleFeedbackClick(e, 'relevant')}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              alert.feedback === 'relevant'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Mark as useful"
          >
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
            <span className="hidden sm:inline">{t.isRelevant}</span>
          </button>

          <button
            onClick={(e) => handleFeedbackClick(e, 'not_relevant')}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              alert.feedback === 'not_relevant'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Mark as not relevant"
          >
            <ThumbsDown className="w-3.5 h-3.5 inline mr-1" />
            <span className="hidden sm:inline">{t.notRelevant}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
