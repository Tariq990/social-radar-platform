import { AIConnectionResult, AIProvider, AIJsonRequest, AIConfig } from './types';
import { parseJsonText, postJson, stripTrailingSlash } from './http';

function buildGeminiUrl(baseUrl: string, model: string): string {
  const base = stripTrailingSlash(baseUrl);
  const encodedModel = encodeURIComponent(model);
  return `${base}/models/${encodedModel}:generateContent`;
}

export class GeminiNativeProvider implements AIProvider {
  readonly config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async generateJson<T>(request: AIJsonRequest): Promise<T> {
    const response = await postJson(buildGeminiUrl(this.config.baseUrl, this.config.model), {
      headers: {
        // Keep the operator secret in a header rather than query parameters so it is not
        // copied into URLs, access logs, traces, or exception messages.
        'x-goog-api-key': this.config.apiKey
      },
      body: {
        systemInstruction: {
          parts: [{ text: request.system }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: request.prompt }]
          }
        ],
        generationConfig: {
          temperature: request.temperature ?? 0.1,
          responseMimeType: 'application/json'
        }
      }
    });

    const parts = response?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((part: any) => part?.text || '').filter(Boolean).join('\n')
      : '';

    if (!text) {
      throw new Error('Gemini native response did not contain candidate text');
    }
    return parseJsonText<T>(text);
  }

  async testConnection(): Promise<AIConnectionResult> {
    try {
      const result = await this.generateJson<{ ok?: boolean }>({
        system: 'Return only valid JSON.',
        prompt: 'Return exactly {"ok":true}.',
        temperature: 0
      });
      return {
        configured: true,
        reachable: result?.ok === true,
        providerName: this.config.providerName,
        model: this.config.model,
        format: this.config.format,
        error: result?.ok === true ? undefined : 'Provider responded but did not return the expected test payload'
      };
    } catch (error: any) {
      return {
        configured: true,
        reachable: false,
        providerName: this.config.providerName,
        model: this.config.model,
        format: this.config.format,
        error: error?.message || 'Connection test failed'
      };
    }
  }
}
