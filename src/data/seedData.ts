import { Source, WatchRule, AlertMatch, Collection, RadarDigest, UserProfile } from '../types';

export const INITIAL_USER: UserProfile = {
  id: 'user_default',
  email: 'radar.user@mrscrap.app',
  displayName: 'Alex Carter',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  plan: 'pro',
  watchedSourcesCount: 5,
  activeRulesCount: 4,
  deviceSessionConnected: true,
  deviceSessionAccount: 'Alex C. (Personal)',
  deviceSessionLastChecked: '12 min ago',
  preferences: {
    language: 'en',
    theme: 'dark',
    pushEnabled: true,
    digestMode: 'instant'
  }
};

export const INITIAL_COLLECTIONS: Collection[] = [
  { id: 'col_cars', userId: 'user_default', name: 'Cars & Motors', nameAr: 'سيارات ومحركات', icon: 'Car', sourceCount: 1 },
  { id: 'col_restaurants', userId: 'user_default', name: 'Food & Dining', nameAr: 'مطاعم وأغذية', icon: 'Utensils', sourceCount: 1 },
  { id: 'col_competitors', userId: 'user_default', name: 'Competitors', nameAr: 'المنافسون', icon: 'Target', sourceCount: 1 },
  { id: 'col_jobs', userId: 'user_default', name: 'Jobs & Hiring', nameAr: 'وظائف وتوظيف', icon: 'Briefcase', sourceCount: 1 },
  { id: 'col_deals', userId: 'user_default', name: 'Electronics & Deals', nameAr: 'إلكترونيات وعروض', icon: 'Zap', sourceCount: 1 }
];

export const INITIAL_SOURCES: Source[] = [
  {
    id: 'src_bmw',
    userId: 'user_default',
    platform: 'facebook',
    externalId: 'bmw.jordan.official',
    url: 'https://facebook.com/bmw.jordan.official',
    displayName: 'BMW Motors Official',
    handle: '@bmw.jordan',
    avatarUrl: 'https://images.unsplash.com/photo-1555353540-64580b51c258?w=150&auto=format&fit=crop&q=80',
    bio: 'Official representative for BMW vehicles, approved pre-owned programs and certified service.',
    visibilityType: 'public',
    connectorType: 'public_cloud',
    connectorStatus: 'connected',
    activeRulesCount: 1,
    lastCheckedAt: '5 min ago',
    lastMatchedAt: '18 min ago',
    collectionId: 'col_cars',
    isPaused: false,
    recentPostsCount: 14
  },
  {
    id: 'src_firefly',
    userId: 'user_default',
    platform: 'instagram',
    externalId: 'fireflyburger',
    url: 'https://instagram.com/fireflyburger',
    displayName: 'Firefly Gourmet Burgers',
    handle: '@fireflyburger',
    avatarUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=150&auto=format&fit=crop&q=80',
    bio: 'Pioneering handcrafted smash burgers, signature cheeses and weekly flash promotions.',
    visibilityType: 'public',
    connectorType: 'public_cloud',
    connectorStatus: 'connected',
    activeRulesCount: 1,
    lastCheckedAt: '12 min ago',
    lastMatchedAt: '42 min ago',
    collectionId: 'col_restaurants',
    isPaused: false,
    recentPostsCount: 22
  },
  {
    id: 'src_zendesk',
    userId: 'user_default',
    platform: 'facebook',
    externalId: 'zendesk.cx',
    url: 'https://facebook.com/zendesk.cx',
    displayName: 'Zendesk AI Solutions',
    handle: '@zendesk',
    avatarUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=150&auto=format&fit=crop&q=80',
    bio: 'Customer service software and AI-powered service suites for enterprises and startups.',
    visibilityType: 'public',
    connectorType: 'public_cloud',
    connectorStatus: 'connected',
    activeRulesCount: 1,
    lastCheckedAt: '25 min ago',
    lastMatchedAt: '2 hours ago',
    collectionId: 'col_competitors',
    isPaused: false,
    recentPostsCount: 9
  },
  {
    id: 'src_techjobs',
    userId: 'user_default',
    platform: 'facebook',
    externalId: 'techcareers.me',
    url: 'https://facebook.com/techcareers.me',
    displayName: 'Tech Careers Middle East',
    handle: '@techcareers.me',
    avatarUrl: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=150&auto=format&fit=crop&q=80',
    bio: 'Curated developer, AI engineer, and executive tech jobs across Jordan, UAE, and remote.',
    visibilityType: 'authenticated',
    connectorType: 'device_session',
    connectorStatus: 'authenticated_monitoring',
    activeRulesCount: 1,
    lastCheckedAt: '1 hour ago',
    lastMatchedAt: '4 hours ago',
    collectionId: 'col_jobs',
    isPaused: false,
    recentPostsCount: 31
  },
  {
    id: 'src_electromax',
    userId: 'user_default',
    platform: 'instagram',
    externalId: 'electromax.outlet',
    url: 'https://instagram.com/electromax.outlet',
    displayName: 'ElectroMax Tech Outlet',
    handle: '@electromax.outlet',
    avatarUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=150&auto=format&fit=crop&q=80',
    bio: 'Authorized smart gadgets, laptops, screens, and gaming gear. Fast delivery & warranties.',
    visibilityType: 'public',
    connectorType: 'public_cloud',
    connectorStatus: 'connected',
    activeRulesCount: 0,
    lastCheckedAt: '2 hours ago',
    collectionId: 'col_deals',
    isPaused: false,
    recentPostsCount: 18
  }
];

export const INITIAL_RULES: WatchRule[] = [
  {
    id: 'rule_bmw_price',
    userId: 'user_default',
    name: 'BMW under $20,000 / Certified Offers',
    naturalLanguage: 'Tell me whenever they post any BMW vehicle under $20,000 or approved certified warranty deals.',
    sourceIds: ['src_bmw'],
    collectionId: 'col_cars',
    includeTerms: ['BMW', 'Price', '$', 'Warranty', 'Offer'],
    excludeTerms: ['Spare parts only', 'Rental'],
    minConfidence: 0.85,
    alertMode: 'instant',
    enabled: true,
    createdAt: '2026-09-01T10:00:00Z',
    lastMatchAt: '18 min ago'
  },
  {
    id: 'rule_discounts_25',
    userId: 'user_default',
    name: 'Discounts over 25%',
    naturalLanguage: 'Notify me when they announce meal deals or discounts exceeding 25% or buy-one-get-one offers.',
    sourceIds: ['src_firefly'],
    collectionId: 'col_restaurants',
    includeTerms: ['%', 'Discount', 'Offer', 'Free', 'Deal'],
    minConfidence: 0.80,
    alertMode: 'instant',
    enabled: true,
    createdAt: '2026-09-02T14:30:00Z',
    lastMatchAt: '42 min ago'
  },
  {
    id: 'rule_competitor_launch',
    userId: 'user_default',
    name: 'AI Product Launches & Pricing',
    naturalLanguage: 'Alert me when a competitor announces a new AI agent, receptionist, or pricing changes.',
    sourceIds: ['src_zendesk'],
    collectionId: 'col_competitors',
    includeTerms: ['AI', 'Launch', 'New', 'Agent', 'Pricing'],
    minConfidence: 0.88,
    alertMode: 'instant',
    enabled: true,
    createdAt: '2026-09-03T09:15:00Z',
    lastMatchAt: '2 hours ago'
  },
  {
    id: 'rule_tech_jobs',
    userId: 'user_default',
    name: 'Senior Frontend & AI Vacancies',
    naturalLanguage: 'Notify me exclusively about Senior React, TypeScript, or AI Engineering job openings.',
    sourceIds: ['src_techjobs'],
    collectionId: 'col_jobs',
    includeTerms: ['Senior', 'React', 'TypeScript', 'AI Engineer', 'Remote'],
    minConfidence: 0.85,
    alertMode: 'digest',
    enabled: true,
    createdAt: '2026-09-04T16:00:00Z',
    lastMatchAt: '4 hours ago'
  }
];

export const INITIAL_MATCHES: AlertMatch[] = [
  {
    id: 'match_bmw_1',
    userId: 'user_default',
    postId: 'post_bmw_101',
    ruleId: 'rule_bmw_price',
    ruleName: 'BMW under $20,000 / Certified Offers',
    sourceId: 'src_bmw',
    sourceName: 'BMW Motors Official',
    sourceAvatar: 'https://images.unsplash.com/photo-1555353540-64580b51c258?w=150&auto=format&fit=crop&q=80',
    sourcePlatform: 'facebook',
    post: {
      id: 'post_bmw_101',
      sourceId: 'src_bmw',
      platform: 'facebook',
      originalUrl: 'https://facebook.com/bmw.jordan.official/posts/992817263',
      authorName: 'BMW Motors Official',
      authorAvatar: 'https://images.unsplash.com/photo-1555353540-64580b51c258?w=150&auto=format&fit=crop&q=80',
      text: 'Special Arrival: Certified Pre-Owned BMW 320i (2021) in Glacier Silver. Full service history, 38,000 km, pristine condition with 2-year warranty included. Direct special price: $18,900 for this week only!',
      media: [
        {
          type: 'image',
          url: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&auto=format&fit=crop&q=80'
        }
      ],
      publishedAt: '22 min ago',
      detectedAt: '18 min ago',
      fingerprint: 'fp_bmw_320i_18900',
      metadata: { likes: 142, shares: 18 }
    },
    confidence: 0.96,
    category: 'Price Target',
    reason: 'Matched because the vehicle is an authentic BMW listed at $18,900, which is below your $20,000 threshold and includes a certified warranty.',
    extracted: {
      model: 'BMW 320i (2021)',
      price: '$18,900',
      threshold: '$20,000',
      warranty: '2 years included'
    },
    feedback: 'relevant',
    isRead: false,
    isSaved: true,
    createdAt: '18 min ago'
  },
  {
    id: 'match_firefly_1',
    userId: 'user_default',
    postId: 'post_ff_204',
    ruleId: 'rule_discounts_25',
    ruleName: 'Discounts over 25%',
    sourceId: 'src_firefly',
    sourceName: 'Firefly Gourmet Burgers',
    sourceAvatar: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=150&auto=format&fit=crop&q=80',
    sourcePlatform: 'instagram',
    post: {
      id: 'post_ff_204',
      sourceId: 'src_firefly',
      platform: 'instagram',
      originalUrl: 'https://instagram.com/p/DF2918x12',
      authorName: 'Firefly Gourmet Burgers',
      authorAvatar: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=150&auto=format&fit=crop&q=80',
      text: 'Weekend Feast Alert! Enjoy 30% OFF all signature burgers and family boxes when ordering through our mobile app until Sunday midnight. Use voucher code FIRE30 at checkout.',
      media: [
        {
          type: 'image',
          url: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=800&auto=format&fit=crop&q=80'
        }
      ],
      publishedAt: '48 min ago',
      detectedAt: '42 min ago',
      fingerprint: 'fp_firefly_30_discount',
      metadata: { likes: 389, comments: 45 }
    },
    confidence: 0.94,
    category: 'Deals & Discounts',
    reason: 'Matched because the post advertises a 30% discount on family boxes and burgers, exceeding your 25% minimum rule.',
    extracted: {
      discount_percent: 30,
      code: 'FIRE30',
      expires_at: 'Sunday midnight'
    },
    feedback: 'unrated',
    isRead: false,
    isSaved: false,
    createdAt: '42 min ago'
  },
  {
    id: 'match_zendesk_1',
    userId: 'user_default',
    postId: 'post_zen_303',
    ruleId: 'rule_competitor_launch',
    ruleName: 'AI Product Launches & Pricing',
    sourceId: 'src_zendesk',
    sourceName: 'Zendesk AI Solutions',
    sourceAvatar: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=150&auto=format&fit=crop&q=80',
    sourcePlatform: 'facebook',
    post: {
      id: 'post_zen_303',
      sourceId: 'src_zendesk',
      platform: 'facebook',
      originalUrl: 'https://facebook.com/zendesk.cx/posts/44910281',
      authorName: 'Zendesk AI Solutions',
      authorAvatar: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=150&auto=format&fit=crop&q=80',
      text: 'Today we are thrilled to roll out our Autonomous AI Receptionist 2.0. Capable of resolving 82% of multi-tier inquiries with zero human intervention. New tier pricing starts at $49/agent.',
      media: [
        {
          type: 'image',
          url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=800&auto=format&fit=crop&q=80'
        }
      ],
      publishedAt: '2.5 hours ago',
      detectedAt: '2 hours ago',
      fingerprint: 'fp_zendesk_ai_receptionist_v2',
      metadata: { likes: 620, shares: 89 }
    },
    confidence: 0.92,
    category: 'Competitor Intelligence',
    reason: 'Matched because competitor announced a major new AI Receptionist product launch and specific tiered pricing updates.',
    extracted: {
      product: 'Autonomous AI Receptionist 2.0',
      pricing: 'Starts at $49/agent',
      claim: '82% autonomous resolution'
    },
    feedback: 'relevant',
    isRead: true,
    isSaved: true,
    createdAt: '2 hours ago'
  }
];

export const INITIAL_DIGEST: RadarDigest = {
  id: 'digest_today',
  scannedCount: 128,
  matchedCount: 3,
  sourcesMonitored: 5,
  summary: 'BMW Motors posted 2 new vehicles; one matched your $20,000 threshold ($18,900). Firefly Burgers announced a 30% weekend flash voucher exceeding your 25% discount rule. Zendesk announced an Autonomous AI Receptionist 2.0.',
  summaryAr: 'نشرت بي إم دبليو سيارتين؛ تطابقت إحداهما مع حد السعر (18,900$). أعلن فايرفلاي برجر عن خصم 30% متجاوزاً شرطك البالغ 25%. وأعلنت زن ديسك عن إطلاق موظف استقبال ذكي جديد بنسخة 2.0.',
  highlights: [
    'BMW 320i (2021) available at $18,900 with 2-year warranty.',
    'Firefly Burgers weekend voucher FIRE30 gives 30% off meals.',
    'Competitor Zendesk launched AI Receptionist 2.0 at $49/agent.'
  ],
  highlightsAr: [
    'بي إم دبليو 320i موديل 2021 بسعر 18,900$ مع كفالة سنتين.',
    'كود خصم فايرفلاي FIRE30 يمنح 30% على الوجبات حتى نهاية الأسبوع.',
    'المنافس زن ديسك أطلق موظف الاستقبال الذكي 2.0 بسعر 49$/وكيل.'
  ],
  generatedAt: 'Today at 6:00 PM'
};
