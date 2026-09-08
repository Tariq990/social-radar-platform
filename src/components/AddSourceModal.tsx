import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Link as LinkIcon,
  Check,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Bell,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Radar
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { ResolvedSource } from '../connectors/types';
import { translations } from '../lib/i18n';
import { apiGetRuleSuggestions, apiPreviewMatch, apiResolveSource } from '../services/api';

interface AddSourceModalProps {
  initialUrl?: string | null;
  onClose: () => void;
}

function extractUrl(value: string): string {
  const match = value.match(/https?:\/\/[^\s]+/i);
  return (match?.[0] || value).replace(/[),.;]+$/, '').trim();
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({ initialUrl, onClose }) => {
  const {
    addSourceWithRule,
    locale,
    isDemoMode,
    deviceSessionAvailable,
    refreshDeviceSession,
    connectFacebookSession
  } = useRadar();
  const t = translations[locale];
  const deviceConnector = useRef(new DeviceSessionConnector()).current;

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [url, setUrl] = useState(initialUrl || '');
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [requiresDeviceLogin, setRequiresDeviceLogin] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [magicPreview, setMagicPreview] = useState<{ headline: string; excerpt: string; whyMatched: string; category: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (initialUrl && initialUrl.trim()) {
      const clean = extractUrl(initialUrl);
      setUrl(clean);
      void handleResolve(clean);
    }
  }, [initialUrl]);

  const prepareResolvedSource = async (resolved: ResolvedSource) => {
    setResolvedSource(resolved);
    setRuleName(`${resolved.displayName} Watch`);
    setRequiresDeviceLogin(resolved.connectorType === 'device_session' && resolved.connectorStatus !== 'authenticated_monitoring');

    try {
      const nextSuggestions = await apiGetRuleSuggestions(resolved.displayName, resolved.platform, resolved.bio);
      setSuggestions(nextSuggestions);
      if (nextSuggestions[0]) {
        setRuleText(nextSuggestions[0]);
        void generatePreview(nextSuggestions[0], resolved.displayName);
      }
    } catch {
      if (isDemoMode) {
        const demoSuggestions = [
          'Notify me when they announce discounts over 25%',
          'Alert me when a major new product launches',
          'Tell me when they post an important price change'
        ];
        setSuggestions(demoSuggestions);
        setRuleText(demoSuggestions[0]);
      } else {
        setSuggestions([]);
      }
    }
    setStep(3);
  };

  const handleResolve = async (targetUrl: string) => {
    const clean = extractUrl(targetUrl);
    if (!clean) return;
    setUrl(clean);
    setStep(2);
    setResolveError(null);
    setRequiresDeviceLogin(false);

    try {
      // Authenticated Android resolution is the primary production path. It resolves the
      // real source using the user's local WebView session without exposing cookies to JS.
      if (!isDemoMode && DeviceSessionConnector.isNativeAvailable()) {
        const connected = await refreshDeviceSession();
        if (connected) {
          try {
            const nativeResolved = await deviceConnector.resolveSource({ url: clean });
            await prepareResolvedSource(nativeResolved);
            return;
          } catch (nativeError) {
            console.warn('[AddSource] Native resolution did not complete; checking server metadata', nativeError);
          }
        }
      }

      const serverResolved = await apiResolveSource(clean, isDemoMode);
      if (serverResolved.valid) {
        const resolved: ResolvedSource = {
          platform: serverResolved.platform === 'instagram' ? 'instagram' : 'facebook',
          externalId: serverResolved.externalId,
          url: serverResolved.url || clean,
          displayName: serverResolved.name,
          handle: serverResolved.handle || '',
          avatarUrl: serverResolved.avatarUrl || '',
          bio: '',
          visibilityType: serverResolved.visibilityType,
          connectorType: serverResolved.connectorType,
          connectorStatus: serverResolved.requiresAuthentication ? 'needs_relogin' : 'connected',
          samplePosts: []
        };
        setRequiresDeviceLogin(Boolean(serverResolved.requiresAuthentication));
        await prepareResolvedSource(resolved);
        return;
      }

      if (serverResolved.requiresAuthentication && deviceSessionAvailable) {
        setRequiresDeviceLogin(true);
        setResolveError(serverResolved.error || 'Connect Facebook on this Android device to resolve this source.');
      } else {
        setResolveError(serverResolved.error || 'Could not resolve this source.');
      }
      setStep(1);
    } catch (error: any) {
      setResolveError(error?.message || 'Could not resolve this source.');
      setStep(1);
    }
  };

  const handleConnectAndRetry = async () => {
    setConnecting(true);
    setResolveError(null);
    try {
      await connectFacebookSession();
      if (await refreshDeviceSession()) {
        await handleResolve(url);
      } else {
        setResolveError('Facebook login is not complete yet.');
      }
    } catch (error: any) {
      setResolveError(error?.message || 'Could not connect Facebook on this device.');
    } finally {
      setConnecting(false);
    }
  };

  const generatePreview = async (rule: string, sourceName: string) => {
    if (!rule.trim()) return;
    setLoadingPreview(true);
    try {
      setMagicPreview(await apiPreviewMatch(rule, sourceName));
    } catch {
      setMagicPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleFinish = async () => {
    if (!resolvedSource || !ruleText.trim()) return;
    setIsSubmitting(true);
    setResolveError(null);
    try {
      if (resolvedSource.connectorType === 'device_session' && !isDemoMode) {
        const connected = await refreshDeviceSession();
        if (!connected) {
          setResolveError('Connect Facebook on this Android device before activating authenticated monitoring.');
          return;
        }
      }
      await addSourceWithRule({
        platform: resolvedSource.platform,
        externalId: resolvedSource.externalId,
        url: resolvedSource.url,
        displayName: resolvedSource.displayName,
        handle: resolvedSource.handle,
        avatarUrl: resolvedSource.avatarUrl,
        bio: resolvedSource.bio,
        visibilityType: resolvedSource.visibilityType,
        connectorType: resolvedSource.connectorType,
        connectorStatus: resolvedSource.connectorStatus
      }, ruleText, ruleName);
      setStep(4);
      window.setTimeout(onClose, 1400);
    } catch (error: any) {
      setResolveError(error?.message || 'Could not save this watch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      const clean = extractUrl(clip);
      if (clean) {
        setUrl(clean);
        await handleResolve(clean);
      }
    } catch {
      setResolveError('Clipboard access was not available. Paste the link manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm">
      <div id="modal-add-source" className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <h2 className="text-base font-bold text-slate-100">
              {step === 1 && t.addSourceTitle}
              {step === 2 && (locale === 'ar' ? 'جاري التحقق من المصدر...' : 'Resolving source...')}
              {step === 3 && t.ruleComposerTitle}
              {step === 4 && (locale === 'ar' ? 'تم تفعيل الرادار' : 'Radar Active')}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {resolveError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{resolveError}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">{t.addSourceSub}</p>
              <div className="relative">
                <LinkIcon className="absolute start-3 top-3.5 w-4 h-4 text-slate-500" />
                <input id="input-source-url" type="url" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => event.key === 'Enter' && void handleResolve(url)} placeholder={t.urlInputPlaceholder} className="w-full ps-10 pe-20 py-3 text-sm bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500" autoFocus />
                <button onClick={handlePaste} className="absolute end-2 top-2.5 px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-300">{t.pasteFromClipboard}</button>
              </div>

              {requiresDeviceLogin && deviceSessionAvailable && (
                <button onClick={handleConnectAndRetry} disabled={connecting} className="w-full p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Lock className="w-4 h-4" /> {connecting ? t.loading : (locale === 'ar' ? 'ربط Facebook على هذا الجهاز' : 'Connect Facebook on this device')}
                </button>
              )}

              <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-[11px] text-cyan-300/80 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{deviceSessionAvailable ? (locale === 'ar' ? 'المحتوى الموثق يتم فتحه باستخدام جلسة WebView المحلية على جهازك، ولا تُرسل ملفات تعريف الارتباط الخام إلى الخادم.' : 'Authenticated content is opened using the local WebView session on this device; raw cookies are not sent to the backend.') : t.supportedLinksNote}</span>
              </div>

              <button id="btn-confirm-resolve" onClick={() => void handleResolve(url)} disabled={!url.trim()} className="w-full px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center justify-center gap-2">
                <span>{locale === 'ar' ? 'فحص المصدر' : 'Resolve Source'}</span>{locale === 'ar' ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="py-10 text-center space-y-5">
              <div className="w-16 h-16 mx-auto rounded-full border-2 border-t-cyan-400 border-r-transparent border-b-cyan-500 border-l-transparent animate-spin flex items-center justify-center"><Radar className="w-6 h-6 text-cyan-400" /></div>
              <div>
                <p className="text-sm font-semibold text-slate-200">{locale === 'ar' ? 'نتحقق من الرابط والمصدر الحقيقي' : 'Checking the real source'}</p>
                <p className="text-xs text-slate-500 mt-1">{deviceSessionAvailable ? (locale === 'ar' ? 'سيتم استخدام جلسة الجهاز عند الحاجة.' : 'The local device session is used when authentication is required.') : (locale === 'ar' ? 'فحص بيانات المصدر المتاحة.' : 'Checking available source metadata.')}</p>
              </div>
            </div>
          )}

          {step === 3 && resolvedSource && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3">
                {resolvedSource.avatarUrl ? <img src={resolvedSource.avatarUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-slate-700" /> : <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center"><Radar className="w-5 h-5 text-slate-500" /></div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><h3 className="font-bold text-sm text-slate-100 truncate">{resolvedSource.displayName}</h3><span className="text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">{resolvedSource.platform}</span></div>
                  <p className="text-xs text-slate-400 truncate">{resolvedSource.handle || resolvedSource.url}</p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full ${resolvedSource.connectorType === 'device_session' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{resolvedSource.connectorType === 'device_session' ? 'Device Session' : 'Public'}</span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">{t.ruleComposerTitle}</label>
                <textarea id="textarea-rule-nl" value={ruleText} onChange={event => setRuleText(event.target.value)} onBlur={() => ruleText.trim() && void generatePreview(ruleText, resolvedSource.displayName)} rows={3} placeholder={t.rulePlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none" />
              </div>

              {suggestions.length > 0 && (
                <div className="space-y-2"><span className="text-[11px] text-slate-400 flex items-center gap-1"><Sparkles className="w-3 h-3 text-cyan-400" />{t.suggestionsLabel}</span><div className="flex flex-wrap gap-1.5">{suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => { setRuleText(suggestion); void generatePreview(suggestion, resolvedSource.displayName); }} className={`text-start px-2.5 py-1 text-xs rounded-lg border ${ruleText === suggestion ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-950 text-slate-300 border-slate-800'}`}>{suggestion}</button>)}</div></div>
              )}

              <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 space-y-2">
                <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400"><Bell className="w-3.5 h-3.5" />{t.magicPreviewTitle}</div><span className="text-[10px] text-slate-500">{loadingPreview ? t.loading : (locale === 'ar' ? 'مثال توضيحي' : 'Hypothetical preview')}</span></div>
                {magicPreview ? <div className="space-y-1.5 text-xs"><div className="font-semibold text-slate-100">{magicPreview.headline}</div><p className="text-slate-300 text-[11px] bg-slate-950/70 p-2 rounded-lg">{magicPreview.excerpt}</p><div className="text-[11px] text-cyan-300"><strong>{t.whyMatchedTitle}</strong> {magicPreview.whyMatched}</div></div> : <p className="text-[11px] text-slate-500">{locale === 'ar' ? 'اكتب قاعدة وسيظهر مثال عند توفر محرك AI.' : 'Write a rule to preview an example when the AI engine is available.'}</p>}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs">{t.back}</button>
                <button id="btn-start-watching-submit" onClick={handleFinish} disabled={isSubmitting || !ruleText.trim()} className="flex-1 px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"><Check className="w-4 h-4" />{isSubmitting ? t.saving : t.applyRuleBtn}</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="py-10 text-center space-y-4"><div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center"><CheckCircle2 className="w-10 h-10" /></div><div><h3 className="text-base font-bold text-slate-100">{t.radarActiveNotice}</h3><p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'تم حفظ المصدر والقاعدة.' : 'Source and rule saved.'}</p></div></div>
          )}
        </div>
      </div>
    </div>
  );
};
