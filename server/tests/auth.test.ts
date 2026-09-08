import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  authenticateAppRequest,
  establishAppSession,
  loginAppUser,
  logoutAppUser,
  registerAppUser
} from '../auth/appAuth';
import {
  authenticateDeviceToken,
  registerDevice,
  revokeUserDevices
} from '../auth/deviceAuth';

function useDevelopmentAuth() {
  process.env.APP_MODE = 'demo';
  delete process.env.DATABASE_URL;
}

function fakeResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
    }
  };
}

function cookieRequest(setCookie: string) {
  return {
    headers: {
      cookie: setCookie.split(';')[0]
    }
  };
}

test('application registration/login/session/logout round-trip', async () => {
  useDevelopmentAuth();
  const email = `auth-${crypto.randomUUID()}@example.com`;
  const password = 'correct-horse-battery-staple';

  const registered = await registerAppUser(email, password, 'Tenant A');
  assert.equal(registered.email, email);
  assert.equal(registered.tier, 'free');

  await assert.rejects(() => loginAppUser(email, 'wrong-password-value'), /Invalid email or password/);

  const loggedIn = await loginAppUser(email, password);
  assert.equal(loggedIn.id, registered.id);

  const response = fakeResponse();
  await establishAppSession(response as any, loggedIn);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie?.includes('mrscrap_session='));
  assert.ok(setCookie?.includes('HttpOnly'));

  const request = cookieRequest(setCookie!);
  const identity = await authenticateAppRequest(request as any);
  assert.equal(identity?.user.id, registered.id);

  const logoutResponse = fakeResponse();
  await logoutAppUser(request as any, logoutResponse as any, false);
  assert.equal(await authenticateAppRequest(request as any), null);
});

test('backend device bearer is bound to the authenticated application user and revocable', async () => {
  useDevelopmentAuth();
  const userId = `usr_${crypto.randomUUID()}`;

  const device = await registerDevice('android', userId);
  assert.equal(device.userId, userId);
  assert.equal(device.platform, 'android');
  assert.ok(device.token.length >= 24);

  const identity = await authenticateDeviceToken(device.token);
  assert.equal(identity?.userId, userId);
  assert.equal(identity?.deviceId, device.deviceId);

  await revokeUserDevices(userId);
  assert.equal(await authenticateDeviceToken(device.token), null);
});
