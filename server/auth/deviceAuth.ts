import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import pg from 'pg';

const { Pool } = pg;

type DevicePlatform = 'web' | 'android' | 'ios';

export interface DeviceRegistration {
  userId: string;
  deviceId: string;
  token: string;
  platform: DevicePlatform;
}

export interface DeviceIdentity {
  userId: string;
  deviceId: string;
  platform: DevicePlatform;
}

let authPool: pg.Pool | null = null;
const developmentTokens = new Map<string, DeviceIdentity>();
const CURRENT_SINGLE_USER_ID = 'user_default';

function appMode(): string {
  return (process.env.APP_MODE || 'production').trim().toLowerCase();
}

function normalizePlatform(value: unknown): DevicePlatform {
  return value === 'android' || value === 'ios' ? value : 'web';
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function newOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function getPool(): pg.Pool {
  if (authPool) return authPool;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) throw new Error('Device authentication requires DATABASE_URL in production.');
  authPool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
  });
  return authPool;
}

export async function ensureCurrentBackendIdentity(): Promise<void> {
  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) return;
  const pool = getPool();
  await pool.query(
    `INSERT INTO users (id, email, name, tier, created_at, updated_at)
     VALUES ($1, NULL, 'Radar Operator', 'pro', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [CURRENT_SINGLE_USER_ID]
  );
}

/**
 * Creates an installation bearer token for backend ingestion.
 *
 * The current application data model is still single-user (`user_default`), so device
 * authorization is deliberately bound to that identity until the full multi-user migration
 * lands. This closes unauthenticated device ingestion without pretending tenant isolation is
 * already complete. Facebook login/session state remains completely separate and device-local.
 * Only a SHA-256 digest of this backend bearer token is stored server-side.
 */
export async function registerDevice(rawPlatform: unknown): Promise<DeviceRegistration> {
  const platform = normalizePlatform(rawPlatform);
  const token = newOpaqueToken();
  const hash = tokenHash(token);
  const deviceId = `dev_${crypto.randomUUID()}`;

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    const identity: DeviceIdentity = {
      userId: CURRENT_SINGLE_USER_ID,
      deviceId,
      platform
    };
    developmentTokens.set(hash, identity);
    return { ...identity, token };
  }

  await ensureCurrentBackendIdentity();
  const pool = getPool();
  await pool.query(
    `INSERT INTO devices (id, user_id, device_token, platform, last_active, created_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [deviceId, CURRENT_SINGLE_USER_ID, hash, platform]
  );
  return { userId: CURRENT_SINGLE_USER_ID, deviceId, token, platform };
}

export async function authenticateDeviceToken(rawToken: unknown): Promise<DeviceIdentity | null> {
  if (typeof rawToken !== 'string' || rawToken.length < 24 || rawToken.length > 512) return null;
  const hash = tokenHash(rawToken);

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    return developmentTokens.get(hash) || null;
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT id, user_id, platform
       FROM devices
      WHERE device_token = $1
      LIMIT 1`,
    [hash]
  );
  const row = result.rows[0];
  if (!row) return null;

  await pool.query('UPDATE devices SET last_active = NOW() WHERE id = $1', [row.id]);
  return {
    userId: row.user_id,
    deviceId: row.id,
    platform: normalizePlatform(row.platform)
  };
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function requireDeviceAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await authenticateDeviceToken(bearerToken(req));
    if (!identity) {
      return res.status(401).json({ error: 'Device authorization required' });
    }
    res.locals.userId = identity.userId;
    res.locals.deviceId = identity.deviceId;
    res.locals.devicePlatform = identity.platform;
    return next();
  } catch (error: any) {
    return res.status(503).json({ error: error?.message || 'Device authorization unavailable' });
  }
}
