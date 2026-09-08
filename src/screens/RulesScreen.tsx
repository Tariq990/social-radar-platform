import React, { useState } from 'react';
import { SlidersHorizontal, Plus, Trash2, Check, Sparkles, Clock, X, Layers, AlertCircle } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';

export const RulesScreen: React.FC = () => {
  const { rules, sources, toggleRule, deleteRule, addRule, locale } = useRadar();
  const t = translations[locale];
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [name, setName] = useState('');
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreateRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !naturalLanguage.trim() || sources.length === 0 || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await addRule({
        name: name.trim(),
        naturalLanguage: naturalLanguage.trim(),
        sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : sources.map(source => source.id),
        minConfidence: 0.8,
        alertMode: 'instant',
        enabled: true
      });
      setIsCreatingRule(false);
      setName('');
      setNaturalLanguage('');
      setSelectedSourceIds([]);
    } catch (error: any) {
      setFormError(error?.message || (locale === 'ar' ? 'تعذر حفظ القاعدة.' : 'Could not save the rule.'));
    } finally { setSaving(false); }
  };

  const toggleSelectSource = (id: string) => setSelectedSourceIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);

  return (
    <div className="space-y-5 pb-12">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-100">{t.rulesTitle}</h1><p className="text-xs text-slate-400 mt-1">{rules.length} {locale === 'ar' ? 'قاعدة مراقبة' : 'watch rules'}</p></div>
        <button id="btn-create-rule" onClick={() => { setIsCreatingRule(true); setFormError(null); }} disabled={sources.length === 0} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold disabled:opacity-40"><Plus className="w-4 h-4" />{t.newRuleBtn}</button>
      </div>

      {sources.length === 0 && <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-slate-400">{locale === 'ar' ? 'أضف مصدرًا أولًا، ثم أنشئ قواعد المراقبة.' : 'Add a source first, then create monitoring rules.'}</div>}

      {isCreatingRule && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-cyan-500/30 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3"><h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Sparkles className="w-4 h-4 text-cyan-400" />{locale === 'ar' ? 'قاعدة جديدة' : 'New watch rule'}</h3><button onClick={() => setIsCreatingRule(false)} className="p-1 text-slate-400"><X className="w-4 h-4" /></button></div>
          <form onSubmit={handleCreateRule} className="space-y-4">
            <label className="block"><span className="block text-xs font-semibold text-slate-300 mb-1">{t.ruleNameLabel}</span><input value={name} onChange={e => setName(e.target.value)} placeholder={locale === 'ar' ? 'مثال: عروض السيارات' : 'e.g. Car offers'} className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500" required /></label>
            <label className="block"><span className="block text-xs font-semibold text-slate-300 mb-1">{t.ruleComposerTitle}</span><textarea value={naturalLanguage} onChange={e => setNaturalLanguage(e.target.value)} rows={3} placeholder={locale === 'ar' ? 'اكتب بالضبط متى تريد أن يصلك تنبيه...' : 'Describe exactly when you want an alert...'} className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500 resize-none" required /></label>

            <div><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-slate-300">{locale === 'ar' ? 'المصادر' : 'Sources'}</span><span className="text-[11px] text-slate-500">{selectedSourceIds.length === 0 ? (locale === 'ar' ? 'الكل' : 'All') : selectedSourceIds.length}</span></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto">{sources.map(source => { const checked = selectedSourceIds.includes(source.id); return <button key={source.id} type="button" onClick={() => toggleSelectSource(source.id)} className={`text-start p-2.5 rounded-xl border text-xs flex items-center gap-2 ${checked ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' : 'bg-slate-950 text-slate-400 border-slate-800'}`}><span className={`w-4 h-4 rounded flex items-center justify-center border ${checked ? 'bg-cyan-500 border-cyan-400 text-slate-950' : 'border-slate-700'}`}>{checked && <Check className="w-3 h-3" />}</span><span className="truncate">{source.displayName}</span></button>; })}</div></div>

            {formError && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex gap-2"><AlertCircle className="w-4 h-4" />{formError}</div>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsCreatingRule(false)} className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs">{t.cancel}</button><button type="submit" disabled={saving || !name.trim() || !naturalLanguage.trim()} className="px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold disabled:opacity-40">{saving ? t.saving : t.applyRuleBtn}</button></div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {rules.map(rule => {
          const appliedSources = sources.filter(source => rule.sourceIds.includes(source.id));
          return (
            <article key={rule.id} className={`p-4 sm:p-5 rounded-2xl border ${rule.enabled ? 'bg-slate-900 border-slate-800' : 'bg-slate-900/40 border-slate-800/60 opacity-70'}`}>
              <div className="flex items-start justify-between gap-3"><div className="space-y-2 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold text-sm text-slate-100">{rule.name}</h3><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rule.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>{rule.enabled ? t.ruleActive : t.rulePaused}</span></div><p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">{rule.naturalLanguage}</p></div><div className="flex items-center gap-1 flex-none"><button onClick={() => void toggleRule(rule.id).catch(() => {})} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rule.enabled ? 'bg-slate-800 text-slate-300' : 'bg-cyan-500 text-slate-950'}`}>{rule.enabled ? t.pauseMonitoring : t.resumeMonitoring}</button><button onClick={() => { if (window.confirm(locale === 'ar' ? 'حذف هذه القاعدة؟' : 'Delete this rule?')) void deleteRule(rule.id).catch(() => {}); }} className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button></div></div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"><div className="flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-cyan-400" /><span>{t.appliedToSources} <strong className="text-slate-200">{appliedSources.length}</strong></span>{appliedSources.length > 0 && <span className="hidden sm:inline text-slate-500">({appliedSources.map(source => source.displayName).slice(0, 2).join(', ')})</span>}</div>{rule.lastMatchAt && <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{rule.lastMatchAt}</div>}</div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
