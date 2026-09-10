import React, { useEffect, useMemo, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

import {
  AndroidUpdateDecision,
  checkAndroidUpdate,
  getInstalledAndroidVersion,
  installAndroidUpdate,
  isNativeAndroid
} from '../services/appUpdate';

const CACHE_KEY = 'mrscrap_required_android_update_v1';
const LOCALE_KEY = 'mrscrap_locale_v2';

interface Props {
  children: React.ReactNode;
}

function readCachedDecision(): AndroidUpdateDecision | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.updateRequired === true &&
      Number.isInteger(parsed.versionCode) &&
      parsed.versionCode > 0 &&
      typeof parsed.sha256 === 'string' &&
      typeof parsed.downloadPath === 'string'
    ) {
      return parsed as AndroidUpdateDecision;
    }
  } catch {
    // Ignore corrupt cache data.
  }
  return null;
}

function cacheDecision(decision: AndroidUpdateDecision | null) {
  try {
    if (decision?.updateRequired) localStorage.setItem(CACHE_KEY, JSON.stringify(decision));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // localStorage can be unavailable on hardened WebViews; the online check still works.
  }
}

export const ForceUpdateGate: React.FC<Props> = ({ children }) => {
  // Native builds start covered from the first render. Children stay mounted behind the cover so
  // authentication/session bootstrap can run in parallel without exposing an unchecked app UI.
  const [checking, setChecking] = useState(() => isNativeAndroid());
  const [requiredUpdate, setRequiredUpdate] = useState<AndroidUpdateDecision | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');
  const [lastError, setLastError] = useState('');

  const isArabic = useMemo(() => {
    try {
      const stored = localStorage.getItem(LOCALE_KEY);
      if (stored === 'ar') return true;
      if (stored === 'en') return false;
      return (navigator.language || '').toLowerCase().startsWith('ar');
    } catch {
      return false;
    }
  }, []);

  const refresh = async () => {
    if (!isNativeAndroid()) {
      setChecking(false);
      setRequiredUpdate(null);
      return;
    }

    setChecking(true);
    try {
      const { installed, decision } = await checkAndroidUpdate();
      if (decision.updateRequired && decision.versionCode && decision.versionCode > installed.versionCode) {
        cacheDecision(decision);
        setRequiredUpdate(decision);
      } else {
        cacheDecision(null);
        setRequiredUpdate(null);
      }
      setLastError('');
    } catch (error) {
      // If this device previously learned that an update is mandatory, keep the app blocked even
      // when the network is temporarily unavailable. A device that has never seen an update fails
      // open so a backend outage cannot brick a fresh install.
      try {
        const installed = await getInstalledAndroidVersion();
        const cached = readCachedDecision();
        if (cached?.versionCode && cached.versionCode > installed.versionCode) {
          setRequiredUpdate(cached);
        }
      } catch {
        // The native plugin itself being unavailable should not affect web builds.
      }
      setLastError((error as Error)?.message || 'Could not check for updates');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!isNativeAndroid()) return;
    void refresh();

    let removeListener: (() => Promise<void>) | undefined;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh();
    }).then(handle => {
      removeListener = () => handle.remove();
    });

    return () => {
      if (removeListener) void removeListener();
    };
  }, []);

  const startUpdate = async () => {
    if (!requiredUpdate || installing) return;
    setInstalling(true);
    setLastError('');
    setMessage(isArabic ? 'جاري تجهيز التحديث...' : 'Preparing the update...');

    try {
      const result = await installAndroidUpdate(requiredUpdate);
      if (result.permissionRequired) {
        setMessage(isArabic
          ? 'اسمح لـ MR SCRAP بتثبيت التطبيقات من هذا المصدر، ثم ارجع واضغط تحديث مرة أخرى.'
          : 'Allow MR SCRAP to install apps from this source, then return and press Update again.');
      } else if (result.started) {
        setMessage(isArabic
          ? 'تم تنزيل التحديث والتحقق منه. أكمل التثبيت من شاشة Android التي ظهرت.'
          : 'The update was downloaded and verified. Complete installation in the Android installer.');
      }
    } catch (error) {
      setLastError((error as Error)?.message || 'Update installation failed');
      setMessage('');
    } finally {
      setInstalling(false);
    }
  };

  if (!isNativeAndroid()) return <>{children}</>;

  if (!requiredUpdate) {
    return (
      <>
        {children}
        {checking ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 text-slate-100 px-6"
            dir={isArabic ? 'rtl' : 'ltr'}
          >
            <div className="flex max-w-sm flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-lg font-black tracking-tight text-cyan-300 shadow-2xl">
                MR
              </div>
              <div className="mt-4 text-xl font-black tracking-tight">MR SCRAP</div>
              <div className="mt-5 flex items-center gap-3 text-sm font-semibold text-slate-300">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-r-transparent" />
                {isArabic ? 'جاري تجهيز التطبيق والتحقق من التحديث...' : 'Preparing the app and checking for updates...'}
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5" dir={isArabic ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-7 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-5 text-cyan-300 text-2xl font-black">↑</div>
        <h1 className="text-2xl font-black tracking-tight">{isArabic ? 'تحديث إلزامي متوفر' : 'Required update available'}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {isArabic
            ? 'لا يمكن متابعة استخدام MR SCRAP قبل تثبيت آخر إصدار. سيتم تنزيل ملف التحديث من خادم MR SCRAP والتحقق من بصمته وهوية الحزمة وتوقيعها قبل فتح مثبت Android.'
            : 'MR SCRAP cannot continue until the latest version is installed. The APK is downloaded from the MR SCRAP backend and its hash, package identity, version, and signing certificate are verified before Android opens the installer.'}
        </p>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400 space-y-2">
          <div className="flex justify-between gap-4"><span>{isArabic ? 'الإصدار الجديد' : 'New version'}</span><strong className="text-slate-200">{requiredUpdate.versionName || requiredUpdate.versionCode}</strong></div>
          {requiredUpdate.sizeBytes ? (
            <div className="flex justify-between gap-4"><span>{isArabic ? 'حجم التنزيل' : 'Download size'}</span><strong className="text-slate-200">{(requiredUpdate.sizeBytes / 1024 / 1024).toFixed(1)} MB</strong></div>
          ) : null}
        </div>

        {message ? <p className="mt-4 text-xs leading-5 text-cyan-300">{message}</p> : null}
        {lastError ? <p className="mt-4 text-xs leading-5 text-rose-300">{lastError}</p> : null}

        <button type="button" onClick={startUpdate} disabled={installing} className="mt-6 w-full rounded-2xl bg-cyan-400 px-5 py-3.5 font-black text-slate-950 disabled:opacity-60">
          {installing ? (isArabic ? 'جاري تنزيل التحديث...' : 'Downloading update...') : (isArabic ? 'تحديث الآن' : 'Update now')}
        </button>
        <button type="button" onClick={() => void refresh()} disabled={installing || checking} className="mt-3 w-full rounded-2xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-300 disabled:opacity-60">
          {checking ? (isArabic ? 'جاري الفحص...' : 'Checking...') : (isArabic ? 'إعادة فحص التحديث' : 'Check again')}
        </button>

        <p className="mt-5 text-[11px] leading-5 text-slate-500">
          {isArabic
            ? 'Android لا يسمح لأي تطبيق بتثبيت APK بصمت. في أول تحديث فقط قد يطلب منك السماح بالتثبيت من MR SCRAP، وبعدها يبقى التطبيق محجوبًا حتى تكمل التحديث.'
            : 'Android does not allow silent APK installation. On the first update it may ask you to allow installs from MR SCRAP; the app stays blocked until the update is completed.'}
        </p>
      </div>
    </div>
  );
};
