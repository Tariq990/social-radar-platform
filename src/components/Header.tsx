import React, { useState } from 'react';
import { Radar, Plus, RotateCw, Sparkles, Globe, Moon, Sun, CheckCircle2 } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

export const Header: React.FC = () => {
  const { locale, setLocale, theme, setTheme, openAddSource, scanAllSources, isScanning, openDigest, backendStatus } = useRadar();
  const [toast, setToast] = useState<string | null>(null);
  const t = translations[locale];

  const handleScan = async () => {
    const result = await scanAllSources();
    setToast(locale === 'ar'
      ? `انتهى الفحص: ${result.scanned} مصدر، ${result.matched} تنبيه جديد`
      : `Scan finished: ${result.scanned} sources, ${result.matched} new alerts`);
    window.setTimeout(() => setToast(null), 3000);
  };

  const statusLabel = backendStatus === 'online'
    ? (locale === 'ar' ? 'متصل' : 'Online')
    : backendStatus === 'offline'
      ? (locale === 'ar' ? 'غير متصل' : 'Offline')
      : (locale === 'ar' ? 'جاري الاتصال' : 'Connecting');

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-800/80 bg-slate-950/92 backdrop-blur-md">
      {toast && <div className="bg-cyan-500/10 border-b border-cyan-500/20 px-3 py-2 text-center text-xs font-medium text-cyan-300 flex items-center justify-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" />{toast}</div>}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 lg:hidden">
          <div className="w-9 h-9 rounded-xl bg-slate-900 border border-cyan-500/25 flex items-center justify-center flex-none"><Radar className="w-5 h-5 text-cyan-400" /></div>
          <div className="min-w-0 leading-tight"><div className="font-extrabold text-sm text-slate-100 tracking-tight">{BRAND.name}</div><div className="text-[10px] font-semibold text-cyan-400 truncate">{locale === 'ar' ? BRAND.categoryAr : BRAND.category}</div></div>
        </div>

        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400"><span className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-emerald-400' : backendStatus === 'offline' ? 'bg-rose-400' : 'bg-amber-400'}`} /><span>{statusLabel}</span></div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-none">
          <button onClick={openDigest} className="hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800" title={t.quickDigestTitle}><Sparkles className="w-4 h-4 text-amber-400" /></button>
          <button id="btn-scan-now" onClick={handleScan} disabled={isScanning} className="inline-flex items-center justify-center gap-1.5 w-9 h-9 sm:w-auto sm:px-3 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 disabled:opacity-50" title={t.seedActivity}><RotateCw className={`w-4 h-4 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} /><span className="hidden sm:inline text-xs font-semibold">{isScanning ? t.loading : t.seedActivity}</span></button>
          <button onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')} className="hidden md:inline-flex items-center gap-1 px-2.5 h-9 rounded-xl bg-slate-900 text-slate-300 border border-slate-800 text-xs"><Globe className="w-3.5 h-3.5" />{locale === 'en' ? 'عربي' : 'EN'}</button>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900 text-slate-300 border border-slate-800">{theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-cyan-400" />}</button>
          <button id="btn-add-watch-header" onClick={() => openAddSource()} className="inline-flex items-center justify-center gap-1.5 w-9 h-9 sm:w-auto sm:px-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold"><Plus className="w-4 h-4" /><span className="hidden sm:inline">{t.watchAction}</span></button>
        </div>
      </div>
    </header>
  );
};
