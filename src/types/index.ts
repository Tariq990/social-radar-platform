export type SourcePlatform = 'facebook' | 'instagram' | 'other';

export type ConnectorType = 'public_cloud' | 'official_meta' | 'device_session' | 'mock';

export type ConnectorStatus = 
  | 'connected'
  | 'public_monitoring'
  | 'authenticated_monitoring'
  | 'needs_relogin'
  | 'temporarily_unavailable'
  | 'unsupported';

export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  previewUrl?: string;
}

export interface SocialComment {
  externalCommentId?: string;
  authorName: string;
  authorUrl?: string;
  authorAvatar?: string;
  text: string;
  publishedLabel?: string;
  originalUrl?: string;
  isPublisher: boolean;
  depth: number;
  media: MediaItem[];
}

export interface NormalizedPost {
  id: string;
  sourceId: string;
  platform: SourcePlatform;
  externalPostId?: string;
  originalUrl: string;
  authorName: string;
  authorAvatar?: string;
  text: string;
  media: MediaItem[];
  comments?: SocialComment[];
  commentsTruncated?: boolean;
  videoPresent?: boolean;
  publishedAt: string;
  detectedAt: string;
  fingerprint: string;
  metadata: Record<string, unknown>;
}

export interface Source {
  id: string;
  userId: string;
  platform: SourcePlatform;
  externalId: string;
  url: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  bio?: string;
  visibilityType: 'public' | 'authenticated';
  connectorType: ConnectorType;
  connectorStatus: ConnectorStatus;
  activeRulesCount: number;
  lastCheckedAt: string;
  lastMatchedAt?: string;
  collectionId?: string;
  isPaused: boolean;
  recentPostsCount?: number;
}

export interface WatchRule {
  id: string;
  userId: string;
  name: string;
  naturalLanguage: string;
  sourceIds: string[]; // Supports multiple sources
  collectionId?: string; // Or applied to an entire collection
  includeTerms?: string[];
  excludeTerms?: string[];
  categories?: string[];
  minConfidence: number; // e.g. 0.75
  alertMode: 'instant' | 'digest';
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
  };
  enabled: boolean;
  createdAt: string;
  lastMatchAt?: string;
}

export interface AlertMatch {
  id: string;
  userId: string;
  postId: string;
  ruleId: string;
  ruleName: string;
  sourceId: string;
  sourceName: string;
  sourceAvatar: string;
  sourcePlatform: SourcePlatform;
  post: NormalizedPost;
  confidence: number;
  category: string;
  reason: string;
  extracted?: Record<string, any>;
  feedback: 'relevant' | 'not_relevant' | 'unrated';
  isRead: boolean;
  isSaved: boolean;
  createdAt: string;
}

export interface Collection {
  id: string;
  userId: string;
  name: string;
  nameAr?: string;
  icon: string;
  sourceCount: number;
}

export interface AIClassificationResult {
  matched: boolean;
  confidence: number;
  category: string;
  reason: string;
  extracted?: {
    discount_percent?: number;
    price?: number;
    currency?: string;
    item?: string;
    expires_at?: string | null;
    [key: string]: any;
  };
}

export interface RadarDigest {
  id: string;
  scannedCount: number;
  matchedCount: number;
  sourcesMonitored: number;
  summary: string;
  summaryAr?: string;
  highlights: string[];
  highlightsAr?: string[];
  generatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  plan: 'free' | 'pro' | 'power';
  watchedSourcesCount: number;
  activeRulesCount: number;
  deviceSessionConnected: boolean;
  deviceSessionAccount?: string;
  deviceSessionLastChecked?: string;
  preferences: {
    language: 'en' | 'ar';
    theme: 'dark' | 'light';
    pushEnabled: boolean;
    digestMode: 'daily' | 'instant';
  };
}
