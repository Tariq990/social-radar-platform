import React, { useMemo, useState } from 'react';
import { Plus, Search, Pause, Play, Trash2, ExternalLink, Clock, Folder } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { SourceAvatar } from '../components/SourceAvatar';

export const WatchlistScreen: React.FC = () => {
  const { sources, collections, toggleSourcePause, deleteSource, openAddSource, locale } = useRadar();
  const t = translations[locale];
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'facebook' | 'instagram' | 'active' | 'paused'>('all');
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

  const visibleCollections = useMemo(
    () => collections.filter(collection => sources.some(source => source.collectionId === collection.id)),
    [collections, sources]
  );

  const filteredSources = sources.filter(source => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query || source.displayName.toLowerCase().includes(query) || source.handle.toLowerCase().includes(query);
    if (!matchesSearch) return false;
    if (activeCollectionId && source.collectionId !== activeCollectionId) return false;
    if (activeFilter === 'facebook') return source.platform === 'facebook';
    if (activeFilter === 'instagram') return source.platform === 'instagram';
    if (activeFilter === 'active') return !source.isPaused;
    if (activeFilter === 'paused') return source.isPaused;
    return true;
  });

  const confirmDelete = (sourceId: string, name: string) => {
    const ok = window.confirm(locale === 'ar' ? `حذف ${name} من المراقبة؟` : `Remove ${name} from monitoring?`);
    if (ok) void deleteSource(sourceId);
  };

  return (
    <div className="space-y-5 pb-12">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-100">{t.watchlistTitle}</h1>
          <p className="text-xs text-slate-400 mt-1">{sources.length} {locale === 'ar' ? 'مصدر تحت المراقبة' : 'monitored sources'}</p>
        </div>
        <button id="btn-add-source-watchlist" onClick={() => openAddSource()} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex-none">
          <Plus className="w-4 h-4" /> <span>{t.watchAction}</span>
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute start-3.5 top-3 text-slate-400" />
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t.searchPlaceholder} className="w-full ps-10 pe-4 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500" />
      </div>

      {visibleCollections.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button onClick={() => setActiveCollectionId(null)} className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border flex items-center gap-1.5 ${activeCollectionId === null ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>
            <Folder className="w-3.5 h-3.5" />{t.allSources}
          </button>
          {visibleCollections.map(collection => (
            <button key={collection.id} onClick={() => setActiveCollectionId(activeCollectionId === collection.id ? null : collection.id)} className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border ${activeCollectionId === collection.id ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>
              {locale === 'ar' && collection.nameAr ? collection.nameAr : collection.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs pb-1">
        {(['all', 'facebook', 'instagram', 'active', 'paused'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveFilter(tab)} className={`px-3 py-1.5 rounded-lg whitespace-nowrap ${activeFilter === tab ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
            {tab === 'all' ? t.filterAll : tab === 'facebook' ? 'Facebook' : tab === 'instagram' ? 'Instagram' : tab === 'active' ? t.filterActive : t.filterPaused}
          </button>
        ))}
      </div>

      {filteredSources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSources.map(source => (
            <article key={source.id} id={`source-card-${source.id}`} className={`p-4 rounded-2xl border ${source.isPaused ? 'bg-slate-900/40 border-slate-800 opacity-70' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}>
              <div className="flex items-start gap-3">
                <SourceAvatar src={source.avatarUrl} name={source.displayName} platform={source.platform} className="w-12 h-12 rounded-xl" iconClassName="w-5 h-5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0"><h3 className="font-bold text-sm text-slate-100 truncate">{source.displayName}</h3><span className="text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 flex-none">{source.platform}</span></div>
                  <p dir="ltr" className="text-xs text-slate-400 truncate text-left mt-0.5">{source.handle ? `@${source.handle.replace(/^@/, '')}` : source.url}</p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500"><Clock className="w-3 h-3" /><span>{t.lastChecked}: {source.lastCheckedAt || '—'}</span><span>•</span><span className="text-cyan-400">{source.activeRulesCount} {t.rulesCount}</span></div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium"><span className={`w-2 h-2 rounded-full ${source.isPaused ? 'bg-amber-400' : source.connectorStatus === 'needs_relogin' ? 'bg-rose-400' : 'bg-emerald-400'}`} /><span className={source.isPaused ? 'text-amber-400' : source.connectorStatus === 'needs_relogin' ? 'text-rose-300' : 'text-emerald-400'}>{source.isPaused ? t.statusPaused : source.connectorStatus === 'needs_relogin' ? (locale === 'ar' ? 'يحتاج إعادة ربط' : 'Reconnect needed') : t.statusActive}</span></div>
                <div className="flex items-center gap-1">
                  <button onClick={() => void toggleSourcePause(source.id)} className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800" title={source.isPaused ? t.resumeMonitoring : t.pauseMonitoring}>{source.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</button>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800" title={locale === 'ar' ? 'فتح المصدر' : 'Open source'}><ExternalLink className="w-4 h-4" /></a>
                  <button onClick={() => confirmDelete(source.id, source.displayName)} className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800" title={t.deleteSource}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-10 rounded-2xl bg-slate-900/40 border border-slate-800 text-center"><p className="text-sm text-slate-400">{sources.length === 0 ? (locale === 'ar' ? 'لا توجد مصادر بعد.' : 'No sources yet.') : (locale === 'ar' ? 'لا توجد نتائج تطابق الفلتر.' : 'No sources match this filter.')}</p></div>
      )}
    </div>
  );
};
