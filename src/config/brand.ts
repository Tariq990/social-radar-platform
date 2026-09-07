export const BRAND = {
  name: 'MR SCRAP',
  category: 'Social Radar',
  categoryAr: 'رادار المنصات',
  tagline: 'Watch what matters. Ignore the rest.',
  taglineAr: 'راقب ما يهمك. وتجاهل الباقي.',
  subtext: 'Monitor pages, accounts and updates without living inside social apps.',
  subtextAr: 'راقب الحسابات والصفحات والتحديثات دون الغرق في خلاصة التواصل.',
  corePromise: 'Share once → Watch automatically → Get alerted only when something you care about happens.',
  corePromiseAr: 'شارك الرابط مرة واحدة ← راقب تلقائياً ← احصل على تنبيه فقط عندما يظهر ما يهمك.',
  appVersion: '1.0.0-prod',
  supportEmail: 'support@mrscrap.app'
} as const;

export const PLANS_CONFIG = {
  free: {
    id: 'free',
    name: 'Free',
    nameAr: 'مجاني',
    price: 0,
    sourcesLimit: 5,
    rulesLimit: 5,
    frequency: 'Daily Digest',
    features: [
      '5 monitored sources',
      '5 active natural language rules',
      'Daily AI radar digest',
      'Standard alert push delivery',
      'Public page tracking'
    ],
    featuresAr: [
      'مراقبة حتى 5 مصادر',
      '5 قواعد لغوية ذكية',
      'ملخص رادار ذكي يومي',
      'تنبيهات قياسية',
      'متابعة الصفحات العامة'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    nameAr: 'برو',
    price: 12,
    popular: true,
    sourcesLimit: 50,
    rulesLimit: 999,
    frequency: 'Instant Alerts (~5 min)',
    features: [
      '50 monitored sources',
      'Unlimited AI rules',
      'Instant push notifications',
      '30-second AI summaries',
      'Custom collections & groupings',
      'Authenticated Facebook session support',
      'Advanced numerical & keyword filters'
    ],
    featuresAr: [
      'مراقبة حتى 50 مصدراً',
      'قواعد ذكاء اصطناعي غير محدودة',
      'تنبيهات فورية لحظية',
      'ملخصات AI سريعة في 30 ثانية',
      'مجموعات ومجلدات مخصصة',
      'دعم جلسة فيسبوك موثقة على الجهاز',
      'فلاتر دقيقة للأرقام والأسعار'
    ]
  },
  power: {
    id: 'power',
    name: 'Power',
    nameAr: 'باور للشركات',
    price: 39,
    sourcesLimit: 250,
    rulesLimit: 9999,
    frequency: 'Priority (<2 min)',
    features: [
      '250 monitored sources',
      'Priority background polling',
      'Multi-source global rules',
      'Export alerts to CSV/JSON & Webhooks',
      'Full history & pattern suppression',
      'Priority AI inference quota'
    ],
    featuresAr: [
      'مراقبة حتى 250 مصدراً',
      'فحص بأعلى سرعة وأولوية',
      'قواعد شاملة لعدة مصادر دفعة واحدة',
      'تصدير البيانات وربط الويب هوك',
      'سجل كامل وكتم الإشعارات المتكررة',
      'أعلى أولوية في معالجة الذكاء الاصطناعي'
    ]
  }
} as const;
