import React from 'react';
import { X, Sparkles, CheckCircle2 } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';

export const DigestModal: React.FC = () => {
  const { isDigestOpen, closeDigest, matches, sources, locale } = useRadar();
  const t = translations[locale];
  if (!isDigestOpen) return null;

  const realStoredPosts = sources.reduce((sum, source) => sum + Number(source.recentPostsCount || 0), 0);
  const highlights = matches.slice(0, 3).map(match => `${match.sourceName || (locale === 'ar' ? 'مصدر' : 'Source')}: ${match.reason || match.post?.text || ''}`.trim());
  const generatedAt = matches[0]?.createdAt || sources.find(source => source.lastCheckedAt)?.lastCheckedAt || '—';
  const summary = matches.length > 0
    ? (locale === 'ar' ? `لديك ${matches.length} تطابقات محفوظة من ${sources.length} مصادر مراقبة.` : `You have ${matches.length} saved matches from ${sources.length} monitored sources.`)
    : (locale === 'ar' ? 'لا توجد تطابقات بعد.' : 'No matches yet.');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm">
      <div id="modal-digest" className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center"><Sparkles className="w-4 h-4 text-amber-400" /></div><div><h3 className="text-sm font-bold text-slate-100">{t.quickDigestTitle}</h3><p className="text-[11px] text-slate-400">{generatedAt}</p></div></div>
          <button onClick={closeDigest} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-3 gap-2"><Stat value={realStoredPosts} label={locale === 'ar' ? 'منشورات' : 'Posts'} /><Stat value={matches.length} label={t.matchedLabel} accent /><Stat value={sources.length} label={t.monitoredLabel} /></div>
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800"><p className="text-sm text-slate-200 leading-6">{summary}</p></div>
          <div className="space-y-2"><h4 className="text-xs font-semibold text-slate-400">{locale === 'ar' ? 'أحدث التطابقات' : 'Latest matches'}</h4>{highlights.length > 0 ? highlights.map((item, index) => <div key={index} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-none mt-0.5" /><span>{item}</span></div>) : <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-500">{locale === 'ar' ? 'نفّذ فحصًا أو انتظر منشورًا جديدًا يطابق إحدى قواعدك.' : 'Run a scan or wait for a new post that matches one of your rules.'}</div>}</div>
        </div>
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/40 flex justify-end"><button onClick={closeDigest} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium">{t.close}</button></div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ value: number; label: string; accent?: boolean }> = ({ value, label, accent }) => <div className={`p-3 rounded-xl border text-center ${accent ? 'bg-cyan-950/30 border-cyan-500/25' : 'bg-slate-950 border-slate-800'}`}><span className={`text-lg font-bold ${accent ? 'text-cyan-400' : 'text-slate-100'}`}>{value}</span><span className="block text-[10px] text-slate-400">{label}</span></div>;
