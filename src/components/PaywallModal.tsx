import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { useRadar } from '../context/RadarContext';

export const PaywallModal: React.FC = () => {
  const { isPaywallOpen, closePaywall, user, locale } = useRadar();
  if (!isPaywallOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div id="modal-paywall" className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div><h2 className="text-base font-bold text-slate-100">{locale === 'ar' ? 'الخطة الحالية' : 'Current plan'}</h2><p className="text-xs text-slate-400 mt-0.5">MR SCRAP</p></div>
          <button onClick={closePaywall} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-4 rounded-2xl bg-slate-950 border border-cyan-500/25 flex items-center justify-between"><div><span className="text-[11px] text-slate-500">{locale === 'ar' ? 'الخطة' : 'Plan'}</span><p className="text-lg font-black text-cyan-400 uppercase">{user.plan}</p></div><ShieldCheck className="w-6 h-6 text-cyan-400" /></div>
          <p className="text-sm text-slate-400 leading-6">{locale === 'ar' ? 'الترقية والدفع غير مفعّلين داخل نسخة الاختبار الحالية. لن نعرض شراءً أو مزايا مدفوعة قبل أن تكون متاحة فعليًا.' : 'Upgrades and billing are not enabled in this alpha build. Paid purchase options will only appear when they are actually available.'}</p>
          <button onClick={closePaywall} className="w-full py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-sm font-bold">{locale === 'ar' ? 'إغلاق' : 'Close'}</button>
        </div>
      </div>
    </div>
  );
};
