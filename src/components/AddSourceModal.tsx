import React, { useState, useEffect } from 'react';
import { 
  X, 
  Search, 
  Link as LinkIcon, 
  Check, 
  Sparkles, 
  Sliders, 
  ShieldCheck, 
  ChevronRight, 
  AlertCircle,
  Bell,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Share2
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { defaultConnectorManager } from '../connectors/connectorManager';
import { ResolvedSource } from '../connectors/types';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';
import { apiResolveSource } from '../services/api';

interface AddSourceModalProps {
  initialUrl?: string | null;
  onClose: () => void;
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({ initialUrl, onClose }) => {
  const { addSourceWithRule, locale, user, isDemoMode } = useRadar();
  const t = translations[locale];

  // Flow steps: 1 = Enter URL / Paste, 2 = Resolving, 3 = Source Card & Rule Composer, 4 = Success
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [url, setUrl] = useState(initialUrl || '');
  const [resolvingStep, setResolvingStep] = useState(1);
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Rule composer states
  const [ruleText, setRuleText] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showFineTune, setShowFineTune] = useState(false);
  const [includeTerms, setIncludeTerms] = useState('');
  const [excludeTerms, setExcludeTerms] = useState('');
  const [alertMode, setAlertMode] = useState<'instant' | 'digest'>('instant');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Magic moment preview
  const [magicPreview, setMagicPreview] = useState<{
    headline: string;
    excerpt: string;
    whyMatched: string;
    category: string;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Auto-resolve if initialUrl provided
  useEffect(() => {
    if (initialUrl && initialUrl.trim().length > 3) {
      setUrl(initialUrl);
      handleResolve(initialUrl);
    }
  }, [initialUrl]);

  const handleResolve = async (targetUrl: string) => {
    const clean = targetUrl.trim();
    if (!clean) return;

    setStep(2);
    setResolveError(null);
    setResolvingStep(1);

    // Simulated progress steps for fast perceived performance
    const timer1 = setTimeout(() => setResolvingStep(2), 500);
    const timer2 = setTimeout(() => setResolvingStep(3), 1000);

    try {
      const res = await apiResolveSource(clean, isDemoMode);
      clearTimeout(timer1);
      clearTimeout(timer2);

      if (!res.valid) {
        setResolveError(res.error || 'Could not resolve public page details. Please verify the URL.');
        setStep(1);
        return;
      }

      const resolved: ResolvedSource = {
        platform: res.platform === 'instagram' ? 'instagram' : 'facebook',
        externalId: res.externalId || clean.split('/').filter(Boolean).pop() || 'source',
        url: res.url || clean,
        displayName: res.name || 'Monitored Account',
        handle: res.handle || `@${clean.split('/').filter(Boolean).pop() || 'page'}`,
        avatarUrl: res.avatarUrl || '',
        bio: '',
        visibilityType: res.visibilityType || 'public',
        connectorType: (res.connectorType as any) || 'public_cloud',
        connectorStatus: (res.connectorStatus === 'connected' ? 'connected' : 'public_monitoring') as any,
        samplePosts: []
      };

      setResolvedSource(resolved);
      setRuleName(`${resolved.displayName} Watch`);

      // Fetch AI rule suggestions
      fetch('/api/ai/rule-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceName: resolved.displayName,
          platform: resolved.platform,
          bio: resolved.bio
        })
      })
        .then(r => r.json())
        .then(data => {
          if (data.suggestions && data.suggestions.length > 0) {
            setSuggestions(data.suggestions);
            setRuleText(data.suggestions[0]);
            generatePreview(data.suggestions[0], resolved.displayName);
          }
        })
        .catch(() => {
          setSuggestions([
            'Notify me when they announce discounts over 25%',
            'Alert me about new products or services',
            'Tell me when important pricing changes happen'
          ]);
          setRuleText('Notify me when they announce discounts over 25%');
        });

      setStep(3);
    } catch (err: any) {
      setResolveError(err.message || 'Could not resolve source. Please check the URL.');
      setStep(1);
    }
  };

  const generatePreview = async (ruleNL: string, sourceName: string) => {
    if (!ruleNL.trim()) return;
    setLoadingPreview(true);
    try {
      const res = await fetch('/api/ai/preview-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleNaturalLanguage: ruleNL,
          sourceName: sourceName || 'Monitored Source'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setMagicPreview(data);
      }
    } catch {
      // Ignore preview failure
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setRuleText(suggestion);
    if (resolvedSource) {
      generatePreview(suggestion, resolvedSource.displayName);
    }
  };

  const handleFinish = async () => {
    if (!resolvedSource || !ruleText.trim()) return;

    setIsSubmitting(true);
    try {
      await addSourceWithRule(
        {
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
        },
        ruleText,
        ruleName
      );
      setStep(4);
      setTimeout(() => {
        onClose();
      }, 1600);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) {
        setUrl(clip);
        handleResolve(clip);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="modal-add-source"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <h2 className="text-base font-bold text-slate-100">
              {step === 1 && t.addSourceTitle}
              {step === 2 && (locale === 'ar' ? 'جاري قراءة الرابط...' : 'Finding Source...')}
              {step === 3 && t.ruleComposerTitle}
              {step === 4 && (locale === 'ar' ? 'تم تفعيل الرادار' : 'Radar Active')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* STEP 1: Enter URL */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                {t.addSourceSub}
              </p>

              {resolveError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{resolveError}</span>
                </div>
              )}

              <div className="space-y-2">
                <div className="relative">
                  <input
                    id="input-source-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t.urlInputPlaceholder}
                    className="w-full px-4 py-3 text-sm bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && handleResolve(url)}
                    autoFocus
                  />
                  <button
                    onClick={handlePaste}
                    className="absolute end-2 top-2.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    {t.pasteFromClipboard}
                  </button>
                </div>
              </div>

              {/* Sample test suggestions for immediate trial */}
              <div className="pt-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  {locale === 'ar' ? 'أو جرب أحد هذه الروابط:' : 'Or test with a sample page:'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setUrl('https://facebook.com/bmw.jordan.official');
                      handleResolve('https://facebook.com/bmw.jordan.official');
                    }}
                    className="text-start p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 text-xs text-slate-300 transition-all flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="font-medium truncate">BMW Motors (Cars)</span>
                  </button>
                  <button
                    onClick={() => {
                      setUrl('https://instagram.com/fireflyburger');
                      handleResolve('https://instagram.com/fireflyburger');
                    }}
                    className="text-start p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 text-xs text-slate-300 transition-all flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-pink-500" />
                    <span className="font-medium truncate">Firefly (Burgers & Deals)</span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-[11px] text-cyan-300/80 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 flex-shrink-0 text-cyan-400 mt-0.5" />
                <span>{t.supportedLinksNote}</span>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  id="btn-confirm-resolve"
                  onClick={() => handleResolve(url)}
                  disabled={!url.trim()}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/20"
                >
                  <span>{locale === 'ar' ? 'فحص المصدر' : 'Resolve Source'}</span>
                  {locale === 'ar' ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Resolving Progress Indicator */}
          {step === 2 && (
            <div className="py-8 text-center space-y-6">
              <div className="relative w-16 h-16 mx-auto">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping" />
                <div className="w-16 h-16 rounded-full border-2 border-t-cyan-400 border-r-transparent border-b-cyan-500 border-l-transparent animate-spin flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-cyan-400" />
                </div>
              </div>

              <div className="space-y-3 max-w-xs mx-auto text-start">
                <div className="flex items-center gap-3 text-xs">
                  {resolvingStep >= 1 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-700 flex-shrink-0" />
                  )}
                  <span className={resolvingStep >= 1 ? 'text-slate-200' : 'text-slate-500'}>
                    {t.resolvingProgress1}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  {resolvingStep >= 2 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-700 flex-shrink-0" />
                  )}
                  <span className={resolvingStep >= 2 ? 'text-slate-200' : 'text-slate-500'}>
                    {t.resolvingProgress2}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  {resolvingStep >= 3 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-700 flex-shrink-0" />
                  )}
                  <span className={resolvingStep >= 3 ? 'text-slate-200' : 'text-slate-500'}>
                    {t.resolvingProgress3}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Resolved Source & Rule Composer */}
          {step === 3 && resolvedSource && (
            <div className="space-y-4">
              {/* Resolved Source Header Card */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3">
                <img
                  src={resolvedSource.avatarUrl}
                  alt={resolvedSource.displayName}
                  className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-slate-100 truncate">{resolvedSource.displayName}</h3>
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {resolvedSource.platform}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{resolvedSource.handle}</p>
                </div>
                <div className="text-end">
                  <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {t.statusActive}
                  </span>
                </div>
              </div>

              {/* Natural Language Rule Composer */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  {t.ruleComposerTitle}
                </label>
                <textarea
                  id="textarea-rule-nl"
                  value={ruleText}
                  onChange={(e) => {
                    setRuleText(e.target.value);
                    generatePreview(e.target.value, resolvedSource.displayName);
                  }}
                  rows={2}
                  placeholder={t.rulePlaceholder}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors resize-none"
                />
              </div>

              {/* AI Rule Suggestions */}
              {suggestions.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    {t.suggestionsLabel}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelectSuggestion(sug)}
                        className={`text-start px-2.5 py-1 text-xs rounded-lg border transition-all ${
                          ruleText === sug
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 49: "PREVIEW YOUR RADAR" MAGIC MOMENT */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-cyan-950/40 to-slate-950 border border-cyan-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400">
                    <Bell className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t.magicPreviewTitle}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {loadingPreview ? t.loading : (locale === 'ar' ? 'محاكاة ذكية' : 'AI Simulation')}
                  </span>
                </div>

                {magicPreview && (
                  <div className="space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-100 flex items-center justify-between">
                      <span>{magicPreview.headline}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                        {magicPreview.category}
                      </span>
                    </div>
                    <p className="text-slate-300 text-[11px] italic bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                      "{magicPreview.excerpt}"
                    </p>
                    <div className="text-[11px] text-cyan-300/90 font-medium">
                      <strong>{t.whyMatchedTitle}</strong> {magicPreview.whyMatched}
                    </div>
                  </div>
                )}
              </div>

              {/* Fine-tune Accordion */}
              <div className="border-t border-slate-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => setShowFineTune(!showFineTune)}
                  className="flex items-center justify-between w-full text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-slate-400" />
                    {t.fineTuneToggle}
                  </span>
                  <span className="text-xs">{showFineTune ? '▲' : '▼'}</span>
                </button>

                {showFineTune && (
                  <div className="pt-3 space-y-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">{t.includeKeywordsLabel}</label>
                      <input
                        type="text"
                        value={includeTerms}
                        onChange={(e) => setIncludeTerms(e.target.value)}
                        placeholder="e.g. discount, offer, certified"
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">{t.excludeKeywordsLabel}</label>
                      <input
                        type="text"
                        value={excludeTerms}
                        onChange={(e) => setExcludeTerms(e.target.value)}
                        placeholder="e.g. out of stock, rental, expired"
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">{t.alertModeLabel}</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setAlertMode('instant')}
                          className={`py-1.5 px-2 text-xs rounded-lg border text-center font-medium ${
                            alertMode === 'instant'
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-slate-950 text-slate-400 border-slate-800'
                          }`}
                        >
                          {t.alertModeInstant}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAlertMode('digest')}
                          className={`py-1.5 px-2 text-xs rounded-lg border text-center font-medium ${
                            alertMode === 'digest'
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-slate-950 text-slate-400 border-slate-800'
                          }`}
                        >
                          {t.alertModeDigest}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  {t.back}
                </button>
                <button
                  id="btn-start-watching-submit"
                  type="button"
                  onClick={handleFinish}
                  disabled={isSubmitting || !ruleText.trim()}
                  className="flex-1 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>{isSubmitting ? t.saving : t.applyRuleBtn}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Success confirmation */}
          {step === 4 && (
            <div className="py-10 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">{t.radarActiveNotice}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  {locale === 'ar' ? 'تمت إضافة المصدر والقاعدة بنجاح.' : 'Source and AI rule active in your radar.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
