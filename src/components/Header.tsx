import React, { useState } from 'react';
import {
  Radar,
  Plus,
  RotateCw,
  Sparkles,
  Globe,
  Moon,
  Sun,
  CheckCircle2,
  ShieldCheck,
  Home,
  LogOut
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';
import { apiLogout } from '../services/api';

export const Header: React.FC = () => {
  const {
    locale,
    setLocale,
    theme,
    setTheme,
    openAddSource,
    scanAllSources,
    isScanning,
    matches,
    openDigest,
    openPaywall,
    user,
    setCurrentScreen,
    backendStatus
  } = useRadar();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const t = translations[locale];

  const handleScan = async () => {
    const res = await scanAllSources();
    setToastMessage(`${t.scanSuccess} (+${res.scanned} ${t.scannedLabel})`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiLogout();
    } finally {
      window.location.replace('/');
    }
  };

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md transition-colors">
      {toastMessage && (
        <div className="bg-cyan-500/10 border-b border-cyan-500/20 px-4 py-2 text-center text-xs font-medium text-cyan-300 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 lg:hidden">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-sm shadow-cyan-500/20">
            <Radar className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-slate-100 tracking-tight">{BRAND.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 font-medium">
                {locale === 'ar' ? BRAND.categoryAr : BRAND.category}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
              {locale === 'ar' ? BRAND.taglineAr : BRAND.tagline}
            </p>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {locale === 'ar' ? 'الرادار نشط' : 'Radar Online'}
            </span>
            <span className="text-xs text-slate-400">
              {locale === 'ar' ? BRAND.taglineAr : BRAND.tagline}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            id="btn-quick-digest"
            onClick={openDigest}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors"
            title={t.quickDigestTitle}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{locale === 'ar' ? 'ملخص 30ث' : '30s Digest'}</span>
          </button>

          <button
            id="btn-scan-now"
            onClick={handleScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors disabled:opacity-50"
            title={t.seedActivity}
          >
            <RotateCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isScanning ? t.loading : t.seedActivity}</span>
          </button>

          <div
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-900 border border-slate-800 text-slate-300"
            title="MR SCRAP backend status"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>{backendStatus === 'online' ? (locale === 'ar' ? 'الخادم متصل' : 'Backend Live') : 'Connecting...'}</span>
          </div>

          <button
            id="btn-header-home"
            onClick={() => setCurrentScreen('landing')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors cursor-pointer"
            title={locale === 'ar' ? 'الرجوع إلى صفحة الموقع الرئيسية' : 'Return to Website Homepage'}
          >
            <Home className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">{locale === 'ar' ? 'الموقع' : 'Site'}</span>
          </button>

          <button
            id="btn-lang-toggle"
            onClick={toggleLanguage}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors"
            title="Switch Language / تغيير اللغة"
          >
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>{locale === 'en' ? 'عربي' : 'EN'}</span>
          </button>

          <button
            id="btn-theme-toggle"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all active:scale-95 cursor-pointer shadow-xs"
            title={theme === 'dark' ? (locale === 'ar' ? 'التحويل إلى الوضع الفاتح' : 'Switch to Light Mode') : (locale === 'ar' ? 'التحويل إلى الوضع الداكن' : 'Switch to Dark Mode')}
            aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? (
              <><Sun className="w-3.5 h-3.5 text-amber-400" /><span className="hidden md:inline text-[11px] font-semibold">{locale === 'ar' ? 'فاتح' : 'Light'}</span></>
            ) : (
              <><Moon className="w-3.5 h-3.5 text-cyan-400" /><span className="hidden md:inline text-[11px] font-semibold">{locale === 'ar' ? 'داكن' : 'Dark'}</span></>
            )}
          </button>

          <button
            id="btn-plan-badge"
            onClick={openPaywall}
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-950 text-cyan-400 border border-cyan-800/40 hover:bg-cyan-900/40 transition-colors uppercase tracking-wider"
          >
            <ShieldCheck className="w-3 h-3" />
            <span>{user.plan}</span>
          </button>

          <button
            id="btn-logout"
            onClick={handleLogout}
            disabled={loggingOut}
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-300 border border-slate-800 transition-colors disabled:opacity-50"
            title={locale === 'ar' ? 'تسجيل الخروج وإلغاء صلاحيات الجهاز' : 'Sign out and revoke device authorization'}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{locale === 'ar' ? 'خروج' : 'Logout'}</span>
          </button>

          <button
            id="btn-add-watch-header"
            onClick={() => openAddSource()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-sm shadow-cyan-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{t.watchAction}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
