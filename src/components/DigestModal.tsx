import React from 'react';
import { X, Sparkles, CheckCircle2, Clock, Share2, Layers } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

export const DigestModal: React.FC = () => {
  const { isDigestOpen, closeDigest, digest, locale } = useRadar();
  const t = translations[locale];

  if (!isDigestOpen) return null;

  const summary = locale === 'ar' && digest.summaryAr ? digest.summaryAr : digest.summary;
  const highlights = locale === 'ar' && digest.highlightsAr ? digest.highlightsAr : digest.highlights;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="modal-digest"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{t.quickDigestTitle}</h3>
              <p className="text-[11px] text-slate-400">{digest.generatedAt}</p>
            </div>
          </div>
          <button
            onClick={closeDigest}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-lg font-bold text-slate-100">{digest.scannedCount}</span>
              <span className="block text-[10px] text-slate-400 uppercase font-medium">{t.scannedLabel}</span>
            </div>
            <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-center">
              <span className="text-lg font-bold text-cyan-400">{digest.matchedCount}</span>
              <span className="block text-[10px] text-cyan-300 uppercase font-medium">{t.matchedLabel}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-lg font-bold text-slate-100">{digest.sourcesMonitored}</span>
              <span className="block text-[10px] text-slate-400 uppercase font-medium">{t.monitoredLabel}</span>
            </div>
          </div>

          {/* AI Executive Summary */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>{locale === 'ar' ? 'الملخص التنفيذي الذكي' : 'Executive Overview'}</span>
            </h4>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              {summary}
            </p>
          </div>

          {/* Key Match Highlights */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {locale === 'ar' ? 'أبرز النقاط المطابقة اليوم:' : 'Key Match Highlights:'}
            </h4>
            <div className="space-y-2">
              {highlights.map((item, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span className="leading-normal">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {BRAND.tagline}
          </span>
          <button
            onClick={closeDigest}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};
