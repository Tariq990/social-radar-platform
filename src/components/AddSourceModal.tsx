import React, { useEffect, useRef, useState } from 'react';
import { X, Link as LinkIcon, Check, Sparkles, AlertCircle, ArrowRight, ArrowLeft, CheckCircle2, LogIn } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { DeviceSessionConnector, NativeSessionStatus } from '../connectors/deviceSessionConnector';
import { ResolvedSource } from '../connectors/types';
import { Source, SourcePlatform } from '../types';
import { Locale, translations } from '../lib/i18n';
import { apiResolveSource } from '../services/api';
import { SourceAvatar } from './SourceAvatar';

interface AddSourceModalProps {
  initialUrl?: string | null;
  onClose: () => void;
}

const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const SOCIAL_HOST_FRAGMENT = /(?:(?:www|m|mobile|web)\.)?(?:facebook\.com|fb\.com|fb\.watch|instagram\.com|instagr\.am)(?:\/[^\s<>"']*)?/i;
const GENERIC_PATHS = new Set(['profile.php', 'groups', 'posts', 'permalink', 'permalink.php', 'reel', 'reels', 'p', 'watch', 'share', 'photo', 'photo.php', 'photos', 'story.php', 'videos']);

function trimUrlPunctuation(value: string): string {
  return value.replace(/^[([{<]+/, '').replace(/[)\]}>.,;،؛]+$/, '').trim();
}

function isSupportedSocialUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch' ||
      host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
  } catch { return false; }
}

function normalizeSocialInput(value: string): string {
  const text = value.replace(BIDI_MARKS, ' ').trim();
  if (!text) return '';
  const httpMatches = text.match(/https?:\/\/[^\s<>"']+/ig) || [];
  for (const raw of httpMatches) {
    const candidate = trimUrlPunctuation(raw);
    if (isSupportedSocialUrl(candidate)) return candidate;
  }
  const socialMatch = text.match(SOCIAL_HOST_FRAGMENT)?.[0];
  if (socialMatch) {
    const candidate = trimUrlPunctuation(socialMatch);
    return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  }
  return trimUrlPunctuation(httpMatches[0] || text);
}

function platformFromUrl(value: string): 'facebook' | 'instagram' | null {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am')) return 'instagram';
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch') return 'facebook';
  } catch { }
  return null;
}

function deriveHandle(value: string): string {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
    const first = (parts[0] || '').trim();
    const lower = first.toLowerCase();
    if (lower === 'profile.php') return (parsed.searchParams.get('id') || '').trim();
    if (lower === 'groups' && parts[1]) return parts[1].replace(/^@/, '').trim();
    if (first && !GENERIC_PATHS.has(lower)) return first.replace(/^@/, '').trim();
    return (parsed.searchParams.get('id') || '').trim();
  } catch { return ''; }
}

function normalizeIdentity(value?: string): string {
  return (value || '').trim().replace(/^@/, '').toLowerCase();
}

function identityTokens(source: Pick<Source, 'externalId' | 'handle' | 'url'> | ResolvedSource): Set<string> {
  return new Set([normalizeIdentity(source.externalId), normalizeIdentity(source.handle), normalizeIdentity(deriveHandle(source.url || ''))].filter(Boolean));
}

function normalizedComparableUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.|web\.)/, '');
    return `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase();
  } catch { return ''; }
}

function findExistingSource(sources: Source[], requestedUrl: string, resolved?: ResolvedSource): Source | null {
  const platform = resolved?.platform === 'facebook' || resolved?.platform === 'instagram' ? resolved.platform : platformFromUrl(requestedUrl);
  if (!platform) return null;
  const candidateTokens = resolved ? identityTokens(resolved) : new Set([normalizeIdentity(deriveHandle(requestedUrl))].filter(Boolean));
  const comparable = normalizedComparableUrl(requestedUrl);
  return sources.find(source => {
    if (source.platform !== platform) return false;
    const existing = identityTokens(source);
    return [...candidateTokens].some(token => existing.has(token)) || Boolean(comparable && normalizedComparableUrl(source.url) === comparable);
  }) || null;
}

function isBlank(value?: string): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return !normalized || ['blank', 'about:blank', 'null', 'undefined'].includes(normalized);
}

function normalizeResolvedSource(resolved: ResolvedSource, requestedUrl: string): ResolvedSource {
  const requested = normalizeSocialInput(requestedUrl);
  const returned = normalizeSocialInput(resolved.url || '');
  const finalUrl = isSupportedSocialUrl(returned) ? returned : requested;
  if (!isSupportedSocialUrl(finalUrl)) throw new Error('INVALID_SOCIAL_URL');
  const handle = !isBlank(resolved.handle) ? resolved.handle.trim().replace(/^@/, '') : deriveHandle(finalUrl);
  const externalId = !isBlank(resolved.externalId) ? resolved.externalId.trim() : handle;
  const displayName = !isBlank(resolved.displayName) ? resolved.displayName.trim() : handle ? `@${handle}` : '';
  if (!externalId || !displayName) throw new Error('UNRESOLVED_SOURCE_METADATA');
  return { ...resolved, url: finalUrl, handle, externalId, displayName };
}

function isGenericName(value: string, handle?: string): boolean {
  const n = value.trim().toLowerCase();
  const h = normalizeIdentity(handle);
  return !n || ['facebook', 'instagram', 'page'].includes(n) || n === h || n === `@${h}`;
}

function sameIdentity(a: ResolvedSource, b: ResolvedSource): boolean {
  if (a.platform !== b.platform) return false;
  const left = identityTokens(a), right = identityTokens(b);
  return [...left].some(token => right.has(token));
}

function firstSuccessful<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!promises.length) return reject(new Error('NO_RESOLVER'));
    let pending = promises.length;
    let lastError: unknown = new Error('RESOLVE_FAILED');
    promises.forEach(promise => promise.then(resolve).catch(error => {
      lastError = error;
      pending -= 1;
      if (!pending) reject(lastError);
    }));
  });
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => window.setTimeout(() => reject(new Error('RESOLVE_TIMEOUT')), ms));
}

function localizedSuggestions(locale: Locale): string[] {
  return locale === 'ar'
    ? ['نبهني عند نزول آخر بوست جديد', 'نبهني عند الإعلان عن خصم أو عرض محدود', 'نبهني عند إطلاق منتج أو خدمة جديدة', 'نبهني عند تغيير الأسعار أو الباقات']
    : ['Notify me about the latest new post', 'Notify me when they announce a discount or limited offer', 'Alert me when a new product or service launches', 'Tell me when they publish an important price change'];
}

function friendlyError(error: unknown, locale: Locale): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = message.toLowerCase();
  if (locale === 'en') {
    if (message === 'INVALID_SOCIAL_URL' || lower.includes('invalid url')) return 'Paste a valid Facebook or Instagram URL.';
    if (lower.includes('instagram') && (lower.includes('session') || lower.includes('login'))) return 'Connect Instagram first.';
    if (lower.includes('facebook') && (lower.includes('session') || lower.includes('login'))) return 'Connect Facebook first.';
    if (message === 'INCOMPLETE_SOURCE_METADATA') return 'Could not read the real source name and profile image. Please retry.';
    return 'Could not verify this source. Please try again.';
  }
  if (message === 'INVALID_SOCIAL_URL' || lower.includes('invalid url') || lower.includes('only http') || lower.includes('unsupported')) {
    return 'الرابط غير صالح. الصق رابط Facebook أو Instagram صحيحًا.';
  }
  if (lower.includes('instagram') && (lower.includes('session') || lower.includes('login'))) return 'اربط Instagram أولًا.';
  if (lower.includes('facebook') && (lower.includes('session') || lower.includes('login'))) return 'اربط Facebook أولًا.';
  if (message === 'INCOMPLETE_SOURCE_METADATA') return 'تعذر قراءة الاسم والصورة الحقيقيين للمصدر. أعد المحاولة.';
  return 'تعذر التحقق من المصدر الآن. أعد المحاولة.';
}

function provisionalSource(url: string, nativeAvailable: boolean, connected: boolean): ResolvedSource | null {
  if (!nativeAvailable) return null;
  const platform = platformFromUrl(url);
  const handle = deriveHandle(url);
  if (!platform || !handle) return null;
  return {
    platform,
    externalId: handle,
    url,
    displayName: `@${handle}`,
    handle,
    avatarUrl: '',
    bio: '',
    visibilityType: 'authenticated',
    connectorType: 'device_session',
    connectorStatus: connected ? 'authenticated_monitoring' : 'needs_relogin',
    samplePosts: []
  };
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({ initialUrl, onClose }) => {
  const { addSourceWithRule, sources, locale, isDemoMode } = useRadar();
  const t = translations[locale];
  const connector = useRef(new DeviceSessionConnector()).current;
  const inputRef = useRef<HTMLInputElement>(null);
  const resolveGeneration = useRef(0);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [url, setUrl] = useState(initialUrl ? normalizeSocialInput(initialUrl) : '');
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource | null>(null);
  const [existingSource, setExistingSource] = useState<Source | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [platformConnected, setPlatformConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const prepare = (candidate: ResolvedSource, requestedUrl: string, connected: boolean) => {
    const resolved = normalizeResolvedSource(candidate, requestedUrl);
    const duplicate = findExistingSource(sources, requestedUrl, resolved);
    if (duplicate) {
      setExistingSource(duplicate);
      setResolvedSource(null);
      setResolveError(null);
      setStep(1);
      return;
    }
    const nextSuggestions = localizedSuggestions(locale);
    setExistingSource(null);
    setResolvedSource(resolved);
    setPlatformConnected(connected);
    setRuleName(locale === 'ar' ? `${resolved.displayName} — مراقبة` : `${resolved.displayName} Watch`);
    setSuggestions(nextSuggestions);
    if (!ruleText.trim()) setRuleText(nextSuggestions[0] || '');
    setStep(3);
  };

  const enrich = (candidate: ResolvedSource, requestedUrl: string, generation: number) => {
    if (generation !== resolveGeneration.current) return;
    let normalized: ResolvedSource;
    try { normalized = normalizeResolvedSource(candidate, requestedUrl); } catch { return; }
    const duplicate = findExistingSource(sources, requestedUrl, normalized);
    if (duplicate) {
      setExistingSource(duplicate);
      setResolvedSource(null);
      setStep(1);
      return;
    }
    setResolvedSource(current => {
      if (!current || !sameIdentity(current, normalized)) return current;
      const betterName = isGenericName(current.displayName, current.handle) && !isGenericName(normalized.displayName, normalized.handle);
      if (betterName) setRuleName(locale === 'ar' ? `${normalized.displayName} — مراقبة` : `${normalized.displayName} Watch`);
      return {
        ...current,
        displayName: betterName ? normalized.displayName : current.displayName,
        handle: current.handle || normalized.handle,
        externalId: current.externalId || normalized.externalId,
        avatarUrl: normalized.avatarUrl || current.avatarUrl,
        bio: normalized.bio || current.bio,
        connectorStatus: normalized.connectorStatus === 'authenticated_monitoring' ? 'authenticated_monitoring' : current.connectorStatus
      };
    });
  };

  const handleResolve = async (targetUrl: string) => {
    const clean = normalizeSocialInput(targetUrl);
    const generation = ++resolveGeneration.current;
    setPasteHint(null);
    setExistingSource(null);
    setResolveError(null);
    if (!clean || !isSupportedSocialUrl(clean)) {
      setResolveError(friendlyError('INVALID_SOCIAL_URL', locale));
      setStep(1);
      return;
    }
    const duplicate = findExistingSource(sources, clean);
    if (duplicate) {
      setUrl(clean);
      setExistingSource(duplicate);
      setStep(1);
      return;
    }

    setUrl(clean);
    setStep(2);
    const platform = platformFromUrl(clean);
    const nativeAvailable = !isDemoMode && DeviceSessionConnector.isNativeAvailable();
    let status: NativeSessionStatus = { available: nativeAvailable, connected: false, facebookConnected: false, instagramConnected: false };
    if (nativeAvailable) {
      try { status = await DeviceSessionConnector.getLocalSession(); } catch { }
    }
    const connected = DeviceSessionConnector.isPlatformConnected(status, platform);
    setPlatformConnected(connected);

    const serverPromise: Promise<ResolvedSource> = apiResolveSource(clean, isDemoMode).then(result => {
      if (!result.valid) throw new Error(result.error || 'RESOLVE_FAILED');
      return normalizeResolvedSource({
        platform: result.platform === 'instagram' ? 'instagram' : 'facebook',
        externalId: result.externalId,
        url: result.url || clean,
        displayName: result.name,
        handle: result.handle || '',
        avatarUrl: result.avatarUrl || '',
        bio: '',
        visibilityType: nativeAvailable ? 'authenticated' : result.visibilityType,
        connectorType: nativeAvailable ? 'device_session' : result.connectorType,
        connectorStatus: nativeAvailable ? (connected ? 'authenticated_monitoring' : 'needs_relogin') : (result.requiresAuthentication ? 'needs_relogin' : 'connected'),
        samplePosts: []
      }, clean);
    });
    const nativePromise = nativeAvailable && connected
      ? connector.resolveSource({ url: clean }).then(candidate => normalizeResolvedSource(candidate, clean))
      : null;
    serverPromise.then(candidate => enrich(candidate, clean, generation)).catch(() => {});
    nativePromise?.then(candidate => enrich(candidate, clean, generation)).catch(() => {});

    const realResolvers = nativePromise ? [nativePromise, serverPromise] : [serverPromise];
    const provisional = provisionalSource(clean, nativeAvailable, connected);
    try {
      let winner: ResolvedSource;
      if (nativePromise) {
        winner = await Promise.race([nativePromise, timeoutAfter(10_000)]);
        if (isGenericName(winner.displayName, winner.handle) || !winner.avatarUrl?.trim()) {
          throw new Error('INCOMPLETE_SOURCE_METADATA');
        }
      } else {
        try { winner = await Promise.race([firstSuccessful(realResolvers), timeoutAfter(2200)]); }
        catch (error) { if (!provisional) throw error; winner = provisional; }
      }
      if (generation !== resolveGeneration.current) return;
      prepare(winner, clean, connected);
    } catch (error) {
      if (generation !== resolveGeneration.current) return;
      setResolveError(friendlyError(error, locale));
      setStep(1);
    }
  };

  useEffect(() => {
    if (!initialUrl?.trim()) return;
    const clean = normalizeSocialInput(initialUrl);
    setUrl(clean);
    void handleResolve(clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const handleConnectAndRetry = async () => {
    const platform = resolvedSource?.platform === 'instagram' ? 'instagram' : 'facebook';
    setConnecting(true);
    setResolveError(null);
    try {
      const connected = platform === 'instagram'
        ? await DeviceSessionConnector.connectInstagram()
        : await DeviceSessionConnector.connectFacebook();
      setPlatformConnected(connected);
      if (!connected) throw new Error(`${platform} login was not completed`);
      await handleResolve(url);
    } catch (error) {
      setResolveError(friendlyError(error, locale));
    } finally { setConnecting(false); }
  };

  const handleFinish = async () => {
    if (!resolvedSource || !ruleText.trim()) return;
    const duplicate = findExistingSource(sources, resolvedSource.url, resolvedSource);
    if (duplicate) {
      setExistingSource(duplicate);
      setResolvedSource(null);
      setStep(1);
      return;
    }
    if (resolvedSource.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable() && !isDemoMode) {
      const status = await DeviceSessionConnector.getLocalSession().catch(() => null);
      const connected = status ? DeviceSessionConnector.isPlatformConnected(status, resolvedSource.platform) : false;
      setPlatformConnected(connected);
      if (!connected) {
        setResolveError(locale === 'ar'
          ? `اربط ${resolvedSource.platform === 'instagram' ? 'Instagram' : 'Facebook'} قبل بدء المراقبة.`
          : `Connect ${resolvedSource.platform === 'instagram' ? 'Instagram' : 'Facebook'} before monitoring.`);
        return;
      }
    }

    setIsSubmitting(true);
    setResolveError(null);
    try {
      let sourceToPersist = resolvedSource;
      if (resolvedSource.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable() && !isDemoMode &&
          (isGenericName(resolvedSource.displayName, resolvedSource.handle) || !resolvedSource.avatarUrl?.trim())) {
        const refreshed = normalizeResolvedSource(await connector.resolveSource({ url: resolvedSource.url }), resolvedSource.url);
        if (isGenericName(refreshed.displayName, refreshed.handle) || !refreshed.avatarUrl?.trim()) throw new Error('INCOMPLETE_SOURCE_METADATA');
        sourceToPersist = { ...resolvedSource, ...refreshed, connectorType: 'device_session', connectorStatus: 'authenticated_monitoring' };
        setResolvedSource(sourceToPersist);
      }
      await addSourceWithRule({
        platform: sourceToPersist.platform,
        externalId: sourceToPersist.externalId,
        url: sourceToPersist.url,
        displayName: sourceToPersist.displayName,
        handle: sourceToPersist.handle,
        avatarUrl: sourceToPersist.avatarUrl,
        bio: sourceToPersist.bio,
        visibilityType: sourceToPersist.visibilityType,
        connectorType: sourceToPersist.connectorType,
        connectorStatus: sourceToPersist.connectorStatus
      }, ruleText, ruleName);
      setStep(4);
      window.setTimeout(onClose, 850);
    } catch (error) {
      setResolveError(friendlyError(error, locale));
    } finally { setIsSubmitting(false); }
  };

  const handlePaste = async () => {
    setResolveError(null);
    setExistingSource(null);
    setPasteHint(null);
    try {
      let clip = '';
      if (DeviceSessionConnector.isNativeAvailable()) clip = await DeviceSessionConnector.readClipboardText();
      if (!clip && navigator.clipboard?.readText) clip = await navigator.clipboard.readText();
      const clean = normalizeSocialInput(clip);
      if (!clean) {
        setPasteHint(locale === 'ar' ? 'الحافظة لا تحتوي على رابط.' : 'The clipboard does not contain a link.');
        return;
      }
      setUrl(clean);
      if (isSupportedSocialUrl(clean)) await handleResolve(clean);
      else setPasteHint(locale === 'ar' ? 'الصق رابط Facebook أو Instagram صحيحًا.' : 'Paste a valid Facebook or Instagram URL.');
    } catch {
      inputRef.current?.focus();
      setPasteHint(locale === 'ar' ? 'اضغط مطولًا داخل الحقل واختر «لصق».' : 'Long-press the field and choose Paste.');
    }
  };

  const needsConnection = Boolean(resolvedSource && resolvedSource.connectorType === 'device_session' && DeviceSessionConnector.isNativeAvailable() && !isDemoMode && platformConnected === false);
  const platformLabel = resolvedSource?.platform === 'instagram' ? 'Instagram' : 'Facebook';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-md">
      <div id="modal-add-source" className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-4">
          <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate">
            {step === 1 ? t.addSourceTitle : step === 2 ? (locale === 'ar' ? 'جاري التحقق...' : 'Checking source...') : step === 3 ? t.ruleComposerTitle : (locale === 'ar' ? 'تمت الإضافة' : 'Added')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t.close} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-100 rounded-xl hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1 overscroll-contain">
          {existingSource && (
            <div role="status" className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 flex items-center gap-3">
              <SourceAvatar src={existingSource.avatarUrl} name={existingSource.displayName} platform={existingSource.platform} className="w-10 h-10 rounded-xl" />
              <div className="min-w-0"><p className="text-sm font-bold truncate">{existingSource.displayName || existingSource.handle || existingSource.externalId}</p><p className="text-xs text-amber-300/80 mt-0.5">{locale === 'ar' ? 'هذا المصدر موجود أصلًا.' : 'This source is already in your watchlist.'}</p></div>
            </div>
          )}
          {resolveError && <div role="alert" className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-sm text-rose-300 flex items-start gap-2.5"><AlertCircle className="w-4 h-4 mt-0.5 flex-none" /><span>{resolveError}</span></div>}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-slate-400">{t.addSourceSub}</p>
              <div className="space-y-2">
                <div className="flex gap-2" dir="ltr">
                  <div className="relative flex-1 min-w-0">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input ref={inputRef} id="input-source-url" type="url" inputMode="url" dir="ltr" value={url}
                      onChange={event => { resolveGeneration.current += 1; setUrl(event.target.value); setExistingSource(null); setResolveError(null); setPasteHint(null); }}
                      onKeyDown={event => event.key === 'Enter' && void handleResolve(url)} placeholder="facebook.com/page أو instagram.com/account"
                      className="w-full pl-10 pr-3 py-3.5 text-sm text-left bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500" autoFocus />
                  </div>
                  <button type="button" onClick={handlePaste} className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold flex-none">{t.pasteFromClipboard}</button>
                </div>
                {pasteHint && <p className="text-xs leading-5 text-slate-500">{pasteHint}</p>}
              </div>
              <button id="btn-confirm-resolve" type="button" onClick={() => void handleResolve(url)} disabled={!url.trim()} className="w-full px-5 py-3 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-45 text-slate-950 text-sm font-bold flex items-center justify-center gap-2">
                <span>{locale === 'ar' ? 'متابعة' : 'Continue'}</span>{locale === 'ar' ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          )}

          {step === 2 && <div className="py-12 text-center space-y-4"><div className="w-12 h-12 mx-auto rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" /><p className="text-sm font-semibold text-slate-300">{locale === 'ar' ? 'جاري التحقق...' : 'Checking source...'}</p></div>}

          {step === 3 && resolvedSource && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3">
                <SourceAvatar src={resolvedSource.avatarUrl} name={resolvedSource.displayName} platform={resolvedSource.platform} className="w-12 h-12 rounded-xl" iconClassName="w-5 h-5" eager />
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold text-sm text-slate-100 break-words">{resolvedSource.displayName}</h3><span className="text-[10px] uppercase px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">{resolvedSource.platform}</span></div><p dir="ltr" className="mt-1 text-xs text-left text-slate-400 truncate">{resolvedSource.handle ? `@${resolvedSource.handle.replace(/^@/, '')}` : resolvedSource.url}</p></div>
              </div>

              {needsConnection && (
                <button type="button" onClick={handleConnectAndRetry} disabled={connecting} className="w-full p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <LogIn className="w-4 h-4" />{connecting ? (locale === 'ar' ? 'جاري الربط...' : 'Connecting...') : (locale === 'ar' ? `ربط ${platformLabel}` : `Connect ${platformLabel}`)}
                </button>
              )}

              <div className="space-y-2"><label htmlFor="textarea-rule-nl" className="block text-sm font-semibold text-slate-300">{t.ruleComposerTitle}</label><p className="text-xs leading-5 text-slate-500">{t.ruleComposerSub}</p><textarea id="textarea-rule-nl" value={ruleText} onChange={event => setRuleText(event.target.value)} rows={3} placeholder={t.rulePlaceholder} className="w-full px-3.5 py-3 text-sm leading-6 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none" /></div>
              {suggestions.length > 0 && <div className="space-y-2"><span className="text-xs text-slate-400 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-cyan-400" />{t.suggestionsLabel}</span><div className="grid gap-2">{suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => setRuleText(suggestion)} className={`w-full text-start px-3.5 py-2.5 text-sm rounded-xl border ${ruleText === suggestion ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' : 'bg-slate-950 text-slate-300 border-slate-800'}`}>{suggestion}</button>)}</div></div>}
              <div className="flex gap-3"><button type="button" onClick={() => { resolveGeneration.current += 1; setStep(1); setResolveError(null); }} className="px-4 py-3 rounded-2xl bg-slate-800 text-slate-300 text-sm font-semibold">{t.back}</button><button id="btn-start-watching-submit" type="button" onClick={handleFinish} disabled={isSubmitting || !ruleText.trim()} className="flex-1 px-5 py-3 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"><Check className="w-4 h-4" />{isSubmitting ? t.saving : t.applyRuleBtn}</button></div>
            </div>
          )}

          {step === 4 && <div className="py-12 text-center space-y-4"><div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-400 mx-auto flex items-center justify-center"><CheckCircle2 className="w-9 h-9" /></div><div><h3 className="text-base font-bold text-slate-100">{locale === 'ar' ? 'تمت الإضافة' : 'Added successfully'}</h3><p className="text-xs text-slate-400 mt-1">{locale === 'ar' ? 'بدأت المراقبة.' : 'Monitoring has started.'}</p></div></div>}
        </div>
      </div>
    </div>
  );
};
