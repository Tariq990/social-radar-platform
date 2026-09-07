import React from 'react';
import { 
  Sparkles, 
  RotateCw, 
  Plus, 
  Eye, 
  CheckCircle2, 
  Clock, 
  ArrowRight,
  ArrowLeft,
  SlidersHorizontal,
  Flame,
  ShieldCheck,
  Bell
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { AlertCard } from '../components/AlertCard';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

export const RadarHomeScreen: React.FC = () => {
  const { 
    matches, 
    sources, 
    rules, 
    digest, 
    openDigest, 
    openAddSource, 
    openAlertDetail, 
    scanAllSources, 
    isScanning,
    locale, 
    setCurrentScreen 
  } = useRadar();
  const t = translations[locale];

  // Priority matches: unread or high-confidence matches
  const priorityMatches = matches.slice(0, 5);

  const greeting = new Date().getHours() >= 17 ? t.greetingEvening : t.greetingDay;
  const summaryText = locale === 'ar' && digest.summaryAr ? digest.summaryAr : digest.summary;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Section: Radar Pulse & Greeting (Section 9) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight flex items-center gap-2.5">
            <span>{greeting}</span>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            <strong className="text-cyan-400 font-bold">{matches.length}</strong> {t.radarSummarySubtitle}
          </p>
        </div>

        {/* Primary "+ Watch" & "Scan Now" Quick Buttons */}
        <div className="flex items-center gap-2">
          <button
            id="btn-scan-radar-home"
            onClick={scanAllSources}
            disabled={isScanning}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? t.loading : t.seedActivity}</span>
          </button>

          <button
            id="btn-add-source-home"
            onClick={() => openAddSource()}
            className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-500/20 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{t.watchAction}</span>
          </button>
        </div>
      </div>

      {/* Subtle Counter Stats (Section 9: "Use subtle counters, not giant analytics charts") */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center sm:items-start">
          <span className="text-xl sm:text-2xl font-bold text-slate-100">{digest.scannedCount}</span>
          <span className="text-[11px] text-slate-400 mt-0.5">{t.scannedLabel}</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 flex flex-col items-center sm:items-start">
          <span className="text-xl sm:text-2xl font-bold text-cyan-400">{matches.length}</span>
          <span className="text-[11px] text-cyan-300/80 mt-0.5">{t.matchedLabel}</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center sm:items-start">
          <span className="text-xl sm:text-2xl font-bold text-slate-100">{sources.length}</span>
          <span className="text-[11px] text-slate-400 mt-0.5">{t.monitoredLabel}</span>
        </div>
      </div>

      {/* Daily AI Summary Card (Section 9: "Your radar in 30 seconds") */}
      <div 
        onClick={openDigest}
        className="group relative rounded-2xl p-4 sm:p-5 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 hover:border-amber-500/40 transition-all cursor-pointer shadow-lg shadow-black/40"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider">{t.quickDigestTitle}</h3>
              <p className="text-[11px] text-slate-500">{digest.generatedAt}</p>
            </div>
          </div>

          <span className="text-xs font-semibold text-slate-400 group-hover:text-amber-400 flex items-center gap-1 transition-colors">
            <span>{t.viewFullDigest}</span>
            {locale === 'ar' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
          </span>
        </div>

        <p className="mt-3 text-xs sm:text-sm text-slate-200 line-clamp-2 leading-relaxed">
          {summaryText}
        </p>
      </div>

      {/* Priority Matches List (Section 9) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-400" />
            <span>{t.priorityMatches}</span>
          </h2>
          <button
            onClick={() => setCurrentScreen('alerts')}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
          >
            {locale === 'ar' ? 'عرض الكل' : 'View all'} ({matches.length})
          </button>
        </div>

        {priorityMatches.length > 0 ? (
          <div className="space-y-3">
            {priorityMatches.map((match) => (
              <AlertCard
                key={match.id}
                alert={match}
                onOpenDetail={openAlertDetail}
              />
            ))}
          </div>
        ) : (
          /* Section 34: "You're all caught up. We scanned 84 new posts and none matched your rules." */
          <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{t.noMatchesYet}</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                {t.noMatchesSub}
              </p>
            </div>
            <button
              onClick={() => openAddSource()}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addFirstSource}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
