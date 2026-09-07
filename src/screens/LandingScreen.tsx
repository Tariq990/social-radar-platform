import React, { useState } from 'react';
import { 
  Radar, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  Check, 
  ShieldCheck, 
  Zap, 
  Filter, 
  Bell, 
  Layers, 
  Share2,
  ChevronDown,
  Eye,
  CheckCircle2,
  Globe,
  Sun,
  Moon,
  Server,
  Activity,
  Lock,
  Smartphone,
  CheckCircle
} from 'lucide-react';
import { useRadar } from '../context/RadarContext';
import { translations } from '../lib/i18n';
import { BRAND, PLANS_CONFIG } from '../config/brand';

export const LandingScreen: React.FC = () => {
  const { 
    setCurrentScreen, 
    openAddSource, 
    locale, 
    setLocale, 
    theme, 
    setTheme, 
    backendStatus, 
    geminiConfigured 
  } = useRadar();
  const t = translations[locale];

  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [selectedDemoTab, setSelectedDemoTab] = useState<'discount' | 'car' | 'job'>('discount');

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'ar' : 'en');
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const faqs = [
    {
      q: locale === 'ar' ? 'كيف يعمل الرادار مع المنشورات العامة؟' : 'How does MR SCRAP monitor public pages?',
      a: locale === 'ar' 
        ? 'يقوم الخادم بفحص صفحات فيسبوك وإنستغرام العامة تلقائياً بدون الحاجة لتسجيل دخول حسابك، ويقوم نموذج Gemini الذكي بمطابقة كل منشور مع القواعد المكتوبة بلغتك الطبيعية.'
        : 'Public pages are scanned server-side via high-speed connectors. Content is evaluated in real-time by the Gemini AI engine against your exact criteria.'
    },
    {
      q: locale === 'ar' ? 'هل يحتاج الرادار إلى كلمة المرور الخاصة بي؟' : 'Do you require my Facebook or Instagram password?',
      a: locale === 'ar'
        ? 'أبداً. نحن نلتزم بمبدأ الخصوصية الصارمة (Privacy-by-Design). لا نطلب كلمة مرورك ولا نخزنها. مراقبة الصفحات العامة تتم بشكل مستقل تماماً.'
        : 'Never. We strictly follow Privacy-by-Design. Zero password requests. Public pages require no authentication whatsoever.'
    },
    {
      q: locale === 'ar' ? 'ما الفرق بين MR SCRAP وأدوات الكلمات المفتاحية التقليدية؟' : 'Why is this better than traditional keyword scrapers?',
      a: locale === 'ar'
        ? 'الكلمات المفتاحية ترسل مئات التنبيهات المزعجة وغير الدقيقة. MR SCRAP يفهم المعنى والسياق والأرقام (مثل: خصم أكبر من 25%، أو وظيفة محددة براتب معين) ويرسل التنبيه فقط عند التطابق الحقيقي مع إيضاح السبب.'
        : 'Keyword scrapers generate 95% spam. MR SCRAP understands numerical thresholds, context, and intent. You only receive alerts for true matches with full justification.'
    },
    {
      q: locale === 'ar' ? 'هل يمكنني إضافة الرادار كتطبيق على الهاتف (PWA)؟' : 'Can I install this as an app on my phone (PWA)?',
      a: locale === 'ar'
        ? 'نعم! التطبيق متوافق 100% مع معايير PWA، ويدعم التثبيت المباشر على الشاشة الرئيسية واستقبال التنبيهات، بالإضافة لدعم خاصية "مشاركة الرابط" من فيسبوك مباشرة.'
        : 'Yes! Fully PWA compliant with home screen installation, native-like experience, push notifications, and direct Android Share Sheet support.'
    }
  ];

  const demoScenarios = {
    discount: {
      source: 'Zara Official',
      post: locale === 'ar' 
        ? 'مفاجأة عطلة نهاية الأسبوع! خصم 40% على جميع المعاطف والأحذية الشتوية لفترة محدودة داخل جميع الفروع والموقع الإلكتروني.'
        : 'Weekend surprise! 40% OFF all winter coats and footwear for a limited time in stores and online.',
      rule: locale === 'ar' ? 'أخبرني عند وجود خصم 30% أو أكثر' : 'Alert me when discount is 30% or more',
      matchReason: locale === 'ar' ? 'تطابق فوري: تم رصد خصم 40% متجاوزاً الحد المطلوب (30%).' : 'Verified match: 40% discount detected exceeding 30% threshold.',
      tag: '40% OFF',
      category: locale === 'ar' ? 'تخفيضات' : 'Discount'
    },
    car: {
      source: 'AutoMarket Jordan',
      post: locale === 'ar'
        ? 'وصل حديثاً: سيارة BMW 320i موديل 2022 فحص كامل، بحالة الوكالة وبسعر خاص 18,500 دينار فقط.'
        : 'Just arrived: 2022 BMW 320i, pristine condition, full inspection passed, special price $18,500.',
      rule: locale === 'ar' ? 'تنبيه لأي سيارة BMW بسعر أقل من 20,000' : 'Alert me about any BMW under $20,000',
      matchReason: locale === 'ar' ? 'تطابق مؤكد: السعر المرصود 18,500 أقل من الحد الأقصى 20,000.' : 'Confirmed match: Listed price $18,500 is below the $20,000 cap.',
      tag: '$18,500',
      category: locale === 'ar' ? 'هدف سعري' : 'Price Target'
    },
    job: {
      source: 'TechHub MENA',
      post: locale === 'ar'
        ? 'نبحث عن مهندس ذكاء اصطناعي (AI / ML Engineer) للعمل عن بُعد بدوام كامل مع فريقنا في دبي.'
        : 'We are hiring a Senior AI / ML Engineer (Remote) to join our product core team.',
      rule: locale === 'ar' ? 'وظائف مهندسي الذكاء الاصطناعي عن بعد' : 'Remote AI / ML Engineer job openings',
      matchReason: locale === 'ar' ? 'تطابق مباشر في المسمى الوظيفي ونظام العمل عن بُعد.' : 'Direct role match with remote work policy verified.',
      tag: 'Remote Role',
      category: locale === 'ar' ? 'وظائف' : 'Job Opening'
    }
  };

  const activeScenario = demoScenarios[selectedDemoTab];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950 transition-colors">
      
      {/* 1. Public Website Top Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Brand Logo */}
          <div 
            onClick={() => setCurrentScreen('landing')} 
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 font-bold shadow-md shadow-cyan-500/20 group-hover:scale-105 transition-transform">
              <Radar className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <span className="text-base font-extrabold tracking-tight text-slate-100 flex items-center gap-1.5">
                <span>{BRAND.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-semibold uppercase">
                  Radar
                </span>
              </span>
              <p className="text-[10px] text-slate-400 hidden sm:block">
                {locale === 'ar' ? 'رادار المراقبة الذكية' : 'AI-Powered Social Radar'}
              </p>
            </div>
          </div>

          {/* Public Nav Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
            <a href="#features" className="hover:text-cyan-400 transition-colors">
              {locale === 'ar' ? 'المميزات' : 'Features'}
            </a>
            <a href="#how-it-works" className="hover:text-cyan-400 transition-colors">
              {locale === 'ar' ? 'كيف يعمل' : 'How It Works'}
            </a>
            <a href="#live-demo" className="hover:text-cyan-400 transition-colors">
              {locale === 'ar' ? 'التجربة الحية' : 'Live Demo'}
            </a>
            <a href="#pricing" className="hover:text-cyan-400 transition-colors">
              {locale === 'ar' ? 'الأسعار' : 'Pricing'}
            </a>
            <a href="#faq" className="hover:text-cyan-400 transition-colors">
              {locale === 'ar' ? 'الأسئلة' : 'FAQ'}
            </a>
          </nav>

          {/* Right Action Cluster */}
          <div className="flex items-center gap-2.5">
            
            {/* Backend Health Badge */}
            <div 
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-900 border border-slate-800 text-slate-300"
              title="Express Backend + Gemini API Status"
            >
              <span className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-[10px]">
                {backendStatus === 'online' 
                  ? (locale === 'ar' ? 'الخادم متصل' : 'Server Online') 
                  : (locale === 'ar' ? 'الخادم جاهز' : 'Server Ready')}
              </span>
            </div>

            {/* Language Switch */}
            <button
              id="btn-landing-lang"
              onClick={toggleLanguage}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
              title="Switch Language"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>{locale === 'en' ? 'عربي' : 'EN'}</span>
            </button>

            {/* Theme Switch */}
            <button
              id="btn-landing-theme"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-cyan-400" />}
            </button>

            {/* Primary Action Button: Launch Dashboard */}
            <button
              id="btn-launch-dashboard-nav"
              onClick={() => setCurrentScreen('radar')}
              className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 text-xs font-bold rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <span>{locale === 'ar' ? 'لوحة التحكم' : 'Launch App'}</span>
              {locale === 'ar' ? <ArrowLeft className="w-3.5 h-3.5 stroke-[2.5]" /> : <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Landing Page Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-20">

        {/* Hero Section */}
        <section className="pt-6 sm:pt-14 text-center space-y-6 max-w-3xl mx-auto relative">
          
          {/* Subtle Glow Backdrop */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

          {/* Pill Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 text-xs font-semibold shadow-inner">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              {locale === 'ar' 
                ? 'خادم Express مخصص • مدعوم بنموذج Gemini 3.8 Flash' 
                : 'Express Server Connected • Powered by Gemini 3.8 Flash'}
            </span>
          </div>

          {/* Main Headline */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-slate-100 tracking-tight leading-[1.15]">
            {locale === 'ar' ? (
              <>
                راقب ما يهمك حقاً على <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">فيسبوك وإنستغرام</span>
              </>
            ) : (
              <>
                Watch what truly matters on <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Social Media</span>
              </>
            )}
          </h1>

          {/* Subtitle */}
          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl mx-auto font-normal">
            {locale === 'ar'
              ? 'توقف عن تضييع ساعات في التصفح العشوائي. اكتب شروطك باللغة الطبيعية (تخفيضات، عروض سيارات، وظائف)، واستلم تنبيهاً نظيفاً فور النشر.'
              : 'Stop endless doomscrolling. Set natural language watch rules for your favorite public pages and get alerted instantly when they publish what you actually care about.'}
          </p>

          {/* Primary Action Buttons */}
          <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3.5">
            <button
              id="btn-hero-launch-dashboard"
              onClick={() => setCurrentScreen('radar')}
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-black flex items-center justify-center gap-2 shadow-xl shadow-cyan-500/25 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <span>{locale === 'ar' ? 'الدخول إلى لوحة التحكم' : 'Enter Dashboard'}</span>
              {locale === 'ar' ? <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> : <ArrowRight className="w-4 h-4 stroke-[2.5]" />}
            </button>

            <button
              id="btn-hero-add-source-now"
              onClick={() => {
                setCurrentScreen('radar');
                openAddSource();
              }}
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Radar className="w-4 h-4 text-cyan-400" />
              <span>{locale === 'ar' ? '+ إضافة صفحة للمراقبة' : '+ Add Page to Watch'}</span>
            </button>
          </div>

          {/* Live System Indicators */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>{locale === 'ar' ? 'بدون كلمات مرور' : 'Zero Passwords Required'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>{locale === 'ar' ? 'فحص سحابي سريع' : 'Sub-second Cloud Match'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Server className="w-4 h-4 text-cyan-400" />
              <span>{locale === 'ar' ? 'خادم متكامل API' : 'Full-Stack Express API'}</span>
            </div>
          </div>
        </section>

        {/* Interactive Live Demo Section */}
        <section id="live-demo" className="scroll-mt-20 p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-2xl relative overflow-hidden">
          <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
            <h2 className="text-xl sm:text-2xl font-black text-slate-100">
              {locale === 'ar' ? 'جرب آلية الرصد مباشرة' : 'Interactive Intent Visualizer'}
            </h2>
            <p className="text-xs text-slate-400">
              {locale === 'ar' 
                ? 'شاهد كيف يحول الذكاء الاصطناعي المنشور العشوائي إلى تنبيه دقيق ومؤكد' 
                : 'See how unstructured social posts turn into high-confidence actionable signals'}
            </p>
          </div>

          {/* Scenario Tabs */}
          <div className="flex justify-center gap-2 mb-6">
            <button
              onClick={() => setSelectedDemoTab('discount')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedDemoTab === 'discount'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {locale === 'ar' ? 'تخفيضات 30%+' : 'Discounts 30%+'}
            </button>
            <button
              onClick={() => setSelectedDemoTab('car')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedDemoTab === 'car'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {locale === 'ar' ? 'سيارات تحت 20,000' : 'Cars Under $20k'}
            </button>
            <button
              onClick={() => setSelectedDemoTab('job')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedDemoTab === 'job'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {locale === 'ar' ? 'وظائف ذكاء اصطناعي' : 'AI Job Openings'}
            </button>
          </div>

          {/* 3-Step Flow Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch relative">
            
            {/* Step 1: Raw Post */}
            <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                  {locale === 'ar' ? '1. المنشور العام من الصفحة' : '1. Raw Public Post'}
                </span>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
                    f
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">{activeScenario.source}</span>
                    <span className="text-[10px] text-slate-500">{locale === 'ar' ? 'منشور جديد' : 'New post'}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-300 italic leading-relaxed border-l-2 border-slate-800 ps-2">
                  "{activeScenario.post}"
                </p>
              </div>
              <span className="text-[10px] text-slate-500">{locale === 'ar' ? 'محتوى غير مهيكل' : 'Unstructured text'}</span>
            </div>

            {/* Step 2: Gemini Rule Engine */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 border border-cyan-500/30 flex flex-col justify-between space-y-3 text-center">
              <div>
                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block mb-2">
                  {locale === 'ar' ? '2. فحص نموذج Gemini السحابي' : '2. Gemini Backend Filter'}
                </span>
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-cyan-500/20 text-xs text-cyan-300 font-semibold mb-3">
                  "{activeScenario.rule}"
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 font-bold mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>96% {locale === 'ar' ? 'نسبة تطابق مؤكد' : 'Confidence Match'}</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {activeScenario.matchReason}
                </p>
              </div>
              <div className="text-[10px] text-cyan-400/80 font-mono">
                {locale === 'ar' ? 'استخلاص تلقائي للبيانات' : 'Entity extraction complete'}
              </div>
            </div>

            {/* Step 3: Actionable Alert */}
            <div className="p-5 rounded-2xl bg-slate-950 border border-emerald-500/30 flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-2">
                  {locale === 'ar' ? '3. التنبيه الفوري الصافي' : '3. High-Conviction Alert'}
                </span>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-slate-100">{activeScenario.category}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 font-bold border border-emerald-800/40">
                    {activeScenario.tag}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {activeScenario.matchReason}
                </p>
              </div>
              <button
                onClick={() => setCurrentScreen('radar')}
                className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-400 text-xs font-bold border border-slate-800 transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>{locale === 'ar' ? 'عرض التنبيهات في اللوحة' : 'View in Alerts Dashboard'}</span>
                {locale === 'ar' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </section>

        {/* Core Features Grid */}
        <section id="features" className="scroll-mt-20 space-y-8">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-xl sm:text-3xl font-black text-slate-100">
              {locale === 'ar' ? 'كل ما تحتاجه للرصد الذكي' : 'Engineered for Actionable Intelligence'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {locale === 'ar' ? 'أدوات دقيقة تركز على المحتوى المفيد دون تشتيت' : 'Precision tools designed to keep you informed without the noise'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Feature 1 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 hover:border-slate-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">
                {locale === 'ar' ? 'قواعد باللغة الطبيعية' : 'Natural Language Rules'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {locale === 'ar'
                  ? 'لا حاجة لكلمات مفتاحية معقدة. اكتب بلغتك البسيطة: "أخبرني عند وجود عرض خصم 30%" وسيتكفل الذكاء الاصطناعي بفهم السياق.'
                  : 'Define watch criteria in plain text. Gemini evaluates meaning, numbers, discounts, and semantic context automatically.'}
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 hover:border-slate-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">
                {locale === 'ar' ? 'أمان وخصوصية 100%' : 'Strict Privacy-First'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {locale === 'ar'
                  ? 'لا نطلب كلمة مرور حسابك أبداً. الجلسات الإضافية مشفرة محلياً على جهازك فقط ولا يتم إرسالها لأي جهة خارجية.'
                  : 'Zero password requirements. Your device tokens stay locally encrypted and public monitoring is completely decoupled.'}
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 hover:border-slate-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">
                {locale === 'ar' ? 'ملخص الـ 30 ثانية الصباحي' : '30-Second Morning Digest'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {locale === 'ar'
                  ? 'احصل على ملخص تنفيذي يجمع أهم الإشارات المرصودة في 3 نقاط محددة تغنيك عن تصفح فيسبوك وإنستغرام.'
                  : 'AI analyzes all overnight alerts to produce a concise 3-bullet morning briefing with immediate next actions.'}
              </p>
            </div>
          </div>
        </section>

        {/* How it Works Section */}
        <section id="how-it-works" className="scroll-mt-20 p-6 sm:p-8 rounded-3xl bg-slate-900/50 border border-slate-800 space-y-8">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-xl sm:text-2xl font-black text-slate-100">
              {locale === 'ar' ? 'كيف تبدأ في 3 خطوات بسيطة؟' : 'Get Started in 3 Simple Steps'}
            </h2>
            <p className="text-xs text-slate-400">
              {locale === 'ar' ? 'لا يتطلب أي إعداد تقني معقد' : 'No technical setup required'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-xs font-black">
                1
              </div>
              <h4 className="text-sm font-bold text-slate-100">
                {locale === 'ar' ? 'الصق رابط الصفحة' : 'Paste Page URL'}
              </h4>
              <p className="text-xs text-slate-400">
                {locale === 'ar' 
                  ? 'ضع رابط أي صفحة فيسبوك أو حساب إنستغرام أو استخدم زر المشاركة من هاتفك مباشرة.'
                  : 'Paste any Facebook page or Instagram profile link, or tap Share directly from the native app.'}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-xs font-black">
                2
              </div>
              <h4 className="text-sm font-bold text-slate-100">
                {locale === 'ar' ? 'اكتب شروط التنبيه' : 'Set Your Criteria'}
              </h4>
              <p className="text-xs text-slate-400">
                {locale === 'ar' 
                  ? 'حدد ما تبحث عنه بالكلمات البسيطة أو اختر من الاقتراحات الذكية التي يوفرها الرادار.'
                  : 'Describe what triggers an alert in natural language or pick from AI tailored suggestions.'}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-xs font-black">
                3
              </div>
              <h4 className="text-sm font-bold text-slate-100">
                {locale === 'ar' ? 'استلم التنبيهات المؤكدة' : 'Receive Verified Alerts'}
              </h4>
              <p className="text-xs text-slate-400">
                {locale === 'ar' 
                  ? 'استمتع بتنبيهات حصرية مع الشرح الكامل لسبب المطابقة وروابط الانتقال المباشر للمنشور.'
                  : 'Get clean push notifications and full context breakdown the moment a match publishes.'}
              </p>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="scroll-mt-20 space-y-8">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-xl sm:text-3xl font-black text-slate-100">
              {locale === 'ar' ? 'خطط مرنة تناسب الجميع' : 'Simple, Transparent Pricing'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {locale === 'ar' ? 'ابدأ مجاناً وقم بالترقية عند الحاجة لمراقبة أكبر' : 'Start free, upgrade as your watchlist expands'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            
            {/* Free Tier */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase">Starter</div>
                <div className="text-2xl font-black text-slate-100">{locale === 'ar' ? 'مجاناً' : 'Free'}</div>
                <p className="text-xs text-slate-400">
                  {locale === 'ar' ? 'لتجربة الرادار ومراقبة الصفحات الأساسية' : 'Ideal for casual watchers'}
                </p>
                <div className="pt-3 space-y-2 text-xs text-slate-300">
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> 3 {locale === 'ar' ? 'صفحات مراقبة' : 'Watched sources'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> 5 {locale === 'ar' ? 'قواعد ذكية' : 'Watch rules'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> {locale === 'ar' ? 'فحص كل 30 دقيقة' : '30-min scan interval'}</div>
                </div>
              </div>
              <button
                onClick={() => setCurrentScreen('radar')}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                {locale === 'ar' ? 'ابدأ مجاناً' : 'Start Free'}
              </button>
            </div>

            {/* Pro Tier (Highlighted) */}
            <div className="p-6 rounded-2xl bg-gradient-to-b from-cyan-950/50 to-slate-900 border-2 border-cyan-500 space-y-4 flex flex-col justify-between relative shadow-xl shadow-cyan-500/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black uppercase">
                {locale === 'ar' ? 'الأكثر طلباً' : 'Popular'}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-bold text-cyan-400 uppercase">Pro Radar</div>
                <div className="text-2xl font-black text-slate-100">$9.99 <span className="text-xs font-normal text-slate-400">{locale === 'ar' ? '/ شهرياً' : '/ mo'}</span></div>
                <p className="text-xs text-slate-400">
                  {locale === 'ar' ? 'للمتسوقين والمستثمرين والمتابعين النشطين' : 'For power watchers & deal hunters'}
                </p>
                <div className="pt-3 space-y-2 text-xs text-slate-300">
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> 20 {locale === 'ar' ? 'صفحة مراقبة' : 'Watched sources'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> {locale === 'ar' ? 'قواعد ذكاء اصطناعي غير محدودة' : 'Unlimited AI rules'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> {locale === 'ar' ? 'فحص فوري كل دقيقة' : '1-minute fast scan'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> {locale === 'ar' ? 'ملخص صباحي ذكي' : '30-second AI Digest'}</div>
                </div>
              </div>
              <button
                onClick={() => setCurrentScreen('radar')}
                className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
              >
                {locale === 'ar' ? 'ترقية للـ Pro' : 'Upgrade to Pro'}
              </button>
            </div>

            {/* Business Tier */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase">Business</div>
                <div className="text-2xl font-black text-slate-100">$29.99 <span className="text-xs font-normal text-slate-400">{locale === 'ar' ? '/ شهرياً' : '/ mo'}</span></div>
                <p className="text-xs text-slate-400">
                  {locale === 'ar' ? 'للشركات ومراقبة المنافسين المتقدمة' : 'For businesses & competitor intel'}
                </p>
                <div className="pt-3 space-y-2 text-xs text-slate-300">
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> 100+ {locale === 'ar' ? 'صفحة ومجموعة' : 'Sources & groups'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> {locale === 'ar' ? 'واجهة Webhook و API' : 'Webhooks & API export'}</div>
                  <div className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-cyan-400" /> {locale === 'ar' ? 'دعم فني مخصص' : 'Priority support'}</div>
                </div>
              </div>
              <button
                onClick={() => setCurrentScreen('radar')}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                {locale === 'ar' ? 'تواصل معنا' : 'Contact Sales'}
              </button>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="scroll-mt-20 space-y-6 max-w-2xl mx-auto">
          <div className="text-center space-y-1">
            <h2 className="text-xl sm:text-2xl font-black text-slate-100">
              {locale === 'ar' ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}
            </h2>
            <p className="text-xs text-slate-400">
              {locale === 'ar' ? 'إجابات واضحة ومباشرة حول الأمان وآليات العمل' : 'Clear answers about security and radar features'}
            </p>
          </div>

          <div className="space-y-2.5">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 cursor-pointer transition-colors hover:border-slate-700"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                  <span>{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </div>
                {openFaq === i && (
                  <p className="mt-2.5 text-xs text-slate-400 leading-relaxed border-t border-slate-800/80 pt-2.5">
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA Banner */}
        <section className="p-8 sm:p-12 rounded-3xl bg-gradient-to-r from-cyan-950 via-slate-900 to-blue-950 border border-cyan-500/30 text-center space-y-4 shadow-2xl">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-100">
            {locale === 'ar' ? 'جاهز لتجربة الرادار الاجتماعي الآن؟' : 'Ready to turn off social media noise?'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto">
            {locale === 'ar'
              ? 'انضم للوحة التحكم وابدأ بمراقبة صفحاتك المفضلة خلال أقل من 30 ثانية مجاناً.'
              : 'Launch the dashboard now and configure your first social radar rule in under 30 seconds.'}
          </p>
          <div className="pt-2">
            <button
              id="btn-footer-launch-dashboard"
              onClick={() => setCurrentScreen('radar')}
              className="px-8 py-3.5 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-black shadow-xl shadow-cyan-500/25 transition-all hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center gap-2"
            >
              <span>{locale === 'ar' ? 'الدخول إلى لوحة التحكم' : 'Launch Dashboard Now'}</span>
              {locale === 'ar' ? <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> : <ArrowRight className="w-4 h-4 stroke-[2.5]" />}
            </button>
          </div>
        </section>
      </main>

      {/* Public Footer */}
      <footer className="w-full border-t border-slate-800/80 bg-slate-950 py-8 px-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-slate-300">{BRAND.name}</span>
            <span>• {BRAND.tagline}</span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <button 
              onClick={() => setCurrentScreen('radar')} 
              className="hover:text-cyan-400 transition-colors cursor-pointer"
            >
              {locale === 'ar' ? 'لوحة التحكم' : 'Dashboard'}
            </button>
            <span className="text-slate-700">|</span>
            <span className="text-slate-400">Express Backend + Gemini AI</span>
            <span className="text-slate-700">|</span>
            <span>{BRAND.appVersion}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
