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

/**
 * Creates a frictionless installation identity. This is application authentication only;
 * it is completely separate from the Facebook WebView session used for source collection.
 * Only a SHA-256 digest of the bearer token is stored server-side.
 */
export async function registerDevice(rawPlatform: unknown): Promise<DeviceRegistration> {
  const platform = normalizePlatform(rawPlatform);
  const token = newOpaqueToken();
  const hash = tokenHash(token);

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    const identity: DeviceIdentity = {
      userId: 'user_default',
      deviceId: `dev_${crypto.randomUUID()}`,
      platform
    };
    developmentTokens.set(hash, identity);
    return { ...identity, token };
  }

  const pool = getPool();
  const client = await pool.connect();
  const userId = `user_${crypto.randomUUID()}`;
  const deviceId = `dev_${crypto.randomUUID()}`;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, tier, created_at, updated_at)
       VALUES ($1, 'free', NOW(), NOW())`,
      [userId]
    );
    await client.query(
      `INSERT INTO devices (id, user_id, device_token, platform, last_active, created_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [deviceId, userId, hash, platform]
    );
    await client.query('COMMIT');
    return { userId, deviceId, token, platform };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
