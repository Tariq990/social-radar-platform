export type AIFormat = 'openai_chat' | 'openai_responses' | 'gemini_native';

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  format: AIFormat;
  providerName: string;
}

export interface AIConnectionResult {
  configured: boolean;
  reachable: boolean;
  providerName: string;
  model: string;
  format: AIFormat;
  error?: string;
}

export interface AIJsonRequest {
  system: string;
  prompt: string;
  temperature?: number;
}

export interface RuleMatchResult {
  matched: boolean;
  confidence: number;
  category: string;
  reason: string;
  extracted: Record<string, unknown>;
}

export interface DigestResult {
  summary: string;
  highlights: string[];
  topAction: string;
}

export interface RuleSuggestionInput {
  sourceName?: string;
  platform?: string;
  bio?: string;
}

export interface PreviewMatchResult {
  headline: string;
  excerpt: string;
  whyMatched: string;
  category: string;
}

export interface AIProvider {
  readonly config: AIConfig;
  testConnection(): Promise<AIConnectionResult>;
  generateJson<T>(request: AIJsonRequest): Promise<T>;
}

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIConfigurationError';
  }
}

export class AIProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options?: { status?: number; retryable?: boolean }) {
    super(message);
    this.name = 'AIProviderError';
    this.status = options?.status;
    this.retryable = Boolean(options?.retryable);
  }
}
