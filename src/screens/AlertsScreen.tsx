import React, { useState } from 'react';
import { 
  Bell, 
  Bookmark, 
  Sparkles, 
  Search, 
  Filter, 
  CheckCircle2, 
  ThumbsDown,
  VolumeX,
  ExternalLink
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { AlertCard } from '../components/AlertCard';
import { translations } from '../lib/i18n';

export const AlertsScreen: React.FC = () => {
  const { matches, openAlertDetail, locale, openAddSource } = useRadar();
  const t = translations[locale];

  const [activeTab, setActiveTab] = useState<'priority' | 'all' | 'saved'>('priority');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Derive unique categories
  const categories = Array.from(new Set(matches.map(m => m.category))).filter(Boolean);

  const filteredMatches = matches.filter((match) => {
    if (activeTab === 'saved') return match.isSaved;
    if (activeTab === 'priority') return !match.isRead || match.confidence >= 0.90;
    
    if (selectedCategory && match.category !== selectedCategory) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t.alertsTitle}</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {matches.length} {locale === 'ar' ? 'تنبيه ذكي مفروز بالذكاء الاصطناعي' : 'alerts strictly filtered to your intent'}
          </p>
        </div>

        {/* Top Tabs (Priority, All, Saved) */}
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('priority')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'priority'
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.tabPriority}
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'all'
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.tabAll}
          </button>
          <button
            onClick={() => setActiveTab('saved')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
              activeTab === 'saved'
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bookmark className="w-3 h-3" />
            <span>{t.tabSaved}</span>
          </button>
        </div>
      </div>

      {/* Category Filter Chips */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
              selectedCategory === null
                ? 'bg-slate-800 text-slate-100 border border-slate-700'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {t.filterAll}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Alerts List */}
      {filteredMatches.length > 0 ? (
        <div className="space-y-3">
          {filteredMatches.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onOpenDetail={openAlertDetail}
            />
          ))}
        </div>
      ) : (
        <div className="p-10 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">{t.emptyAlertsTitle}</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              {t.emptyAlertsSub}
            </p>
          </div>
          <button
            onClick={() => openAddSource()}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold"
          >
            <span>{t.watchAction}</span>
          </button>
        </div>
      )}
    </div>
  );
};
