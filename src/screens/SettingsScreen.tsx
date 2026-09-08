import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Trash2,
  Smartphone,
  Key,
  Sun,
  Moon,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Server
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';

export const SettingsScreen: React.FC = () => {
  const {
    user,
    connectFacebookSession,
    disconnectFacebookSession,
    refreshDeviceSession,
    resetToDemo,
    openPaywall,
    locale,
    theme,
    setTheme,
    deviceSessionAvailable,
    backendStatus,
    isPostgres,
    aiConfigured,
    monitoringMode
  } = useRadar();
  const t = translations[locale];

  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [pushStatus, setPushStatus] = useState<'prompt' | 'granted'>(() =>
    typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'prompt'
  );

  const handleConnectSession = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await connectFacebookSession();
      const connected = await refreshDeviceSession();
      if (!connected) setAuthError('Facebook login was not completed.');
    } catch (error: any) {
      setAuthError(error?.message || 'Could not connect the local Facebook session.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDisconnectSession = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await disconnectFacebookSession();
    } catch (error: any) {
      setAuthError(error?.message || 'Could not clear the local Facebook session.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRequestPush = async () => {
    if (!('Notification' in window)) return;
    try {
      const permission = await Notification.requestPermission();
      setPushStatus(permission === 'granted' ? 'granted' : 'prompt');
    } catch {
      setPushStatus('prompt');
    }
  };

  return (
    <div className="space-y-6 pb-12 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">{t.settingsTitle}</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          {locale === 'ar' ? 'إدارة الخصوصية، جلسة الجهاز، وإعدادات التطبيق' : 'Privacy, authenticated device session, and application settings'}
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              {theme === 'dark' ? <Moon className="w-4 h-4 text-cyan-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
              <span>{locale === 'ar' ? 'المظهر' : 'Appearance'}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'اختر الوضع الليلي أو النهاري.' : 'Choose dark or light mode.'}</p>
          </div>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {theme === 'dark' ? 'Dark' : 'Light'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setTheme('dark')} className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${theme === 'dark' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}>
            <Moon className="w-4 h-4" /> Dark
          </button>
          <button type="button" onClick={() => setTheme('light')} className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${theme === 'light' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400' : 'border-slate-800 bg-slate-950 text-slate-400'}`}>
            <Sun className="w-4 h-4" /> Light
          </button>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span>{t.authSessionTitle}</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">
              {deviceSessionAvailable
                ? (locale === 'ar' ? 'سجّل الدخول إلى Facebook داخل نافذة التطبيق المخصصة. بيانات الجلسة تبقى محلياً على جهاز Android.' : 'Sign in to Facebook in the dedicated app WebView. The authenticated browser session stays locally on this Android device.')
                : (locale === 'ar' ? 'المراقبة الموثقة متاحة داخل تطبيق Android فقط.' : 'Authenticated Facebook monitoring requires the Android app.')}
            </p>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${user.deviceSessionConnected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
            {user.deviceSessionConnected ? t.sessionStatusConnected : t.sessionStatusDisconnected}
          </span>
        </div>

        {user.deviceSessionConnected && (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              <span>{locale === 'ar' ? 'جلسة Facebook محلية متصلة' : 'Local Facebook session connected'}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              {locale === 'ar' ? 'لا يتم إرسال كلمة المرور أو ملفات تعريف الارتباط الخام إلى الخادم.' : 'The password and raw Facebook cookies are not sent to the backend.'}
            </p>
          </div>
        )}

        {authError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {authError}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {user.deviceSessionConnected ? (
            <button onClick={handleDisconnectSession} disabled={authBusy} className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> {t.disconnectSessionBtn}
            </button>
          ) : (
            <button onClick={handleConnectSession} disabled={authBusy || !deviceSessionAvailable} className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold flex items-center gap-2 disabled:opacity-40">
              <Key className="w-3.5 h-3.5" /> {authBusy ? t.loading : t.connectSessionBtn}
            </button>
          )}
          {deviceSessionAvailable && (
            <button onClick={() => refreshDeviceSession()} disabled={authBusy} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold disabled:opacity-50">
              {locale === 'ar' ? 'فحص الجلسة' : 'Test Session'}
            </button>
          )}
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{t.privacyGuaranteeTitle}</span>
        </h3>
        <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
          <p>{locale === 'ar' ? 'تسجيل الدخول يتم مباشرة داخل موقع Facebook الحقيقي في WebView مخصص.' : 'Login happens directly on the real Facebook site inside a dedicated WebView.'}</p>
          <p>{locale === 'ar' ? 'الخادم يستقبل بيانات المنشورات المطبّعة اللازمة للمراقبة فقط، وليس جلسة Facebook الخام.' : 'The backend receives normalized post data needed for monitoring, not the raw Facebook browser session.'}</p>
          <p>{locale === 'ar' ? 'قطع الاتصال يمسح جلسة WebView المحلية ويوقف مهام المراقبة المجدولة.' : 'Disconnect clears the local WebView session and cancels scheduled authenticated monitoring jobs.'}</p>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-400" />
          <span>{locale === 'ar' ? 'حالة النظام' : 'System Status'}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <StatusItem label="Backend" ok={backendStatus === 'online'} detail={backendStatus} />
          <StatusItem label="PostgreSQL" ok={isPostgres} detail={isPostgres ? 'Connected' : 'Not connected'} />
          <StatusItem label="AI engine" ok={aiConfigured} detail={aiConfigured ? 'Operator configured' : 'Not configured'} />
          <StatusItem label="Monitoring" ok={monitoringMode === 'device_session' ? deviceSessionAvailable : true} detail={monitoringMode === 'device_session' ? 'Android device session' : 'Optional public provider'} />
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-cyan-400" /> {t.deviceInfo}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <StatusItem label="Android Share Target" ok={deviceSessionAvailable} detail={deviceSessionAvailable ? 'Native app detected' : 'Web mode'} />
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <span className="font-semibold text-slate-200 block">{t.pushNotificationsTitle}</span>
              <span className="text-[11px] text-slate-500">{pushStatus === 'granted' ? t.pushEnabled : 'Permission not granted'}</span>
            </div>
            {pushStatus !== 'granted' && <button onClick={handleRequestPush} className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[11px]">{t.enablePushBtn}</button>}
          </div>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-cyan-500/20 flex items-center justify-between gap-4">
        <div>
          <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">{t.currentPlanLabel}</span>
          <h4 className="text-base font-bold text-slate-100 capitalize">{user.plan} Radar Tier</h4>
        </div>
        <button onClick={openPaywall} className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold">{t.upgradePlanBtn}</button>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{locale === 'ar' ? 'البيئة التجريبية' : 'Demo Environment'}</h3>
        <p className="text-xs text-slate-400">{locale === 'ar' ? 'بيانات العرض التجريبية منفصلة عن مسار الإنتاج.' : 'Demo data is isolated from the production monitoring path.'}</p>
        {showConfirmReset ? (
          <div className="flex gap-2">
            <button onClick={() => { resetToDemo(); setShowConfirmReset(false); }} className="px-3.5 py-2 rounded-xl bg-rose-500 text-white text-xs font-bold">{locale === 'ar' ? 'تأكيد' : 'Confirm'}</button>
            <button onClick={() => setShowConfirmReset(false)} className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs">{t.cancel}</button>
          </div>
        ) : (
          <button onClick={() => setShowConfirmReset(true)} className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-2">
            <RotateCcw className="w-3.5 h-3.5" /> {t.resetData}
          </button>
        )}
      </div>
    </div>
  );
};

const StatusItem: React.FC<{ label: string; ok: boolean; detail: string }> = ({ label, ok, detail }) => (
  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
    <div>
      <span className="font-semibold text-slate-200 block">{label}</span>
      <span className="text-[11px] text-slate-500">{detail}</span>
    </div>
    <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>{ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}</span>
  </div>
);
