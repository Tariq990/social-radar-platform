import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate test port'));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for test server');
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie') || '';
  const cookie = raw.split(';')[0];
  assert.match(cookie, /^mrscrap_session=/);
  return cookie;
}

async function jsonRequest(baseUrl: string, path: string, options: {
  method?: string;
  cookie?: string;
  bearer?: string;
  body?: unknown;
} = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

test('application CRUD and device ingestion are tenant isolated', { timeout: 40_000 }, async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_MODE: 'demo',
      PORT: String(port),
      DATABASE_URL: '',
      AI_BASE_URL: '',
      AI_API_KEY: '',
      AI_MODEL: '',
      AI_API_FORMAT: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout?.on('data', chunk => { logs += String(chunk); });
  child.stderr?.on('data', chunk => { logs += String(chunk); });

  try {
    await waitForHealth(baseUrl, child);

    const suffix = crypto.randomUUID();
    const password = 'tenant-test-password-123';

    const regA = await jsonRequest(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { email: `a-${suffix}@example.com`, password, name: 'Tenant A' }
    });
    assert.equal(regA.response.status, 201, logs);
    const cookieA = sessionCookie(regA.response);
    const userA = regA.body.user.id;

    const regB = await jsonRequest(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { email: `b-${suffix}@example.com`, password, name: 'Tenant B' }
    });
    assert.equal(regB.response.status, 201, logs);
    const cookieB = sessionCookie(regB.response);
    const userB = regB.body.user.id;
    assert.notEqual(userA, userB);

    const anonymousSources = await jsonRequest(baseUrl, '/api/sources');
    assert.equal(anonymousSources.response.status, 401);

    const createA = await jsonRequest(baseUrl, '/api/sources', {
      method: 'POST',
      cookie: cookieA,
      body: {
        platform: 'facebook',
        externalId: `tenant-a-${suffix}`,
        url: `https://www.facebook.com/tenant-a-${suffix}`,
        name: 'Tenant A Source',
        connectorType: 'device_session',
        visibilityType: 'authenticated'
      }
    });
    assert.equal(createA.response.status, 201, logs);
    const sourceA = createA.body.id;
    assert.equal(createA.body.user_id, userA);

    const listA = await jsonRequest(baseUrl, '/api/sources', { cookie: cookieA });
    assert.equal(listA.response.status, 200);
    assert.ok(listA.body.some((source: any) => source.id === sourceA));

    const listB = await jsonRequest(baseUrl, '/api/sources', { cookie: cookieB });
    assert.equal(listB.response.status, 200);
    assert.ok(!listB.body.some((source: any) => source.id === sourceA));

    const deleteByB = await jsonRequest(baseUrl, `/api/sources/${encodeURIComponent(sourceA)}`, {
      method: 'DELETE',
      cookie: cookieB
    });
    assert.equal(deleteByB.response.status, 404);

    const pauseByB = await jsonRequest(baseUrl, `/api/sources/${encodeURIComponent(sourceA)}/pause`, {
      method: 'PATCH',
      cookie: cookieB
    });
    assert.equal(pauseByB.response.status, 404);

    const ruleWithForeignSource = await jsonRequest(baseUrl, '/api/rules', {
      method: 'POST',
      cookie: cookieB,
      body: {
        name: 'Invalid cross-tenant rule',
        naturalLanguage: 'Notify me about any update',
        sourceIds: [sourceA]
      }
    });
    assert.equal(ruleWithForeignSource.response.status, 400);

    const deviceB = await jsonRequest(baseUrl, '/api/auth/device/register', {
      method: 'POST',
      cookie: cookieB,
      body: { platform: 'android' }
    });
    assert.equal(deviceB.response.status, 201, logs);
    assert.equal(deviceB.body.userId, userB);

    const foreignIngest = await jsonRequest(baseUrl, '/api/device/ingest', {
      method: 'POST',
      bearer: deviceB.body.token,
      body: { sourceId: sourceA, posts: [], locale: 'en' }
    });
    assert.equal(foreignIngest.response.status, 404);

    const deviceA = await jsonRequest(baseUrl, '/api/auth/device/register', {
      method: 'POST',
      cookie: cookieA,
      body: { platform: 'android' }
    });
    assert.equal(deviceA.response.status, 201, logs);
    assert.equal(deviceA.body.userId, userA);

    const logoutA = await jsonRequest(baseUrl, '/api/auth/logout', {
      method: 'POST',
      cookie: cookieA
    });
    assert.equal(logoutA.response.status, 200);

    const afterLogout = await jsonRequest(baseUrl, '/api/sources', { cookie: cookieA });
    assert.equal(afterLogout.response.status, 401);

    const revokedDevice = await jsonRequest(baseUrl, '/api/device/ingest', {
      method: 'POST',
      bearer: deviceA.body.token,
      body: { sourceId: sourceA, posts: [], locale: 'en' }
    });
    assert.equal(revokedDevice.response.status, 401);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref();
    });
  }
});
