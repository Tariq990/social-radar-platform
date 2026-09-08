import React from 'react';
import { Radar, ArrowLeft, ArrowRight, Bell, Filter, Link2, ShieldCheck, Smartphone, Globe, Moon, Sun, CheckCircle2, Sparkles } from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { BRAND } from '../config/brand';

export const LandingScreen: React.FC = () => {
  const { setCurrentScreen, openAddSource, locale, setLocale, theme, setTheme, backendStatus } = useRadar();
  const ar = locale === 'ar';
  const status = backendStatus === 'online' ? (ar ? 'الخدمة متصلة' : 'Service online') : backendStatus === 'offline' ? (ar ? 'الخدمة غير متصلة' : 'Service offline') : (ar ? 'جاري الاتصال' : 'Connecting');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          <button onClick={() => setCurrentScreen('landing')} className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center flex-none"><Radar className="w-5 h-5 text-cyan-400" /></span>
            <span className="min-w-0 text-start"><strong className="block text-sm tracking-tight">{BRAND.name}</strong><span className="block text-[10px] text-cyan-400">{ar ? BRAND.categoryAr : BRAND.category}</span></span>
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400"><span className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-emerald-400' : backendStatus === 'offline' ? 'bg-rose-400' : 'bg-amber-400'}`} />{status}</span>
            <button onClick={() => setLocale(ar ? 'en' : 'ar')} className="w-9 h-9 rounded-xl border border-slate-800 bg-slate-900 text-slate-300 flex items-center justify-center" aria-label="Language"><Globe className="w-4 h-4" /></button>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="w-9 h-9 rounded-xl border border-slate-800 bg-slate-900 text-slate-300 flex items-center justify-center" aria-label="Theme">{theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-cyan-400" />}</button>
            <button onClick={() => setCurrentScreen('radar')} className="px-3.5 h-9 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold">{ar ? 'فتح الرادار' : 'Open radar'}</button>
          </div>
        </div>
      </header>

      <main>
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 font-semibold"><Smartphone className="w-3.5 h-3.5" />{ar ? 'مراقبة Facebook وInstagram من جلسة جهازك' : 'Facebook & Instagram monitoring from your device session'}</div>
          <h1 className="mt-6 text-4xl sm:text-6xl font-black tracking-tight leading-[1.1]">
            {ar ? <>راقب ما <span className="text-cyan-400">يهمك</span> فقط.</> : <>Watch only what <span className="text-cyan-400">matters</span>.</>}
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-400 leading-8 max-w-2xl mx-auto">
            {ar ? 'أضف صفحة أو حسابًا، راقب ما سيُنشر لاحقًا، أو اطلب فورًا آخر المنشورات وابحث فيها وصنّفها بالذكاء الاصطناعي.' : 'Add a page or account, monitor what happens next, or instantly grab recent posts and search or classify them with AI.'}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => openAddSource()} className="px-6 py-3 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-black inline-flex items-center justify-center gap-2"><Link2 className="w-4 h-4" />{ar ? 'أضف أول مصدر' : 'Add a source'}{ar ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}</button>
            <button onClick={() => setCurrentScreen('radar')} className="px-6 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-200 text-sm font-bold">{ar ? 'لوحة التحكم' : 'Dashboard'}</button>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Feature icon={Link2} title={ar ? 'أضف المصدر' : 'Add a source'} text={ar ? 'Facebook أو Instagram. التطبيق يتعرف على الحساب أو الصفحة ويمنع التكرار.' : 'Facebook or Instagram. The app resolves the account/page and blocks duplicates.'} />
          <Feature icon={Filter} title={ar ? 'اكتب قاعدة' : 'Write a rule'} text={ar ? 'قل بلغتك العادية ما الذي يستحق تنبيهك عند ظهوره مستقبلًا.' : 'Describe in plain language what should trigger a future alert.'} />
          <Feature icon={Sparkles} title={ar ? 'اجلب وحلّل الآن' : 'Grab & analyze now'} text={ar ? 'اجلب حتى آخر 20 منشورًا لكل مصدر وابحث فيها أو صنّفها تلقائيًا أو حسب تصنيفاتك.' : 'Grab up to the latest 20 posts per source, then search or classify them automatically or with your own categories.'} />
          <Feature icon={Bell} title={ar ? 'استلم التطابق' : 'Get the match'} text={ar ? 'التنبيه مبني على محتوى حقيقي جديد، والجلب التاريخي لا يصنع تنبيهات قديمة.' : 'Alerts come from real new content; historical grabs never manufacture old alerts.'} />
        </section>

        <section className="border-y border-slate-800/80 bg-slate-900/35">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-emerald-400" /></div>
              <h2 className="mt-4 text-2xl font-black">{ar ? 'تسجيل دخول محلي، وليس تسليم الحساب.' : 'Local login, not account handoff.'}</h2>
              <p className="mt-3 text-sm text-slate-400 leading-7">{ar ? 'على Android تسجّل الدخول داخل الموقع الحقيقي لـFacebook أو Instagram. كلمات المرور وملفات تعريف الارتباط الخام لا تُرسل إلى خادم MR SCRAP.' : 'On Android you sign in on the real Facebook or Instagram website. Passwords and raw browser cookies are not sent to the MR SCRAP backend.'}</p>
            </div>
            <div className="space-y-3">
              {[ar ? 'جلسة منفصلة لكل منصة' : 'Separate session for each platform', ar ? 'المحتوى المُطبّع فقط ينتقل للمعالجة' : 'Only normalized collected content is processed', ar ? 'يمكنك قطع اتصال أي منصة من الإعدادات' : 'Disconnect either platform from Settings'].map(item => <div key={item} className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-300"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-none" />{item}</div>)}
            </div>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-black">{ar ? 'مش Feed جديد تضيع فيه.' : 'Not another feed to get lost in.'}</h2>
          <p className="mt-3 text-sm text-slate-400 max-w-xl mx-auto">{ar ? 'الوضع المستمر ينبهك فقط عند المهم، ووضع الجلب يعطيك إجابة مصنفة عند الطلب بدل تمرير عشرات المنشورات يدويًا.' : 'Continuous mode alerts only on what matters; Grab mode gives you an on-demand classified answer instead of making you scroll dozens of posts.'}</p>
        </section>
      </main>
    </div>
  );
};

const Feature: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; text: string }> = ({ icon: Icon, title, text }) => (
  <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800"><div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center"><Icon className="w-5 h-5 text-cyan-400" /></div><h3 className="mt-4 text-base font-bold text-slate-100">{title}</h3><p className="mt-2 text-sm text-slate-400 leading-6">{text}</p></div>
);
