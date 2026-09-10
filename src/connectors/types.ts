import { NormalizedPost, SourcePlatform, ConnectorType, ConnectorStatus } from '../types';

export interface SourceInput {
  url: string;
  preferredPlatform?: SourcePlatform;
}

export interface ValidationResult {
  valid: boolean;
  platform: SourcePlatform;
  cleanedUrl: string;
  handleOrId: string;
  isPostUrl: boolean;
  error?: string;
}

export interface ResolvedSource {
  platform: SourcePlatform;
  externalId: string;
  url: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  bio: string;
  visibilityType: 'public' | 'authenticated';
  connectorType: ConnectorType;
  connectorStatus: ConnectorStatus;
  samplePosts: NormalizedPost[];
}

export interface ConnectorHealth {
  status: ConnectorStatus;
  latencyMs: number;
  lastSuccessfulCheck: string;
  errorCount: number;
  message: string;
}

export interface SourceConnector {
  validate(input: SourceInput): Promise<ValidationResult>;
  resolveSource(input: SourceInput): Promise<ResolvedSource>;
  fetchLatest(source: { id: string; url: string; platform: SourcePlatform; externalId: string }): Promise<NormalizedPost[]>;
  healthCheck(source: { id: string; url: string; platform: SourcePlatform }): Promise<ConnectorHealth>;
}
