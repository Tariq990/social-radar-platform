import React, { useState } from 'react';
import { 
  SlidersHorizontal, 
  Plus, 
  Trash2, 
  Check, 
  Sparkles, 
  Clock, 
  Folder, 
  CheckCircle2, 
  X,
  Layers,
  ArrowRight
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { WatchRule } from '../types';
import { translations } from '../lib/i18n';

export const RulesScreen: React.FC = () => {
  const { rules, sources, collections, toggleRule, deleteRule, addRule, locale } = useRadar();
  const t = translations[locale];

  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [name, setName] = useState('');
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [minConfidence, setMinConfidence] = useState(0.8);
  const [alertMode, setAlertMode] = useState<'instant' | 'digest'>('instant');

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !naturalLanguage.trim()) return;

    addRule({
      name,
      naturalLanguage,
      sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : sources.map(s => s.id),
      minConfidence,
      alertMode,
      enabled: true
    });

    setIsCreatingRule(false);
    setName('');
    setNaturalLanguage('');
    setSelectedSourceIds([]);
  };

  const toggleSelectSource = (id: string) => {
    setSelectedSourceIds(prev => 
      prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t.rulesTitle}</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {rules.length} {locale === 'ar' ? 'قواعد ذكية تراقب وتصنف المنشورات' : 'natural language filters routing alerts'}
          </p>
        </div>

        <button
          id="btn-create-rule"
          onClick={() => setIsCreatingRule(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>{t.newRuleBtn}</span>
        </button>
      </div>

      {/* Create Rule Modal / Drawer */}
      {isCreatingRule && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-cyan-500/30 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>{locale === 'ar' ? 'إنشاء قاعدة مراقبة ذكية' : 'Create Watch Rule'}</span>
            </h3>
            <button
              onClick={() => setIsCreatingRule(false)}
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreateRule} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {t.ruleNameLabel}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. BMW Under $20,000, 30% Discounts, Tech Hiring"
                className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {t.ruleComposerTitle}
              </label>
              <textarea
                value={naturalLanguage}
                onChange={(e) => setNaturalLanguage(e.target.value)}
                rows={2}
                placeholder="Describe what to watch for in plain words..."
                className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-cyan-500 resize-none"
                required
              />
            </div>

            {/* Target Sources Checklist */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {locale === 'ar' ? 'تطبيق على المصادر:' : 'Apply to sources:'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-1">
                {sources.map((s) => {
                  const isChecked = selectedSourceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSelectSource(s.id)}
                      className={`text-start p-2 rounded-xl border text-xs flex items-center gap-2 transition-colors ${
                        isChecked 
                          ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30 font-medium'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                        isChecked ? 'bg-cyan-500 border-cyan-400 text-slate-950' : 'border-slate-700'
                      }`}>
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className="truncate">{s.displayName}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreatingRule(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold"
              >
                {t.applyRuleBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rules List (Section 16) */}
      <div className="space-y-3">
        {rules.map((rule) => {
          const appliedSources = sources.filter(s => rule.sourceIds.includes(s.id));
          return (
            <div
              key={rule.id}
              id={`rule-card-${rule.id}`}
              className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                rule.enabled 
                  ? 'bg-slate-900 border-slate-800 hover:border-slate-700' 
                  : 'bg-slate-900/40 border-slate-800/60 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm text-slate-100">{rule.name}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      rule.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {rule.enabled ? t.ruleActive : t.rulePaused}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase">
                      {rule.alertMode}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed italic bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                    "{rule.naturalLanguage}"
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      rule.enabled 
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' 
                        : 'bg-cyan-500 text-slate-950 font-bold'
                    }`}
                  >
                    {rule.enabled ? t.pauseMonitoring : t.resumeMonitoring}
                  </button>

                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                    title={t.deleteSource}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Bottom Meta */}
              <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    {t.appliedToSources} <strong className="text-slate-200">{rule.sourceIds.length}</strong> {t.sourcesUnit}
                  </span>
                  {appliedSources.length > 0 && (
                    <span className="hidden sm:inline text-slate-500">
                      ({appliedSources.map(s => s.displayName).slice(0, 2).join(', ')}{appliedSources.length > 2 ? '...' : ''})
                    </span>
                  )}
                </div>

                {rule.lastMatchAt && (
                  <div className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-3 h-3" />
                    <span>{t.lastMatchedDate}: {rule.lastMatchAt}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
