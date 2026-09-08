export const BRAND = {
  name: 'MR SCRAP',
  category: 'Social Radar',
  categoryAr: 'رادار المنصات',
  tagline: 'Watch what matters. Ignore the rest.',
  taglineAr: 'راقب ما يهمك. وتجاهل الباقي.',
  subtext: 'Monitor Facebook and Instagram sources from your connected Android device session, then search or classify real collected posts with AI.',
  subtextAr: 'راقب مصادر Facebook وInstagram من جلسة جهاز Android المتصلة، ثم ابحث في المنشورات الحقيقية التي تم جمعها أو صنّفها بالذكاء الاصطناعي.',
  corePromise: 'Connect a source → collect real posts → surface only the matches that matter.',
  corePromiseAr: 'اربط مصدرًا ← اجمع منشورات حقيقية ← أظهر فقط التطابقات التي تهمك.',
  appVersion: 'android-alpha',
  supportEmail: 'support@mrscrap.app'
} as const;

/**
 * Billing is intentionally not modelled as purchasable product data in the alpha branch.
 * Keeping fabricated prices, speed promises, push-delivery claims, or unenforced quotas here
 * risks leaking unfinished commercial assumptions into the UI. Reintroduce plan configuration
 * only when backend entitlements and billing are implemented and tested end to end.
 */
export const PLANS_CONFIG = {} as const;
