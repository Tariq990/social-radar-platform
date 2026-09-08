import test from 'node:test';
import assert from 'node:assert/strict';

import { readAIConfig } from '../ai/providerFactory';

const KEYS = ['APP_MODE', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_API_FORMAT', 'AI_PROVIDER_NAME'] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void) {
  const before: Record<string, string | undefined> = {};
  for (const key of KEYS) before[key] = process.env[key];
  try {
    for (const key of KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of KEYS) {
      const value = before[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('accepts a production HTTPS OpenAI-compatible provider', () => {
  withEnv({
    APP_MODE: 'production',
    AI_BASE_URL: 'https://api.example.com/v1/',
    AI_API_KEY: 'secret',
    AI_MODEL: 'example-model',
    AI_API_FORMAT: 'openai_chat',
    AI_PROVIDER_NAME: 'Example'
  }, () => {
    const config = readAIConfig();
    assert.equal(config.baseUrl, 'https://api.example.com/v1');
    assert.equal(config.model, 'example-model');
    assert.equal(config.format, 'openai_chat');
  });
});

test('rejects plaintext remote AI endpoints in production', () => {
  withEnv({
    APP_MODE: 'production',
    AI_BASE_URL: 'http://api.example.com/v1',
    AI_API_KEY: 'secret',
    AI_MODEL: 'example-model',
    AI_API_FORMAT: 'openai_chat'
  }, () => {
    assert.throws(() => readAIConfig(), /HTTPS in production/);
  });
});

test('allows loopback HTTP for local development', () => {
  withEnv({
    APP_MODE: 'development',
    AI_BASE_URL: 'http://localhost:8080/v1',
    AI_API_KEY: 'secret',
    AI_MODEL: 'local-model',
    AI_API_FORMAT: 'openai_responses'
  }, () => {
    const config = readAIConfig();
    assert.equal(config.baseUrl, 'http://localhost:8080/v1');
  });
});

test('rejects unsupported provider formats', () => {
  withEnv({
    APP_MODE: 'production',
    AI_BASE_URL: 'https://api.example.com/v1',
    AI_API_KEY: 'secret',
    AI_MODEL: 'model',
    AI_API_FORMAT: 'made_up_format'
  }, () => {
    assert.throws(() => readAIConfig(), /Unsupported AI_API_FORMAT/);
  });
});
