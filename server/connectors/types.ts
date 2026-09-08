export type SourcePlatform = 'facebook' | 'instagram' | 'other';
export type ConnectorType = 'public_cloud' | 'device_session' | 'official_meta';
export type ConnectorStatus = 'connected' | 'error' | 'needs_attention' | 'needs_relogin';

export interface SourceInput {
  url: string;
  preferredPlatform?: SourcePlatform;
}

export interface ResolvedSourceResult {
  valid: boolean;
  platform: SourcePlatform;
  externalId: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  url: string;
  bio?: string;
  visibilityType: 'public' | 'authenticated';
  connectorType: ConnectorType;
  connectorStatus: ConnectorStatus;
  requiresAuthentication: boolean;
  error?: string;
}

export interface RawProviderPost {
  id: string;
  externalId?: string;
  url: string;
  authorName?: string;
  authorAvatar?: string;
  text: string;
  media?: { type: 'image' | 'video'; url: string }[];
  publishedAt?: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

export interface ConnectorError {
  code: 'AUTH_REQUIRED' | 'PAGE_NOT_FOUND' | 'TOKEN_MISSING' | 'RATE_LIMIT' | 'SCRAPE_FAILED' | 'UNKNOWN';
  message: string;
  statusCode?: number;
  retryable: boolean;
}

export interface ISourceConnector {
  readonly providerName: string;
  resolveSource(input: SourceInput): Promise<ResolvedSourceResult>;
  fetchLatestPosts(source: { id: string; url: string; platform: SourcePlatform; externalId: string }): Promise<RawProviderPost[]>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string }>;
}
