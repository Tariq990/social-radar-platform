import React, { useState } from 'react';
import { 
  Eye, 
  Plus, 
  Search, 
  Pause, 
  Play, 
  Trash2, 
  ExternalLink, 
  Sliders, 
  CheckCircle2, 
  Clock, 
  ShieldCheck, 
  Folder,
  SlidersHorizontal,
  MoreVertical,
  RotateCw
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { Source } from '../types';
import { translations } from '../lib/i18n';

export const WatchlistScreen: React.FC = () => {
  const { 
    sources, 
    collections, 
    toggleSourcePause, 
    deleteSource, 
    openAddSource, 
    locale, 
    setCurrentScreen 
  } = useRadar();
  const t = translations[locale];

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'facebook' | 'instagram' | 'active' | 'paused'>('all');
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

  // Filter sources
  const filteredSources = sources.filter((source) => {
    const matchesSearch = 
      source.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.handle.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeCollectionId && source.collectionId !== activeCollectionId) {
      return false;
    }

    if (activeFilter === 'facebook') return source.platform === 'facebook';
    if (activeFilter === 'instagram') return source.platform === 'instagram';
    if (activeFilter === 'active') return !source.isPaused;
    if (activeFilter === 'paused') return source.isPaused;

    return true;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t.watchlistTitle}</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {sources.length} {locale === 'ar' ? 'مصدر تحت المراقبة الذكية' : 'monitored sources with active rules'}
          </p>
        </div>

        <button
          id="btn-add-source-watchlist"
          onClick={() => openAddSource()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>{t.watchAction}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute start-3.5 top-3 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full ps-10 pe-4 py-2.5 text-xs sm:text-sm bg-slate-900 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
        />
      </div>

      {/* Collection Chips (Section 12: Groups & Folders) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => setActiveCollectionId(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeCollectionId === null
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <Folder className="w-3.5 h-3.5" />
          <span>{t.allSources}</span>
        </button>

        {collections.map((col) => {
          const isSelected = activeCollectionId === col.id;
          const name = locale === 'ar' && col.nameAr ? col.nameAr : col.name;
          return (
            <button
              key={col.id}
              onClick={() => setActiveCollectionId(isSelected ? null : col.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>{name}</span>
            </button>
          );
        })}
      </div>

      {/* Platform & Status Filters */}
      <div className="flex items-center gap-2 text-xs">
        {(['all', 'facebook', 'instagram', 'active', 'paused'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveFilter(tab)}
            className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
              activeFilter === tab
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'all' && t.filterAll}
            {tab === 'facebook' && 'Facebook'}
            {tab === 'instagram' && 'Instagram'}
            {tab === 'active' && t.filterActive}
            {tab === 'paused' && t.filterPaused}
          </button>
        ))}
      </div>

      {/* Sources Grid */}
      {filteredSources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSources.map((source) => (
            <div
              key={source.id}
              id={`source-card-${source.id}`}
              className={`p-4 rounded-2xl border transition-all ${
                source.isPaused
                  ? 'bg-slate-900/30 border-slate-800/60 opacity-70'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700 shadow-md'
              }`}
            >
              <div className="flex items-start gap-3">
                <img
                  src={source.avatarUrl}
                  alt={source.displayName}
                  className="w-12 h-12 rounded-xl object-cover border border-slate-700 flex-shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm text-slate-100 truncate">
                      {source.displayName}
                    </h3>
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {source.platform}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{source.handle}</p>

                  <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {t.lastChecked}: {source.lastCheckedAt}
                    </span>
                    <span>•</span>
                    <span className="text-cyan-400 font-medium">
                      {source.activeRulesCount} {t.rulesCount}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status & Action Buttons */}
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <span className={`w-2 h-2 rounded-full ${
                    source.isPaused ? 'bg-amber-400' : 'bg-emerald-400'
                  }`} />
                  <span className={source.isPaused ? 'text-amber-400' : 'text-emerald-400'}>
                    {source.isPaused ? t.statusPaused : t.statusActive}
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    ({source.visibilityType === 'authenticated' ? t.statusAuth : t.statusPublic})
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {/* Pause / Resume */}
                  <button
                    onClick={() => toggleSourcePause(source.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                    title={source.isPaused ? t.resumeMonitoring : t.pauseMonitoring}
                  >
                    {source.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>

                  {/* External Link */}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                    title="Open original link"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  {/* Delete */}
                  <button
                    onClick={() => deleteSource(source.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                    title={t.deleteSource}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <p className="text-xs text-slate-400">
            {locale === 'ar' ? 'لم يتم العثور على مصادر تطابق الفلتر' : 'No sources matched your current filter or search.'}
          </p>
        </div>
      )}
    </div>
  );
};
