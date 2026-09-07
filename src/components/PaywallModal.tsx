import React from 'react';
import { X, Check, ShieldCheck, Zap, Sparkles } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { PLANS_CONFIG } from '../config/brand';

export const PaywallModal: React.FC = () => {
  const { isPaywallOpen, closePaywall, user, locale } = useRadar();
  const t = translations[locale];

  if (!isPaywallOpen) return null;

  const plans = [
    { ...PLANS_CONFIG.free, current: user.plan === 'free' },
    { ...PLANS_CONFIG.pro, current: user.plan === 'pro' },
    { ...PLANS_CONFIG.power, current: user.plan === 'power' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="modal-paywall"
        className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span>{t.paywallTitle}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{t.paywallSub}</p>
          </div>
          <button
            onClick={closePaywall}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tiers Grid */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => {
            const isPopular = 'popular' in p && p.popular;
            const features = locale === 'ar' ? p.featuresAr : p.features;
            return (
              <div
                key={p.id}
                className={`relative rounded-2xl p-5 flex flex-col justify-between border transition-all ${
                  isPopular 
                    ? 'bg-slate-950 border-cyan-500/50 shadow-xl shadow-cyan-950/30 ring-1 ring-cyan-500/20' 
                    : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                {isPopular && (
                  <span className="absolute -top-3 start-6 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 uppercase tracking-wider">
                    {locale === 'ar' ? 'الأكثر طلباً' : 'Recommended'}
                  </span>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-base text-slate-100">
                      {locale === 'ar' ? p.nameAr : p.name}
                    </h3>
                    {p.current && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                        {t.currentPlanBadge}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-2xl sm:text-3xl font-extrabold text-slate-100">${p.price}</span>
                    <span className="text-xs text-slate-400">{t.monthly}</span>
                  </div>

                  <p className="text-xs text-cyan-400 font-medium mt-1">
                    {p.frequency}
                  </p>

                  <div className="mt-5 space-y-2.5 border-t border-slate-800/80 pt-4">
                    {features.map((feat, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                        <Check className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800/80">
                  <button
                    onClick={closePaywall}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
                      p.current
                        ? 'bg-slate-800 text-slate-400 cursor-default'
                        : isPopular
                        ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    {p.current ? t.currentPlanBadge : t.selectPlanBtn}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Guarantee */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/40 text-center text-xs text-slate-400">
          {locale === 'ar' 
            ? 'يمكنك ترقية أو إلغاء اشتراكك في أي وقت. لا نطلب بطاقات ائتمان للباقة التجريبية.'
            : 'Cancel or adjust your plan anytime. Zero lock-in. Powered by Google AI & high-speed connectors.'}
        </div>
      </div>
    </div>
  );
};
