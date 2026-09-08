import { AIConnectionResult, AIProvider, AIJsonRequest, AIConfig } from './types';
import { parseJsonText, postJson, stripTrailingSlash } from './http';

function extractResponseText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const parts: string[] = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') parts.push(part.text);
      else if (typeof part?.output_text === 'string') parts.push(part.output_text);
    }
  }

  return parts.join('\n');
}

export class OpenAIResponsesProvider implements AIProvider {
  readonly config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async generateJson<T>(request: AIJsonRequest): Promise<T> {
    const base = stripTrailingSlash(this.config.baseUrl);
    const response = await postJson(`${base}/responses`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: {
        model: this.config.model,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: request.system }]
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: request.prompt }]
          }
        ]
      }
    });

    const text = extractResponseText(response);
    if (!text) {
      throw new Error('OpenAI-compatible Responses API returned no output text');
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
