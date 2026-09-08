import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, Radar, ShieldCheck, UserRound } from 'lucide-react';
import { apiLogin, apiRegister } from '../services/api';

interface AuthScreenProps {
  locale: 'en' | 'ar';
  onSuccess: () => void;
  onCancel?: () => void;
  modal?: boolean;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ locale, onSuccess, onCancel, modal = false }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ar = locale === 'ar';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'register'
        ? await apiRegister(email.trim(), password, name.trim() || undefined)
        : await apiLogin(email.trim(), password);
      if (!result.authenticated || !result.user) throw new Error(ar ? 'تعذر تسجيل الدخول.' : 'Authentication did not complete.');
      onSuccess();
    } catch (err: any) {
      setError(err?.message || (ar ? 'تعذر تسجيل الدخول.' : 'Could not authenticate.'));
    } finally { setBusy(false); }
  };

  const card = (
    <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 sm:p-7 shadow-2xl shadow-cyan-950/30">
      <div className="flex items-center gap-3 mb-6"><div className="h-11 w-11 rounded-2xl bg-cyan-500 flex items-center justify-center"><Radar className="w-6 h-6 text-slate-950" /></div><div><h1 className="text-lg font-black text-slate-100">MR SCRAP</h1><p className="text-xs text-slate-400">{ar ? 'حساب الرادار الخاص بك' : 'Your radar account'}</p></div></div>
      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800 mb-5">
        <button type="button" onClick={() => { setMode('login'); setError(null); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${mode === 'login' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}>{ar ? 'تسجيل الدخول' : 'Sign in'}</button>
        <button type="button" onClick={() => { setMode('register'); setError(null); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${mode === 'register' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}>{ar ? 'إنشاء حساب' : 'Create account'}</button>
      </div>

      <form onSubmit={submit} className="space-y-3.5">
        {mode === 'register' && <Field label={ar ? 'الاسم' : 'Name'} icon={UserRound}><input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none" placeholder={ar ? 'اسمك' : 'Your name'} /></Field>}
        <Field label={ar ? 'البريد الإلكتروني' : 'Email'} icon={Mail}><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none" placeholder="you@example.com" /></Field>
        <Field label={ar ? 'كلمة المرور' : 'Password'} icon={LockKeyhole}><input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={200} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none" placeholder={ar ? '10 أحرف على الأقل' : 'At least 10 characters'} /></Field>
        {error && <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300">{error}</div>}
        <button type="submit" disabled={busy || !email.trim() || password.length < 10} className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40 flex items-center justify-center gap-2"><span>{busy ? (ar ? 'جاري التحقق...' : 'Checking...') : mode === 'login' ? (ar ? 'دخول إلى الرادار' : 'Enter radar') : (ar ? 'إنشاء الحساب' : 'Create account')}</span>{ar ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}</button>
      </form>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-[11px] leading-relaxed text-slate-400"><ShieldCheck className="mt-0.5 w-4 h-4 shrink-0 text-emerald-400" /><span>{ar ? 'حساب MR SCRAP منفصل عن جلسات Facebook وInstagram. كلمات مرور المنصات وملفات تعريف الارتباط الخام لا تُرسل إلى خادم MR SCRAP.' : 'Your MR SCRAP account is separate from Facebook and Instagram sessions. Platform passwords and raw browser cookies are not sent to the MR SCRAP backend.'}</span></div>
      {onCancel && <button type="button" onClick={onCancel} className="mt-4 w-full text-xs font-semibold text-slate-500 hover:text-slate-300">{ar ? 'العودة' : 'Back'}</button>}
    </div>
  );

  return modal
    ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">{card}</div>
    : <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 sm:p-6">{card}</div>;
};

const Field: React.FC<{ label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }> = ({ label, icon: Icon, children }) => (
  <label className="block"><span className="text-[11px] font-semibold text-slate-400">{label}</span><div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 focus-within:border-cyan-500"><Icon className="w-4 h-4 text-slate-500" />{children}</div></label>
);
