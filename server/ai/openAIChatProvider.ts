import { AIConnectionResult, AIProvider, AIJsonRequest, AIConfig } from './types';
import { parseJsonText, postJson, stripTrailingSlash } from './http';

export class OpenAIChatProvider implements AIProvider {
  readonly config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async generateJson<T>(request: AIJsonRequest): Promise<T> {
    const base = stripTrailingSlash(this.config.baseUrl);
    const response = await postJson(`${base}/chat/completions`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: {
        model: this.config.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt }
        ],
        temperature: request.temperature ?? 0.1
      }
    });

    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return parseJsonText<T>(content);
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part: any) => part?.text || part?.content || '')
        .filter(Boolean)
        .join('\n');
      return parseJsonText<T>(text);
    }

    throw new Error('OpenAI-compatible chat response did not contain message content');
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
