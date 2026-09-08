import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Link as LinkIcon,
  Check,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Radar
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { DeviceSessionConnector } from '../connectors/deviceSessionConnector';
import { ResolvedSource } from '../connectors/types';
import { Source } from '../types';
import { Locale, translations } from '../lib/i18n';
import { apiResolveSource } from '../services/api';

interface AddSourceModalProps {
  initialUrl?: string | null;
  onClose: () => void;
}

const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const SOCIAL_HOST_FRAGMENT = /(?:(?:www|m|mobile|web)\.)?(?:facebook\.com|fb\.com|fb\.watch|instagram\.com|instagr\.am)(?:\/[^\s<>"']*)?/i;
const GENERIC_PATHS = new Set([
  'profile.php', 'groups', 'posts', 'permalink', 'permalink.php', 'reel', 'reels', 'p',
  'watch', 'share', 'photo', 'photo.php', 'photos', 'story.php', 'videos'
]);

function trimUrlPunctuation(value: string): string {
  return value.replace(/^[([{<]+/, '').replace(/[)\]}>.,;،؛]+$/, '').trim();
}

function isSupportedSocialUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'facebook.com' || host.endsWith('.facebook.com') ||
      host === 'fb.com' || host.endsWith('.fb.com') || host === 'fb.watch' ||
      host === 'instagram.com' || host.endsWith('.instagram.com') ||
      host === 'instagr.am' || host.endsWith('.instagr.am');
  } catch {
    return false;
  }
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
  } catch {
    // Invalid input is handled by isSupportedSocialUrl.
  }
  return null;
}

function deriveHandle(value: string): string {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean).map(part => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    const first = (parts[0] || '').trim();
    const firstLower = first.toLowerCase();

    if (firstLower === 'profile.php') return (parsed.searchParams.get('id') || '').trim();
    if (firstLower === 'groups' && parts[1]) return parts[1].replace(/^@/, '').trim();
    if (first && !GENERIC_PATHS.has(firstLower)) return first.replace(/^@/, '').trim();

    return (parsed.searchParams.get('id') || '').trim();
  } catch {
    return '';
  }
}

function normalizeIdentity(value: string | undefined): string {
  return (value || '').trim().replace(/^@/, '').toLowerCase();
}

function sourceIdentityTokens(source: Pick<Source, 'externalId' | 'handle' | 'url'> | ResolvedSource): Set<string> {
  const tokens = new Set<string>();
  const externalId = normalizeIdentity(source.externalId);
  const handle = normalizeIdentity(source.handle);
  const urlHandle = normalizeIdentity(deriveHandle(source.url || ''));
  if (externalId) tokens.add(externalId);
  if (handle) tokens.add(handle);
  if (urlHandle) tokens.add(urlHandle);
  return tokens;
}

function findExistingSource(sources: Source[], requestedUrl: string, resolved?: ResolvedSource): Source | null {
  const requestedPlatform = resolved?.platform === 'facebook' || resolved?.platform === 'instagram'
    ? resolved.platform
    : platformFromUrl(requestedUrl);
  if (!requestedPlatform) return null;

  const candidateTokens = resolved
    ? sourceIdentityTokens(resolved)
    : new Set([normalizeIdentity(deriveHandle(requestedUrl))].filter(Boolean));

  let exactRequested = '';
  try {
    const parsed = new URL(requestedUrl);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase()
      .replace(/^(?:www\.|m\.|mobile\.|web\.)/, '');
    exactRequested = `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase();
  } catch {
    // Token matching still works for valid supported inputs.
  }

  for (const source of sources) {
    if (source.platform !== requestedPlatform) continue;
    const existingTokens = sourceIdentityTokens(source);
    if ([...candidateTokens].some(token => existingTokens.has(token))) return source;

    if (exactRequested) {
      try {
        const parsed = new URL(source.url);
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase()
          .replace(/^(?:www\.|m\.|mobile\.|web\.)/, '');
        const existingUrl = `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase();
        if (existingUrl === exactRequested) return source;
      } catch {
        // Ignore malformed legacy URLs.
      }
    }
  }

  return null;
}

function isBlankMetadata(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return !normalized || normalized === 'blank' || normalized === 'about:blank' || normalized === 'null' || normalized === 'undefined';
}

function normalizeResolvedSource(resolved: ResolvedSource, requestedUrl: string): ResolvedSource {
  const requested = normalizeSocialInput(requestedUrl);
  const returned = normalizeSocialInput(resolved.url || '');
  const finalUrl = isSupportedSocialUrl(returned) ? returned : requested;
  if (!isSupportedSocialUrl(finalUrl)) throw new Error('INVALID_SOCIAL_URL');

  const handle = !isBlankMetadata(resolved.handle) ? resolved.handle!.trim().replace(/^@/, '') : deriveHandle(finalUrl);
  const displayName = !isBlankMetadata(resolved.displayName)
    ? resolved.displayName.trim()
    : handle
      ? `@${handle}`
      : '';
  const externalId = !isBlankMetadata(resolved.externalId)
    ? resolved.externalId.trim()
    : handle;

  if (!displayName || !externalId) throw new Error('UNRESOLVED_SOURCE_METADATA');

  return {
    ...resolved,
    url: finalUrl,
    displayName,
    externalId,
    handle
  };
}

function makeUrlDerivedSource(url: string, connected: boolean): ResolvedSource | null {
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

function sameResolvedIdentity(a: ResolvedSource, b: ResolvedSource): boolean {
  if (a.platform !== b.platform) return false;
  const left = sourceIdentityTokens(a);
  const right = sourceIdentityTokens(b);
  return [...left].some(token => right.has(token));
}

function isGenericDisplayName(value: string, handle?: string): boolean {
  const normalized = value.trim().toLowerCase();
  const normalizedHandle = normalizeIdentity(handle);
  return !normalized || normalized === 'facebook' || normalized === 'instagram' ||
    normalized === 'page' || normalized === `@${normalizedHandle}` || normalized === normalizedHandle;
}

function firstSuccessful<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (promises.length === 0) {
      reject(new Error('No source resolver is available'));
      return;
    }
    let pending = promises.length;
    let lastError: unknown = new Error('Could not resolve source');
    for (const promise of promises) {
      promise.then(resolve).catch(error => {
        lastError = error;
        pending -= 1;
        if (pending === 0) reject(lastError);
      });
    }
  });
}

function localizedSuggestions(locale: Locale): string[] {
  if (locale === 'ar') {
    return [
      'نبهني عند نزول آخر بوست جديد',
      'نبهني عند الإعلان عن خصم أو عرض محدود',
      'نبهني عند إطلاق منتج أو خدمة جديدة',
      'نبهني عند تغيير الأسعار أو الباقات'
    ];
  }
  return [
    'Notify me about the latest new post',
    'Notify me when they announce a discount or limited offer',
    'Alert me when a major new product or service launches',
    'Tell me when they publish an important price change'
  ];
}

function friendlyError(error: unknown, locale: Locale): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (locale === 'en') {
    if (message === 'UNRESOLVED_SOURCE_METADATA') return 'We could not read a reliable name or account ID for this source. Open the link in Facebook or Instagram, then try again.';
    if (message === 'INVALID_SOCIAL_URL') return 'Paste a valid Facebook or Instagram URL.';
    return message || 'Could not complete this action. Please try again.';
  }

  const lower = message.toLowerCase();
  if (
    message === 'INVALID_SOCIAL_URL' ||
    lower.includes('invalid url') ||
    lower.includes('only http') ||
    lower.includes('only facebook') ||
    lower.includes('unsupported or invalid social url')
  ) {
    return 'الرابط غير صالح. الصق رابطًا من Facebook أو Instagram ثم أعد المحاولة.';
  }
  if (message === 'UNRESOLVED_SOURCE_METADATA' || lower.includes('metadata') || lower.includes('page content')) {
    return 'تعذر قراءة اسم أو معرّف موثوق لهذا المصدر. افتح الرابط في Facebook أو Instagram وتأكد أنه يعمل ثم أعد المحاولة.';
  }
  if (lower.includes('session') || lower.includes('login') || lower.includes('relogin')) {
    return 'جلسة Facebook غير مكتملة. سجّل الدخول على هذا الجهاز ثم أعد المحاولة.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'استغرق فتح المصدر وقتًا أطول من المتوقع. تحقق من الاتصال ثم أعد المحاولة.';
  }
  return 'تعذر إكمال العملية الآن. أعد المحاولة بعد لحظات.';
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({ initialUrl, onClose }) => {
  const {
    addSourceWithRule,
    sources,
    locale,
    isDemoMode,
    refreshDeviceSession,
    connectFacebookSession
  } = useRadar();
  const t = translations[locale];
  const deviceConnector = useRef(new DeviceSessionConnector()).current;
  const inputRef = useRef<HTMLInputElement>(null);
  const resolveGeneration = useRef(0);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [url, setUrl] = useState(initialUrl ? normalizeSocialInput(initialUrl) : '');
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource | null>(null);
  const [existingSource, setExistingSource] = useState<Source | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [requiresDeviceLogin, setRequiresDeviceLogin] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialUrl && initialUrl.trim()) {
      const clean = normalizeSocialInput(initialUrl);
      setUrl(clean);
      void handleResolve(clean);
    }
  }, [initialUrl]);

  const prepareResolvedSource = (candidate: ResolvedSource, requestedUrl: string) => {
    const resolved = normalizeResolvedSource(candidate, requestedUrl);
    const duplicate = findExistingSource(sources, requestedUrl, resolved);
    if (duplicate) {
      setExistingSource(duplicate);
      setResolveError(null);
      setResolvedSource(null);
      setStep(1);
      return false;
    }

    const nextSuggestions = localizedSuggestions(locale);
    setExistingSource(null);
    setResolvedSource(resolved);
    setRuleName(locale === 'ar' ? `${resolved.displayName} — مراقبة` : `${resolved.displayName} Watch`);
    setRequiresDeviceLogin(resolved.connectorType === 'device_session' && resolved.connectorStatus !== 'authenticated_monitoring');
    setSuggestions(nextSuggestions);
    if (!ruleText.trim()) setRuleText(nextSuggestions[0] || '');
    setStep(3);
    return true;
  };

  const enrichResolvedSource = (candidate: ResolvedSource, requestedUrl: string, generation: number) => {
    if (generation !== resolveGeneration.current) return;
    let normalized: ResolvedSource;
    try {
      normalized = normalizeResolvedSource(candidate, requestedUrl);
    } catch {
      return;
    }

    const duplicate = findExistingSource(sources, requestedUrl, normalized);
    if (duplicate) {
      setExistingSource(duplicate);
      setResolvedSource(null);
      setStep(1);
      return;
    }

    setResolvedSource(current => {
      if (!current || !sameResolvedIdentity(current, normalized)) return current;
      const useCandidateName = isGenericDisplayName(current.displayName, current.handle) &&
        !isGenericDisplayName(normalized.displayName, normalized.handle);
      return {
        ...current,
        displayName: useCandidateName ? normalized.displayName : current.displayName,
        handle: current.handle || normalized.handle,
        externalId: current.externalId || normalized.externalId,
        avatarUrl: current.avatarUrl || normalized.avatarUrl,
        bio: current.bio || normalized.bio,
        connectorStatus: normalized.connectorStatus === 'authenticated_monitoring'
          ? 'authenticated_monitoring'
          : current.connectorStatus
      };
    });
    if (normalized.connectorStatus === 'authenticated_monitoring') setRequiresDeviceLogin(false);
  };

  const handleResolve = async (targetUrl: string) => {
    const clean = normalizeSocialInput(targetUrl);
    const generation = ++resolveGeneration.current;
    setPasteHint(null);
    setExistingSource(null);

    if (!clean || !isSupportedSocialUrl(clean)) {
      setResolveError(friendlyError('INVALID_SOCIAL_URL', locale));
      setStep(1);
      return;
    }

    const immediateDuplicate = findExistingSource(sources, clean);
    if (immediateDuplicate) {
      setUrl(clean);
      setExistingSource(immediateDuplicate);
      setResolveError(null);
      setStep(1);
      return;
    }

    setUrl(clean);
    setStep(2);
    setResolveError(null);
    setRequiresDeviceLogin(false);

    const serverPromise: Promise<ResolvedSource> = apiResolveSource(clean, isDemoMode).then(serverResolved => {
      if (serverResolved.requiresAuthentication) setRequiresDeviceLogin(true);
      if (!serverResolved.valid) throw new Error(serverResolved.error || 'Could not resolve this source.');
      return normalizeResolvedSource({
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
      }, clean);
    });

    let connected = false;
    try {
      if (!isDemoMode && DeviceSessionConnector.isNativeAvailable()) {
        connected = await refreshDeviceSession();
      }
    } catch {
      connected = false;
    }

    const nativePromise: Promise<ResolvedSource> | null = connected
      ? deviceConnector.resolveSource({ url: clean }).then(candidate => normalizeResolvedSource(candidate, clean))
      : null;

    const provisional = makeUrlDerivedSource(clean, connected);
    const quickFallback = new Promise<ResolvedSource>((resolve, reject) => {
      window.setTimeout(() => {
        if (provisional) resolve(provisional);
        else reject(new Error('Source metadata is still loading'));
      }, 1200);
    });

    const resolvers = [serverPromise, quickFallback];
    if (nativePromise) resolvers.push(nativePromise);

    // Both real metadata resolvers continue in the background. The 1.2s URL-derived fallback
    // only avoids trapping the user on a spinner; it never fabricates a profile name or image.
    serverPromise.then(candidate => enrichResolvedSource(candidate, clean, generation)).catch(() => {});
    nativePromise?.then(candidate => enrichResolvedSource(candidate, clean, generation)).catch(error => {
      console.warn('[AddSource] Authenticated source enrichment did not complete', error);
    });

    try {
      const winner = await firstSuccessful(resolvers);
      if (generation !== resolveGeneration.current) return;
      prepareResolvedSource(winner, clean);
    } catch (error) {
      if (generation !== resolveGeneration.current) return;
      setResolveError(friendlyError(error, locale));
      setStep(1);
    }
  };

  const handleConnectAndRetry = async () => {
    setConnecting(true);
    setResolveError(null);
    setPasteHint(null);
    try {
      await connectFacebookSession();
      if (await refreshDeviceSession()) {
        await handleResolve(url);
      } else {
        setResolveError(friendlyError('Facebook login is not complete yet.', locale));
      }
    } catch (error) {
      setResolveError(friendlyError(error, locale));
    } finally {
      setConnecting(false);
    }
  };

  const handleFinish = async () => {
    if (!resolvedSource || !ruleText.trim()) return;

    const duplicate = findExistingSource(sources, resolvedSource.url, resolvedSource);
    if (duplicate) {
      setExistingSource(duplicate);
      setResolveError(null);
      setStep(1);
      return;
    }

    setIsSubmitting(true);
    setResolveError(null);
    try {
      if (resolvedSource.connectorType === 'device_session' && !isDemoMode && DeviceSessionConnector.isNativeAvailable()) {
        const connected = await refreshDeviceSession();
        if (!connected) {
          setResolveError(friendlyError('Facebook session is not connected.', locale));
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
      window.setTimeout(onClose, 1200);
    } catch (error) {
      setResolveError(friendlyError(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaste = async () => {
    setResolveError(null);
    setExistingSource(null);
    setPasteHint(null);
    try {
      let clip = '';

      if (DeviceSessionConnector.isNativeAvailable()) {
        clip = await DeviceSessionConnector.readClipboardText();
      }
      if (!clip && navigator.clipboard?.readText) {
        clip = await navigator.clipboard.readText();
      }

      const clean = normalizeSocialInput(clip);
      if (!clean) {
        setPasteHint(locale === 'ar' ? 'الحافظة لا تحتوي على رابط.' : 'The clipboard does not contain a link.');
        return;
      }

      setUrl(clean);
      if (isSupportedSocialUrl(clean)) {
        await handleResolve(clean);
      } else {
        setPasteHint(locale === 'ar' ? 'الحافظة لا تحتوي على رابط Facebook أو Instagram صالح.' : 'The clipboard does not contain a valid Facebook or Instagram URL.');
      }
    } catch {
      inputRef.current?.focus();
      setPasteHint(locale === 'ar'
        ? 'تعذر قراءة الحافظة. اضغط مطولًا داخل الحقل واختر «لصق».'
        : 'Could not read the clipboard. Long-press the field and choose Paste.');
    }
  };

  const sourceBadge = resolvedSource?.connectorType === 'device_session'
    ? (locale === 'ar' ? 'جلسة الجهاز' : 'Device session')
    : (locale === 'ar' ? 'مصدر عام' : 'Public source');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-md">
      <div id="modal-add-source" className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-cyan-400 flex-none" />
            <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate">
              {step === 1 && t.addSourceTitle}
              {step === 2 && (locale === 'ar' ? 'جاري التحقق من المصدر' : 'Resolving source')}
              {step === 3 && t.ruleComposerTitle}
              {step === 4 && (locale === 'ar' ? 'تم تفعيل الرادار' : 'Radar active')}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t.close} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-100 rounded-xl hover:bg-slate-800 transition-colors flex-none">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1 overscroll-contain">
          {existingSource && (
            <div role="status" className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 flex items-center gap-3">
              {existingSource.avatarUrl
                ? <img src={existingSource.avatarUrl} alt="" className="w-10 h-10 rounded-xl object-cover border border-amber-500/20 flex-none" />
                : <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center flex-none"><Radar className="w-4 h-4 text-amber-300" /></div>}
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{existingSource.displayName || existingSource.handle || existingSource.externalId}</p>
                <p className="text-xs text-amber-300/80 mt-0.5">
                  {locale === 'ar' ? 'هذا المصدر موجود أصلًا في قائمة المراقبة، لذلك لن نضيف نسخة ثانية.' : 'This source is already in your watchlist, so MR SCRAP will not add a duplicate.'}
                </p>
              </div>
            </div>
          )}

          {resolveError && (
            <div role="alert" className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-sm text-rose-300 flex items-start gap-2.5 leading-6">
              <AlertCircle className="w-4 h-4 mt-1 flex-shrink-0" />
              <span>{resolveError}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-slate-400">{t.addSourceSub}</p>

              <div className="space-y-2">
                <div className="flex gap-2" dir="ltr">
                  <div className="relative flex-1 min-w-0">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      ref={inputRef}
                      id="input-source-url"
                      type="url"
                      inputMode="url"
                      dir="ltr"
                      value={url}
                      onChange={event => {
                        resolveGeneration.current += 1;
                        setUrl(event.target.value);
                        setExistingSource(null);
                        setResolveError(null);
                        setPasteHint(null);
                      }}
                      onKeyDown={event => event.key === 'Enter' && void handleResolve(url)}
                      placeholder="facebook.com/page"
                      className="w-full pl-10 pr-3 py-3.5 text-sm text-left bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/10"
                      autoFocus
                    />
                  </div>
                  <button type="button" onClick={handlePaste} className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors flex-none">
                    {t.pasteFromClipboard}
                  </button>
                </div>
                {pasteHint && <p className="text-[11px] sm:text-xs leading-5 text-slate-500">{pasteHint}</p>}
              </div>

              {requiresDeviceLogin && DeviceSessionConnector.isNativeAvailable() && (
                <button type="button" onClick={handleConnectAndRetry} disabled={connecting} className="w-full p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Lock className="w-4 h-4" />
                  {connecting ? (locale === 'ar' ? 'بانتظار تسجيل الدخول...' : 'Waiting for Facebook login...') : (locale === 'ar' ? 'تسجيل الدخول إلى Facebook على هذا الجهاز' : 'Sign in to Facebook on this device')}
                </button>
              )}

              <div className="p-3.5 rounded-2xl bg-cyan-500/5 border border-cyan-500/15 text-xs leading-5 text-cyan-300/90 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{DeviceSessionConnector.isNativeAvailable()
                  ? (locale === 'ar'
                    ? 'المحتوى الذي يحتاج تسجيل دخول يُفتح بجلسة Facebook المحلية على جهازك. كلمة المرور وملفات الارتباط لا تُرسل إلى خادم MR SCRAP.'
                    : 'Login-required content uses the local Facebook session on this device. Passwords and raw cookies are not sent to the MR SCRAP backend.')
                  : (locale === 'ar'
                    ? 'يمكنك إدارة المصادر من الويب. المصادر التي تحتاج جلسة Facebook موثقة تتطلب جهاز Android متصلًا.'
                    : 'You can manage sources on the web. Sources requiring an authenticated Facebook session need a connected Android device.')}</span>
              </div>

              <button id="btn-confirm-resolve" type="button" onClick={() => void handleResolve(url)} disabled={!url.trim()} className="w-full px-5 py-3 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-45 text-slate-950 text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                <span>{locale === 'ar' ? 'فحص المصدر' : 'Resolve source'}</span>
                {locale === 'ar' ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="py-10 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-200">{locale === 'ar' ? 'نجلب اسم المصدر وصورته' : 'Reading source name and profile image'}</p>
                <p className="text-xs leading-5 text-slate-500">{locale === 'ar'
                  ? 'إذا تأخرت المنصة، سنفتح الخطوة التالية خلال لحظة ثم نحدّث الاسم والصورة تلقائيًا عند وصولهما.'
                  : 'If the platform is slow, the next step opens quickly and the real name/image are enriched when available.'}</p>
              </div>
            </div>
          )}

          {step === 3 && resolvedSource && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
                <div className="flex items-start gap-3">
                  {resolvedSource.avatarUrl
                    ? <img src={resolvedSource.avatarUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-slate-700 flex-none" />
                    : <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center flex-none"><Radar className="w-5 h-5 text-slate-500" /></div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-slate-100 break-words">{resolvedSource.displayName}</h3>
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">{resolvedSource.platform}</span>
                    </div>
                    <p dir="ltr" className="mt-1 text-xs text-left text-slate-400 truncate">{resolvedSource.handle ? `@${resolvedSource.handle.replace(/^@/, '')}` : resolvedSource.url}</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                  <span className={`text-[11px] px-2.5 py-1 rounded-full ${resolvedSource.connectorType === 'device_session' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{sourceBadge}</span>
                  <span className="text-[11px] text-slate-500">{resolvedSource.avatarUrl || !isGenericDisplayName(resolvedSource.displayName, resolvedSource.handle)
                    ? (locale === 'ar' ? 'تم جلب بيانات المصدر' : 'Source metadata loaded')
                    : (locale === 'ar' ? 'الرابط جاهز — نحدّث بيانات الحساب بالخلفية' : 'Link ready — enriching account metadata')}</span>
                </div>
              </div>

              {requiresDeviceLogin && DeviceSessionConnector.isNativeAvailable() && (
                <button type="button" onClick={handleConnectAndRetry} disabled={connecting} className="w-full p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Lock className="w-4 h-4" />
                  {connecting ? (locale === 'ar' ? 'بانتظار تسجيل الدخول...' : 'Waiting for Facebook login...') : (locale === 'ar' ? 'اتصل بـ Facebook ثم أكمل' : 'Connect Facebook to monitor this source')}
                </button>
              )}

              <div className="space-y-2">
                <label htmlFor="textarea-rule-nl" className="block text-sm font-semibold text-slate-300">{t.ruleComposerTitle}</label>
                <p className="text-xs leading-5 text-slate-500">{t.ruleComposerSub}</p>
                <textarea
                  id="textarea-rule-nl"
                  value={ruleText}
                  onChange={event => setRuleText(event.target.value)}
                  rows={3}
                  placeholder={t.rulePlaceholder}
                  className="w-full px-3.5 py-3 text-sm leading-6 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/10 resize-none"
                />
              </div>

              {suggestions.length > 0 && (
                <div className="space-y-2.5">
                  <span className="text-xs text-slate-400 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-cyan-400" />{t.suggestionsLabel}</span>
                  <div className="grid gap-2">
                    {suggestions.map(suggestion => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setRuleText(suggestion)}
                        className={`w-full text-start px-3.5 py-2.5 text-sm leading-5 rounded-xl border transition-colors ${ruleText === suggestion ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'}`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-cyan-400 mt-0.5 flex-none" />
                <p className="text-xs leading-5 text-slate-500">{locale === 'ar'
                  ? 'لن نعرض بيانات تجريبية على أنها منشور حقيقي. بعد بدء المراقبة، تظهر التنبيهات فقط عند وجود محتوى فعلي يطابق قاعدتك.'
                  : 'Sample data is never presented as a real post. After monitoring starts, alerts appear only for real content that matches your rule.'}</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { resolveGeneration.current += 1; setStep(1); setResolveError(null); }} className="px-4 py-3 rounded-2xl bg-slate-800 text-slate-300 text-sm font-semibold">{t.back}</button>
                <button id="btn-start-watching-submit" type="button" onClick={handleFinish} disabled={isSubmitting || !ruleText.trim()} className="flex-1 px-5 py-3 rounded-2xl bg-cyan-500 text-slate-950 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Check className="w-4 h-4" />{isSubmitting ? t.saving : t.applyRuleBtn}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-400 mx-auto flex items-center justify-center"><CheckCircle2 className="w-9 h-9" /></div>
              <div>
                <h3 className="text-base font-bold text-slate-100">{locale === 'ar' ? 'تم تفعيل المراقبة' : 'Monitoring is active'}</h3>
                <p className="text-xs leading-5 text-slate-400 mt-1">{locale === 'ar' ? 'تم حفظ المصدر والقاعدة بنجاح.' : 'The source and rule were saved successfully.'}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
