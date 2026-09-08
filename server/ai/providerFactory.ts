import {
  AIConfig,
  AIConfigurationError,
  AIFormat,
  AIProvider,
  AIConnectionResult
} from './types';
import { OpenAIChatProvider } from './openAIChatProvider';
import { OpenAIResponsesProvider } from './openAIResponsesProvider';
import { GeminiNativeProvider } from './geminiNativeProvider';

const SUPPORTED_FORMATS: AIFormat[] = ['openai_chat', 'openai_responses', 'gemini_native'];

let cachedSignature = '';
let cachedProvider: AIProvider | null = null;

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '10.0.2.2';
}

export function readAIConfig(): AIConfig {
  const baseUrl = (process.env.AI_BASE_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || '').trim();
  const formatRaw = (process.env.AI_API_FORMAT || '').trim() as AIFormat;
  const providerName = (process.env.AI_PROVIDER_NAME || 'Configured AI').trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push('AI_BASE_URL');
  if (!apiKey) missing.push('AI_API_KEY');
  if (!model) missing.push('AI_MODEL');
  if (!formatRaw) missing.push('AI_API_FORMAT');

  if (missing.length > 0) {
    throw new AIConfigurationError(`Missing required AI configuration: ${missing.join(', ')}`);
  }

  if (!SUPPORTED_FORMATS.includes(formatRaw)) {
    throw new AIConfigurationError(
      `Unsupported AI_API_FORMAT "${formatRaw}". Expected one of: ${SUPPORTED_FORMATS.join(', ')}`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new AIConfigurationError('AI_BASE_URL must be a valid absolute http(s) URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AIConfigurationError('AI_BASE_URL must use http or https');
  }

  const appMode = (process.env.APP_MODE || 'production').trim().toLowerCase();
  if (appMode === 'production' && parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
    throw new AIConfigurationError('AI_BASE_URL must use HTTPS in production so AI_API_KEY is never sent over plaintext HTTP');
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
    format: formatRaw,
    providerName
  };
}

function signature(config: AIConfig): string {
  return [config.baseUrl, config.model, config.format, config.providerName, config.apiKey].join('|');
}

export function getAIProvider(): AIProvider {
  const config = readAIConfig();
  const nextSignature = signature(config);

  if (cachedProvider && cachedSignature === nextSignature) {
    return cachedProvider;
  }

  switch (config.format) {
    case 'openai_chat':
      cachedProvider = new OpenAIChatProvider(config);
      break;
    case 'openai_responses':
      cachedProvider = new OpenAIResponsesProvider(config);
      break;
    case 'gemini_native':
      cachedProvider = new GeminiNativeProvider(config);
      break;
    default:
      throw new AIConfigurationError(`Unsupported AI format: ${config.format}`);
  }

  cachedSignature = nextSignature;
  return cachedProvider;
}

export function getAIConfigurationStatus(): {
  configured: boolean;
  providerName?: string;
  model?: string;
  format?: AIFormat;
  error?: string;
} {
  try {
    const config = readAIConfig();
    return {
      configured: true,
      providerName: config.providerName,
      model: config.model,
      format: config.format
    };
  } catch (error: any) {
    return {
      configured: false,
      error: error?.message || 'AI configuration is invalid'
    };
  }
}

export async function testConfiguredAIProvider(): Promise<AIConnectionResult> {
  try {
    return await getAIProvider().testConnection();
  } catch (error: any) {
    return {
      configured: false,
      reachable: false,
      providerName: process.env.AI_PROVIDER_NAME || 'Configured AI',
      model: process.env.AI_MODEL || '',
      format: (process.env.AI_API_FORMAT || 'openai_chat') as AIFormat,
      error: error?.message || 'AI configuration is invalid'
    };
  }
}
