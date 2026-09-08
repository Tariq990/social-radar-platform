import crypto from 'crypto';
import pg from 'pg';

import type { AndroidReleaseMetadata } from './versionPolicy';

const { Pool } = pg;
const CHANNEL = 'android-alpha' as const;
let pool: pg.Pool | null = null;

export interface AndroidReleaseWithApk extends AndroidReleaseMetadata {
  apk: Buffer;
}

function getPool(): pg.Pool {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required for Android release storage');
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false }
  });
  return pool;
}

function rowToMetadata(row: any): AndroidReleaseMetadata {
  return {
    channel: CHANNEL,
    versionCode: Number(row.version_code),
    versionName: String(row.version_name),
    minSupportedVersionCode: Number(row.min_supported_version_code),
    mandatory: Boolean(row.mandatory),
    sha256: String(row.sha256),
    sizeBytes: Number(row.size_bytes),
    publishedAt: new Date(row.published_at).toISOString()
  };
}

export async function getCurrentAndroidRelease(): Promise<AndroidReleaseMetadata | null> {
  const result = await getPool().query(
    `SELECT channel, version_code, version_name, min_supported_version_code,
            mandatory, sha256, size_bytes, published_at
       FROM app_releases
      WHERE channel = $1`,
    [CHANNEL]
  );
  return result.rows[0] ? rowToMetadata(result.rows[0]) : null;
}

export async function getAndroidReleaseApk(versionCode: number): Promise<AndroidReleaseWithApk | null> {
  const result = await getPool().query(
    `SELECT channel, version_code, version_name, min_supported_version_code,
            mandatory, sha256, size_bytes, published_at, apk
       FROM app_releases
      WHERE channel = $1 AND version_code = $2`,
    [CHANNEL, versionCode]
  );
  if (!result.rows[0]) return null;
  return {
    ...rowToMetadata(result.rows[0]),
    apk: result.rows[0].apk as Buffer
  };
}

export async function publishAndroidRelease(input: {
  versionCode: number;
  versionName: string;
  minSupportedVersionCode: number;
  mandatory: boolean;
  expectedSha256: string;
  releaseNotes?: string;
  apk: Buffer;
}): Promise<AndroidReleaseMetadata> {
  if (!Number.isInteger(input.versionCode) || input.versionCode < 1) throw new Error('Invalid versionCode');
  if (!Number.isInteger(input.minSupportedVersionCode) || input.minSupportedVersionCode < 1) {
    throw new Error('Invalid minSupportedVersionCode');
  }
  if (input.minSupportedVersionCode > input.versionCode) {
    throw new Error('minSupportedVersionCode cannot exceed versionCode');
  }
  if (!input.versionName.trim() || input.versionName.length > 64) throw new Error('Invalid versionName');
  if (input.apk.length < 1024 || input.apk.length > 30 * 1024 * 1024) throw new Error('APK size is outside the accepted range');

  const actualSha256 = crypto.createHash('sha256').update(input.apk).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(input.expectedSha256) || actualSha256 !== input.expectedSha256.toLowerCase()) {
    throw new Error('APK SHA-256 mismatch');
  }

  const result = await getPool().query(
    `INSERT INTO app_releases (
       channel, platform, version_code, version_name, min_supported_version_code,
       mandatory, sha256, size_bytes, release_notes, apk, published_at
     ) VALUES ($1, 'android', $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (channel) DO UPDATE SET
       platform = EXCLUDED.platform,
       version_code = EXCLUDED.version_code,
       version_name = EXCLUDED.version_name,
       min_supported_version_code = EXCLUDED.min_supported_version_code,
       mandatory = EXCLUDED.mandatory,
       sha256 = EXCLUDED.sha256,
       size_bytes = EXCLUDED.size_bytes,
       release_notes = EXCLUDED.release_notes,
       apk = EXCLUDED.apk,
       published_at = NOW()
     RETURNING channel, version_code, version_name, min_supported_version_code,
               mandatory, sha256, size_bytes, published_at`,
    [
      CHANNEL,
      input.versionCode,
      input.versionName.trim(),
      input.minSupportedVersionCode,
      input.mandatory,
      actualSha256,
      input.apk.length,
      input.releaseNotes?.slice(0, 4000) || null,
      input.apk
    ]
  );

  return rowToMetadata(result.rows[0]);
}
