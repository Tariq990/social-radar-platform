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

  const isAr = locale === 'ar';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'register'
        ? await apiRegister(email.trim(), password, name.trim() || undefined)
        : await apiLogin(email.trim(), password);
      if (!result.authenticated || !result.user) throw new Error(isAr ? 'تعذر تسجيل الدخول.' : 'Authentication did not complete.');
      onSuccess();
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر تسجيل الدخول.' : 'Could not authenticate.'));
    } finally {
      setBusy(false);
    }
  };

  const card = (
    <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 sm:p-7 shadow-2xl shadow-cyan-950/30">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-11 w-11 rounded-2xl bg-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Radar className="w-6 h-6 text-slate-950" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-100">MR SCRAP</h1>
          <p className="text-xs text-slate-400">{isAr ? 'حساب الرادار الخاص بك' : 'Your private radar account'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800 mb-5">
        <button type="button" onClick={() => { setMode('login'); setError(null); }} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === 'login' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}>
          {isAr ? 'تسجيل الدخول' : 'Sign in'}
        </button>
        <button type="button" onClick={() => { setMode('register'); setError(null); }} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === 'register' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}>
          {isAr ? 'إنشاء حساب' : 'Create account'}
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3.5">
        {mode === 'register' && (
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-400">{isAr ? 'الاسم' : 'Name'}</span>
            <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 focus-within:border-cyan-500">
              <UserRound className="w-4 h-4 text-slate-500" />
              <input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder={isAr ? 'اسمك' : 'Your name'} />
            </div>
          </label>
        )}

        <label className="block">
          <span className="text-[11px] font-semibold text-slate-400">{isAr ? 'البريد الإلكتروني' : 'Email'}</span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 focus-within:border-cyan-500">
            <Mail className="w-4 h-4 text-slate-500" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="you@example.com" />
          </div>
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-slate-400">{isAr ? 'كلمة المرور' : 'Password'}</span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 focus-within:border-cyan-500">
            <LockKeyhole className="w-4 h-4 text-slate-500" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={200} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="w-full bg-transparent py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder={isAr ? '10 أحرف على الأقل' : 'At least 10 characters'} />
          </div>
        </label>

        {error && <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300">{error}</div>}

        <button type="submit" disabled={busy || !email.trim() || password.length < 10} className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2">
          <span>{busy ? (isAr ? 'جاري التحقق...' : 'Checking...') : mode === 'login' ? (isAr ? 'دخول إلى الرادار' : 'Enter Radar') : (isAr ? 'إنشاء الحساب' : 'Create account')}</span>
          {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </form>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-[11px] leading-relaxed text-slate-400">
        <ShieldCheck className="mt-0.5 w-4 h-4 shrink-0 text-emerald-400" />
        <span>{isAr ? 'جلسة حساب MR SCRAP منفصلة عن جلسة Facebook. كلمة مرور Facebook وملفات تعريف الارتباط لا تُرسل إلى خادم MR SCRAP.' : 'Your MR SCRAP account session is separate from Facebook. Facebook passwords and raw cookies are never sent to the MR SCRAP backend.'}</span>
      </div>

      {onCancel && (
        <button type="button" onClick={onCancel} className="mt-4 w-full text-xs font-semibold text-slate-500 hover:text-slate-300">
          {isAr ? 'العودة' : 'Back'}
        </button>
      )}
    </div>
  );

  if (modal) {
    return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">{card}</div>;
  }

  return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 sm:p-6">{card}</div>;
};
