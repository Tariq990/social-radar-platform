import React from 'react';
import { X, Sparkles, CheckCircle2 } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND } from '../config/brand';

export const DigestModal: React.FC = () => {
  const { isDigestOpen, closeDigest, matches, sources, locale } = useRadar();
  const t = translations[locale];

  if (!isDigestOpen) return null;

  const realStoredPosts = sources.reduce((sum, source) => sum + Number(source.recentPostsCount || 0), 0);
  const highlights = matches.slice(0, 3).map(match => {
    const source = match.sourceName || (locale === 'ar' ? 'مصدر' : 'Source');
    return `${source}: ${match.reason || match.post?.text || ''}`.trim();
  });
  const generatedAt = matches[0]?.createdAt || sources.find(source => source.lastCheckedAt)?.lastCheckedAt || (locale === 'ar' ? 'لا توجد بيانات بعد' : 'No data yet');
  const summary = matches.length > 0
    ? (locale === 'ar'
      ? `هذا الملخص مبني على ${matches.length} تطابقات فعلية محفوظة من ${sources.length} مصادر مراقبة.`
      : `This digest is based on ${matches.length} real persisted matches from ${sources.length} monitored sources.`)
    : (locale === 'ar'
      ? 'لا توجد تطابقات فعلية لتلخيصها بعد. نفّذ فحصًا أو انتظر منشورًا جديدًا يطابق قواعدك.'
      : 'There are no real matches to summarize yet. Run a scan or wait for a new post that matches your rules.');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div id="modal-digest" className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{t.quickDigestTitle}</h3>
              <p className="text-[11px] text-slate-400">{generatedAt}</p>
            </div>
          </div>
          <button onClick={closeDigest} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-lg font-bold text-slate-100">{realStoredPosts}</span>
              <span className="block text-[10px] text-slate-400 uppercase font-medium">{locale === 'ar' ? 'منشورات فعلية' : 'Real posts'}</span>
            </div>
            <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-center">
              <span className="text-lg font-bold text-cyan-400">{matches.length}</span>
              <span className="block text-[10px] text-cyan-300 uppercase font-medium">{t.matchedLabel}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
              <span className="text-lg font-bold text-slate-100">{sources.length}</span>
              <span className="block text-[10px] text-slate-400 uppercase font-medium">{t.monitoredLabel}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>{locale === 'ar' ? 'ملخص البيانات الفعلية' : 'Real-data overview'}</span>
            </h4>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">{summary}</p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {locale === 'ar' ? 'أحدث التطابقات:' : 'Latest matches:'}
            </h4>
            {highlights.length > 0 ? (
              <div className="space-y-2">
                {highlights.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span className="leading-normal">{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-500">
                {locale === 'ar' ? 'لا توجد نقاط وهمية أو بيانات تجريبية هنا.' : 'No placeholder or demo highlights are shown here.'}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
          <span className="text-xs text-slate-500">{locale === 'ar' ? BRAND.taglineAr : BRAND.tagline}</span>
          <button onClick={closeDigest} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors">{t.close}</button>
        </div>
      </div>
    </div>
  );
};
