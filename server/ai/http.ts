import { AIProviderError } from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AIProviderError('AI provider response exceeded the 2 MB safety limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AIProviderError('AI provider response exceeded the 2 MB safety limit');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}

export async function postJson(
  url: string,
  options: {
    headers?: Record<string, string>;
    body: unknown;
    timeoutMs?: number;
  }
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(options.body),
      signal: controller.signal
    });

    const raw = await readBoundedText(response);
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const message =
        parsed?.error?.message ||
        parsed?.message ||
        raw?.slice(0, 500) ||
        `AI provider returned HTTP ${response.status}`;

      throw new AIProviderError(message, {
        status: response.status,
        retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
      });
    }

    return parsed ?? raw;
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new AIProviderError('AI provider request timed out', { retryable: true });
    }
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError(error?.message || 'AI provider request failed', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function parseJsonText<T>(rawText: string): T {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!cleaned) {
    throw new AIProviderError('AI provider returned an empty response');
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1)) as T;
      } catch {
        // Fall through to final error below.
      }
    }
    throw new AIProviderError('AI provider returned invalid JSON');
  }
}
