import React, { useEffect, useState } from 'react';
import { Facebook, Instagram, Lock, LogOut, Moon, ShieldCheck, Sun, Trash2, CheckCircle2, AlertCircle, RotateCcw, Languages } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { apiLogout } from '../services/api';
import { DeviceSessionConnector, NativeSessionStatus } from '../connectors/deviceSessionConnector';

export const SettingsScreen: React.FC = () => {
  const { locale, setLocale, theme, setTheme, deviceSessionAvailable, refreshDeviceSession, resetToDemo, isDemoMode } = useRadar();
  const t = translations[locale];
  const [status, setStatus] = useState<NativeSessionStatus>({ available: deviceSessionAvailable, connected: false, facebookConnected: false, instagramConnected: false });
  const [busy, setBusy] = useState<'facebook' | 'instagram' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const refresh = async () => {
    try {
      const next = await DeviceSessionConnector.getLocalSession();
      setStatus(next);
      await refreshDeviceSession().catch(() => false);
    } catch {
      setStatus({ available: deviceSessionAvailable, connected: false, facebookConnected: false, instagramConnected: false });
    }
  };

  useEffect(() => { void refresh(); }, []);

  const connect = async (platform: 'facebook' | 'instagram') => {
    setBusy(platform);
    setError(null);
    try {
      const connected = platform === 'instagram' ? await DeviceSessionConnector.connectInstagram() : await DeviceSessionConnector.connectFacebook();
      if (!connected) throw new Error(locale === 'ar' ? 'لم يكتمل تسجيل الدخول.' : 'Login was not completed.');
      await refresh();
    } catch (err: any) {
      setError(err?.message || (locale === 'ar' ? 'تعذر ربط الحساب.' : 'Could not connect the account.'));
    } finally { setBusy(null); }
  };

  const disconnect = async (platform: 'facebook' | 'instagram') => {
    setBusy(platform);
    setError(null);
    try {
      if (platform === 'instagram') await DeviceSessionConnector.disconnectInstagram();
      else await DeviceSessionConnector.disconnectFacebook();
      await refresh();
    } catch (err: any) {
      setError(err?.message || (locale === 'ar' ? 'تعذر قطع الاتصال.' : 'Could not disconnect.'));
    } finally { setBusy(null); }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await apiLogout(); } finally { window.location.replace('/'); }
  };

  return (
    <div className="space-y-5 pb-12 max-w-3xl">
      <div><h1 className="text-2xl font-bold text-slate-100">{t.settingsTitle}</h1><p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'الحسابات المتصلة وإعدادات التطبيق' : 'Connected accounts and app settings'}</p></div>

      <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2"><Lock className="w-4 h-4 text-cyan-400" /><div><h2 className="text-sm font-bold text-slate-100">{locale === 'ar' ? 'حسابات المنصات' : 'Platform accounts'}</h2><p className="text-xs text-slate-400 mt-0.5">{locale === 'ar' ? 'اربط كل منصة مرة واحدة ليستخدم التطبيق جلستها المحلية عند المراقبة.' : 'Connect each platform once so the app can use its local session for monitoring.'}</p></div></div>
        {!deviceSessionAvailable && <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">{locale === 'ar' ? 'ربط Facebook وInstagram متاح داخل تطبيق Android.' : 'Facebook and Instagram connection is available in the Android app.'}</div>}
        {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex gap-2"><AlertCircle className="w-4 h-4 flex-none" /><span>{error}</span></div>}
        <PlatformConnectionCard platform="facebook" label="Facebook" connected={status.facebookConnected === true} busy={busy === 'facebook'} disabled={!deviceSessionAvailable || busy !== null} locale={locale} onConnect={() => connect('facebook')} onDisconnect={() => disconnect('facebook')} />
        <PlatformConnectionCard platform="instagram" label="Instagram" connected={status.instagramConnected === true} busy={busy === 'instagram'} disabled={!deviceSessionAvailable || busy !== null} locale={locale} onConnect={() => connect('instagram')} onDisconnect={() => disconnect('instagram')} />
        <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] leading-5 text-slate-400"><ShieldCheck className="w-4 h-4 text-emerald-400 flex-none mt-0.5" /><span>{locale === 'ar' ? 'تسجيل الدخول يتم داخل الموقع الحقيقي للمنصة. MR SCRAP لا يقرأ كلمة المرور ولا يرسل ملفات تعريف الارتباط الخام إلى الخادم.' : 'Login happens on the platform’s real website. MR SCRAP does not read passwords or send raw browser cookies to the backend.'}</span></div>
      </section>

      <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div><h2 className="text-sm font-bold text-slate-100">{locale === 'ar' ? 'الواجهة' : 'Interface'}</h2><p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'اللغة والمظهر.' : 'Language and appearance.'}</p></div>
        <div className="space-y-2"><span className="text-xs text-slate-400 flex items-center gap-1.5"><Languages className="w-3.5 h-3.5" />{locale === 'ar' ? 'اللغة' : 'Language'}</span><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setLocale('ar')} className={`p-3 rounded-xl border text-xs font-semibold ${locale === 'ar' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}>العربية</button><button type="button" onClick={() => setLocale('en')} className={`p-3 rounded-xl border text-xs font-semibold ${locale === 'en' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}>English</button></div></div>
        <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setTheme('dark')} className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 ${theme === 'dark' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}><Moon className="w-4 h-4" />{locale === 'ar' ? 'داكن' : 'Dark'}</button><button type="button" onClick={() => setTheme('light')} className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 ${theme === 'light' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400' : 'border-slate-800 bg-slate-950 text-slate-400'}`}><Sun className="w-4 h-4" />{locale === 'ar' ? 'فاتح' : 'Light'}</button></div>
      </section>

      {isDemoMode && <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-100">{locale === 'ar' ? 'بيئة العرض' : 'Demo environment'}</h2><p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'إعادة بيانات العرض فقط.' : 'Reset demo-only data.'}</p></div><button onClick={resetToDemo} className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold flex gap-2 items-center"><RotateCcw className="w-3.5 h-3.5" />{locale === 'ar' ? 'إعادة' : 'Reset'}</button></section>}

      <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-4"><div><h2 className="text-sm font-bold text-slate-100">{locale === 'ar' ? 'حساب MR SCRAP' : 'MR SCRAP account'}</h2><p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'تسجيل الخروج من حساب التطبيق.' : 'Sign out of your app account.'}</p></div><button onClick={logout} disabled={loggingOut} className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"><LogOut className="w-3.5 h-3.5" />{loggingOut ? (locale === 'ar' ? 'جاري الخروج...' : 'Signing out...') : (locale === 'ar' ? 'تسجيل الخروج' : 'Sign out')}</button></section>
    </div>
  );
};

const PlatformConnectionCard: React.FC<{ platform: 'facebook' | 'instagram'; label: string; connected: boolean; busy: boolean; disabled: boolean; locale: 'ar' | 'en'; onConnect: () => void; onDisconnect: () => void; }> = ({ platform, label, connected, busy, disabled, locale, onConnect, onDisconnect }) => {
  const Icon = platform === 'instagram' ? Instagram : Facebook;
  return <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center flex-none"><Icon className="w-5 h-5 text-cyan-400" /></div><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-slate-100">{label}</h3>{connected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}</div><p className={`text-xs mt-0.5 ${connected ? 'text-emerald-400' : 'text-slate-500'}`}>{connected ? (locale === 'ar' ? 'متصل' : 'Connected') : (locale === 'ar' ? 'غير متصل' : 'Not connected')}</p></div></div>{connected ? <button onClick={onDisconnect} disabled={disabled} className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 disabled:opacity-40 flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />{busy ? '...' : (locale === 'ar' ? 'قطع' : 'Disconnect')}</button> : <button onClick={onConnect} disabled={disabled} className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-cyan-500 disabled:opacity-40">{busy ? (locale === 'ar' ? 'جاري الربط...' : 'Connecting...') : (locale === 'ar' ? 'ربط' : 'Connect')}</button>}</div>;
};
