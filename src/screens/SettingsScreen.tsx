import React, { useState } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  Lock, 
  Trash2, 
  Smartphone, 
  Bell, 
  Sparkles, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  Key,
  Sun,
  Moon,
  Globe
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

export const SettingsScreen: React.FC = () => {
  const { 
    user, 
    connectFacebookSession, 
    disconnectFacebookSession, 
    resetToDemo, 
    openPaywall, 
    locale,
    setLocale,
    theme,
    setTheme
  } = useRadar();
  const t = translations[locale];

  const [simulatingAuth, setSimulatingAuth] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [pushStatus, setPushStatus] = useState<'prompt' | 'granted'>(() => {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'prompt';
  });

  const handleConnectSession = () => {
    setSimulatingAuth(true);
    // Simulate secure device authentication bridge (Android WebView / Keystore)
    setTimeout(() => {
      connectFacebookSession('Alex C. (Secure Device Session)');
      setSimulatingAuth(false);
    }, 1200);
  };

  const handleRequestPush = async () => {
    if ('Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setPushStatus(permission === 'granted' ? 'granted' : 'prompt');
      } catch {
        setPushStatus('granted');
      }
    } else {
      setPushStatus('granted');
    }
  };

  return (
    <div className="space-y-6 pb-12 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">{t.settingsTitle}</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          {locale === 'ar' ? 'إدارة الخصوصية، الجلسات الموثقة، والتكامل' : 'Privacy controls, authenticated sessions & device integration'}
        </p>
      </div>

      {/* Theme & Display Mode Card */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              {theme === 'dark' ? <Moon className="w-4 h-4 text-cyan-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
              <span>{locale === 'ar' ? 'المظهر ونمط العرض' : 'Appearance & Theme'}</span>
            </h3>
            <p className="text-xs text-slate-400">
              {locale === 'ar' ? 'اختر بين الوضع الليلي المظلم أو الوضع النهاري الفاتح' : 'Choose between Night (Dark) and Day (Light) modes'}
            </p>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/40">
            {theme === 'dark' ? (locale === 'ar' ? 'الوضع الليلي' : 'Dark Mode') : (locale === 'ar' ? 'الوضع النهاري' : 'Light Mode')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`p-3 rounded-xl border flex items-center gap-3 transition-all cursor-pointer ${
              theme === 'dark'
                ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-300 ring-1 ring-cyan-500/40'
                : 'bg-slate-950 hover:bg-slate-850 border-slate-800 text-slate-400'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-cyan-400">
              <Moon className="w-4 h-4" />
            </div>
            <div className="text-start">
              <div className="text-xs font-bold text-slate-200">{locale === 'ar' ? 'الوضع الليلي' : 'Night (Dark)'}</div>
              <div className="text-[10px] text-slate-400">{locale === 'ar' ? 'مريح للعين ومناسب للمراقبة' : 'High contrast dark canvas'}</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`p-3 rounded-xl border flex items-center gap-3 transition-all cursor-pointer ${
              theme === 'light'
                ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-400 ring-1 ring-cyan-500/40'
                : 'bg-slate-950 hover:bg-slate-850 border-slate-800 text-slate-400'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center text-amber-500">
              <Sun className="w-4 h-4" />
            </div>
            <div className="text-start">
              <div className="text-xs font-bold text-slate-200">{locale === 'ar' ? 'الوضع النهاري' : 'Day (Light)'}</div>
              <div className="text-[10px] text-slate-400">{locale === 'ar' ? 'مشرق وواضح للقراءة' : 'Bright and crisp palette'}</div>
            </div>
          </button>
        </div>
      </div>

      {/* Section 21: Authenticated Facebook Session (Device Only) */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span>{t.authSessionTitle}</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-lg">
              {t.authSessionDesc}
            </p>
          </div>

          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1 ${
            user.deviceSessionConnected 
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-800 text-slate-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${user.deviceSessionConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {user.deviceSessionConnected ? t.sessionStatusConnected : t.sessionStatusDisconnected}
          </span>
        </div>

        {user.deviceSessionConnected && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 block text-[10px]">Active Local Identity:</span>
              <span className="font-semibold text-slate-200">{user.deviceSessionAccount}</span>
            </div>
            <span className="text-[11px] text-slate-500">Encrypted via Android Keystore</span>
          </div>
        )}

        <div className="pt-1 flex items-center gap-3">
          {user.deviceSessionConnected ? (
            <button
              onClick={disconnectFacebookSession}
              className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.disconnectSessionBtn}</span>
            </button>
          ) : (
            <button
              onClick={handleConnectSession}
              disabled={simulatingAuth}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
            >
              <Key className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{simulatingAuth ? t.loading : t.connectSessionBtn}</span>
            </button>
          )}
        </div>
      </div>

      {/* Section 32: Privacy & Security Guarantees */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{t.privacyGuaranteeTitle}</span>
        </h3>
        <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
          <p>{t.privacyP1}</p>
          <p>{t.privacyP2}</p>
          <p>{t.privacyP3}</p>
        </div>
      </div>

      {/* Device & PWA Controls */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-cyan-400" />
          <span>{t.deviceInfo}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-semibold text-slate-200 block">Android Share Target</span>
              <span className="text-slate-400 text-[11px]">Ready to receive links from Facebook/Instagram</span>
            </div>
            <span className="text-emerald-400 font-bold text-xs">Active</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-semibold text-slate-200 block">{t.pushNotificationsTitle}</span>
              <span className="text-slate-400 text-[11px]">Instant alerts for rule matches</span>
            </div>
            {pushStatus === 'granted' ? (
              <span className="text-emerald-400 font-bold text-xs">{t.pushEnabled}</span>
            ) : (
              <button
                onClick={handleRequestPush}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[11px] font-semibold"
              >
                {t.enablePushBtn}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Plan & Subscription (Section 25) */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-500/30 flex items-center justify-between gap-4">
        <div>
          <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">{t.currentPlanLabel}</span>
          <h4 className="text-base font-bold text-slate-100 capitalize">{user.plan} Radar Tier</h4>
          <p className="text-xs text-slate-400 mt-0.5">
            {locale === 'ar' ? 'تنبيهات فورية، ملخصات ذكية، ومصادر غير محدودة' : 'Instant monitoring, unlimited rules & daily summaries'}
          </p>
        </div>

        <button
          onClick={openPaywall}
          className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
        >
          {t.upgradePlanBtn}
        </button>
      </div>

      {/* Demo Controls */}
      <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          {locale === 'ar' ? 'خيارات المطور والبيئة التجريبية' : 'Environment & Testing'}
        </h3>
        <p className="text-xs text-slate-400">
          {locale === 'ar' 
            ? 'يمكنك إعادة ضبط الحساب وإرجاع المصادر والتنبيهات التجريبية الافتراضية في أي وقت.' 
            : 'Reset all modified data, sources, and alerts back to the clean demonstration state.'}
        </p>
        {showConfirmReset ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                resetToDemo();
                setShowConfirmReset(false);
              }}
              className="px-3.5 py-2 rounded-xl bg-rose-500 text-white text-xs font-bold"
            >
              {locale === 'ar' ? 'تأكيد إعادة الضبط' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => setShowConfirmReset(false)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs"
            >
              {t.cancel}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmReset(true)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.resetData}</span>
          </button>
        )}
      </div>
    </div>
  );
};
