import crypto from 'crypto';
import { promisify } from 'util';
import type { Request, Response, NextFunction } from 'express';
import pg from 'pg';
import { revokeUserDevices } from './deviceAuth';
import { postgresSsl } from '../db/pgSsl';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE = 'mrscrap_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AppUser {
  id: string;
  email: string;
  name: string;
  tier: string;
}

interface SessionIdentity {
  user: AppUser;
  sessionId: string;
}

interface DevUser extends AppUser {
  passwordHash: string;
}

let pool: pg.Pool | null = null;
const devUsers = new Map<string, DevUser>();
const devSessions = new Map<string, { sessionId: string; userId: string; expiresAt: number }>();

function appMode(): string {
  return (process.env.APP_MODE || 'production').trim().toLowerCase();
}

function getPool(): pg.Pool {
  if (pool) return pool;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) throw new Error('Application authentication requires DATABASE_URL in production.');
  pool = new Pool({
    connectionString: dbUrl,
    ssl: postgresSsl(dbUrl)
  });
  return pool;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 320) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function normalizeName(value: unknown, email: string): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (raw) return raw.slice(0, 120);
  return email.split('@')[0].slice(0, 120) || 'Radar User';
}

function validatePassword(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Password is required');
  if (value.length < 10) throw new Error('Password must be at least 10 characters');
  if (value.length > 200) throw new Error('Password is too long');
  return value;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algorithm, saltEncoded, hashEncoded] = stored.split('$');
    if (algorithm !== 'scrypt' || !saltEncoded || !hashEncoded) return false;
    const salt = Buffer.from(saltEncoded, 'base64url');
    const expected = Buffer.from(hashEncoded, 'base64url');
    const actual = await scryptAsync(password, salt, expected.length) as Buffer;
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sessionTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const item of raw.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookieAttributes(maxAgeSeconds: number): string {
  const secure = appMode() === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(SESSION_TTL_SECONDS)}`);
}

function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

async function createSession(user: AppUser): Promise<{ token: string; sessionId: string }> {
  const token = newSessionToken();
  const tokenHash = sessionTokenHash(token);
  const sessionId = `sess_${crypto.randomUUID()}`;
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    devSessions.set(tokenHash, { sessionId, userId: user.id, expiresAt });
    return { token, sessionId };
  }

  await getPool().query(
    `INSERT INTO app_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), NOW(), NOW())`,
    [sessionId, user.id, tokenHash, expiresAt]
  );
  return { token, sessionId };
}

async function revokeSessionToken(rawToken: string | null): Promise<string | null> {
  if (!rawToken) return null;
  const hash = sessionTokenHash(rawToken);

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    const session = devSessions.get(hash);
    devSessions.delete(hash);
    return session?.userId || null;
  }

  const result = await getPool().query(
    `DELETE FROM app_sessions WHERE token_hash = $1 RETURNING user_id`,
    [hash]
  );
  return result.rows[0]?.user_id || null;
}

export async function registerAppUser(emailInput: unknown, passwordInput: unknown, nameInput: unknown): Promise<AppUser> {
  const email = normalizeEmail(emailInput);
  if (!email) throw new Error('A valid email address is required');
  const password = validatePassword(passwordInput);
  const name = normalizeName(nameInput, email);
  const passwordHash = await hashPassword(password);
  const id = `usr_${crypto.randomUUID()}`;

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    if (devUsers.has(email)) throw new Error('An account with this email already exists');
    const user: DevUser = { id, email, name, tier: 'free', passwordHash };
    devUsers.set(email, user);
    return { id, email, name, tier: user.tier };
  }

  try {
    const result = await getPool().query(
      `INSERT INTO users (id, email, name, tier, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, 'free', $4, NOW(), NOW())
       RETURNING id, email, name, tier`,
      [id, email, name, passwordHash]
    );
    return result.rows[0];
  } catch (error: any) {
    if (error?.code === '23505') throw new Error('An account with this email already exists');
    throw error;
  }
}

export async function loginAppUser(emailInput: unknown, passwordInput: unknown): Promise<AppUser> {
  const email = normalizeEmail(emailInput);
  if (!email || typeof passwordInput !== 'string') throw new Error('Invalid email or password');

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    const user = devUsers.get(email);
    if (!user || !(await verifyPassword(passwordInput, user.passwordHash))) throw new Error('Invalid email or password');
    return { id: user.id, email: user.email, name: user.name, tier: user.tier };
  }

  const result = await getPool().query(
    `SELECT id, email, name, tier, password_hash FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [email]
  );
  const row = result.rows[0];
  if (!row?.password_hash || !(await verifyPassword(passwordInput, row.password_hash))) {
    throw new Error('Invalid email or password');
  }
  return { id: row.id, email: row.email, name: row.name || 'Radar User', tier: row.tier || 'free' };
}

export async function establishAppSession(res: Response, user: AppUser): Promise<void> {
  const { token } = await createSession(user);
  setSessionCookie(res, token);
}

export async function authenticateAppRequest(req: Request): Promise<SessionIdentity | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length < 24 || token.length > 512) return null;
  const hash = sessionTokenHash(token);

  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    const session = devSessions.get(hash);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) devSessions.delete(hash);
      return null;
    }
    const user = [...devUsers.values()].find(candidate => candidate.id === session.userId);
    if (!user) return null;
    return {
      sessionId: session.sessionId,
      user: { id: user.id, email: user.email, name: user.name, tier: user.tier }
    };
  }

  const result = await getPool().query(
    `SELECT s.id AS session_id, u.id, u.email, u.name, u.tier
       FROM app_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND s.revoked_at IS NULL
      LIMIT 1`,
    [hash]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Authentication is read-heavy. Persist activity at most once per five minutes instead of
  // turning every UI/API request into an otherwise useless PostgreSQL write.
  await getPool().query(
    `UPDATE app_sessions SET last_seen_at = NOW()
      WHERE id = $1 AND last_seen_at < NOW() - INTERVAL '5 minutes'`,
    [row.session_id]
  );
  return {
    sessionId: row.session_id,
    user: { id: row.id, email: row.email, name: row.name || 'Radar User', tier: row.tier || 'free' }
  };
}

export async function requireAppAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await authenticateAppRequest(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required' });
    res.locals.userId = identity.user.id;
    res.locals.appUser = identity.user;
    res.locals.appSessionId = identity.sessionId;
    return next();
  } catch (error: any) {
    return res.status(503).json({ error: error?.message || 'Authentication unavailable' });
  }
}

export async function getCurrentAppUser(req: Request): Promise<AppUser | null> {
  return (await authenticateAppRequest(req))?.user || null;
}

export async function logoutAppUser(req: Request, res: Response, revokeDevices: boolean = true): Promise<void> {
  const userId = await revokeSessionToken(readCookie(req, SESSION_COOKIE));
  clearSessionCookie(res);
  if (revokeDevices && userId) await revokeUserDevices(userId);
}

export async function revokeAllAppSessions(userId: string): Promise<void> {
  if (!userId) return;
  if (appMode() !== 'production' && !process.env.DATABASE_URL?.trim()) {
    for (const [hash, session] of devSessions) {
      if (session.userId === userId) devSessions.delete(hash);
    }
    await revokeUserDevices(userId);
    return;
  }
  await getPool().query('DELETE FROM app_sessions WHERE user_id = $1', [userId]);
  await revokeUserDevices(userId);
}
