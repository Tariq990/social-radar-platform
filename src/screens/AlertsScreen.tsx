import React, { useState } from 'react';
import { Bell, Bookmark } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { AlertCard } from '../components/AlertCard';
import { translations } from '../lib/i18n';

export const AlertsScreen: React.FC = () => {
  const { matches, openAlertDetail, locale, openAddSource } = useRadar();
  const t = translations[locale];
  const [activeTab, setActiveTab] = useState<'priority' | 'all' | 'saved'>('priority');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const categories = Array.from(new Set(matches.map(match => match.category).filter(Boolean)));

  const filteredMatches = matches.filter(match => {
    const tabMatch = activeTab === 'saved'
      ? match.isSaved
      : activeTab === 'priority'
        ? (!match.isRead || match.confidence >= 0.9)
        : true;
    const categoryMatch = !selectedCategory || match.category === selectedCategory;
    return tabMatch && categoryMatch;
  });

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-100">{t.alertsTitle}</h1><p className="text-xs text-slate-400 mt-1">{matches.length} {locale === 'ar' ? 'تنبيه مطابق لقواعدك' : 'alerts matched to your rules'}</p></div>
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl self-start sm:self-auto">
          {(['priority', 'all', 'saved'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${activeTab === tab ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}>
              {tab === 'saved' && <Bookmark className="w-3 h-3" />}{tab === 'priority' ? t.tabPriority : tab === 'all' ? t.tabAll : t.tabSaved}
            </button>
          ))}
        </div>
      </div>

      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button onClick={() => setSelectedCategory(null)} className={`px-3 py-1.5 rounded-lg whitespace-nowrap border ${selectedCategory === null ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>{t.filterAll}</button>
          {categories.map(category => <button key={category} onClick={() => setSelectedCategory(selectedCategory === category ? null : category)} className={`px-3 py-1.5 rounded-lg whitespace-nowrap border ${selectedCategory === category ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>{category}</button>)}
        </div>
      )}

      {filteredMatches.length > 0 ? (
        <div className="space-y-3">{filteredMatches.map(alert => <AlertCard key={alert.id} alert={alert} onOpenDetail={openAlertDetail} />)}</div>
      ) : (
        <div className="p-10 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 mx-auto flex items-center justify-center"><Bell className="w-6 h-6" /></div>
          <div><h3 className="text-sm font-bold text-slate-100">{t.emptyAlertsTitle}</h3><p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">{selectedCategory ? (locale === 'ar' ? 'لا توجد تنبيهات ضمن هذا التصنيف.' : 'No alerts in this category.') : t.emptyAlertsSub}</p></div>
          {matches.length === 0 && <button onClick={() => openAddSource()} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold">{t.watchAction}</button>}
        </div>
      )}
    </div>
  );
};
