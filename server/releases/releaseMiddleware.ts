import type { NextFunction, Request, Response } from 'express';

import { verifyGitHubReleasePublisher } from './githubOidc';
import { getAndroidReleaseApk, getCurrentAndroidRelease, publishAndroidRelease } from './releaseStore';
import { buildAndroidUpdateDecision } from './versionPolicy';

const UPDATE_META_PATH = '/api/app/update';
const UPDATE_APK_PATH = '/api/app/update/apk';
const RELEASE_UPLOAD_PATH = '/api/internal/releases/android-alpha';
const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const MAX_APK_BYTES = 30 * 1024 * 1024;

class ReleaseHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parsePositiveInt(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ReleaseHttpError(400, `${field} must be a positive integer`);
  return parsed;
}

function header(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

async function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new ReleaseHttpError(413, 'APK exceeds the maximum accepted size');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

export function isReleasePreRoute(req: Request): boolean {
  if (req.method === 'GET' && (req.path === UPDATE_META_PATH || req.path === UPDATE_APK_PATH)) return true;
  return req.method === 'PUT' && req.path === RELEASE_UPLOAD_PATH;
}

export async function handleReleasePreRoute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.method === 'GET' && req.path === UPDATE_META_PATH) {
      const installedVersionCode = parsePositiveInt(req.query.versionCode, 'versionCode');
      const release = await getCurrentAndroidRelease();
      if (!release) {
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          channel: 'android-alpha',
          installedVersionCode,
          updateAvailable: false,
          updateRequired: false
        });
        return;
      }

      const decision = buildAndroidUpdateDecision(installedVersionCode, release);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ...decision,
        downloadPath: decision.updateAvailable
          ? `${UPDATE_APK_PATH}?versionCode=${release.versionCode}`
          : null
      });
      return;
    }

    if (req.method === 'GET' && req.path === UPDATE_APK_PATH) {
      const versionCode = parsePositiveInt(req.query.versionCode, 'versionCode');
      const release = await getAndroidReleaseApk(versionCode);
      if (!release) throw new ReleaseHttpError(404, 'Android release not found');

      res.setHeader('Content-Type', APK_CONTENT_TYPE);
      res.setHeader('Content-Length', String(release.apk.length));
      res.setHeader('Content-Disposition', `attachment; filename="MR-SCRAP-android-${release.versionCode}.apk"`);
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      res.setHeader('ETag', `"sha256-${release.sha256}"`);
      res.send(release.apk);
      return;
    }

    if (req.method === 'PUT' && req.path === RELEASE_UPLOAD_PATH) {
      try {
        await verifyGitHubReleasePublisher(header(req, 'authorization'));
      } catch (error) {
        throw new ReleaseHttpError(403, (error as Error)?.message || 'Release publisher authorization failed');
      }

      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType !== APK_CONTENT_TYPE) {
        throw new ReleaseHttpError(415, `Expected Content-Type ${APK_CONTENT_TYPE}`);
      }

      const versionCode = parsePositiveInt(header(req, 'x-mr-scrap-version-code'), 'versionCode');
      const minSupportedVersionCode = parsePositiveInt(
        header(req, 'x-mr-scrap-min-supported-version-code'),
        'minSupportedVersionCode'
      );
      const versionName = header(req, 'x-mr-scrap-version-name').trim();
      const expectedSha256 = header(req, 'x-mr-scrap-sha256').trim().toLowerCase();
      if (!versionName || versionName.length > 64) throw new ReleaseHttpError(400, 'Invalid versionName');
      if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new ReleaseHttpError(400, 'Invalid SHA-256');

      const apk = await readRawBody(req, MAX_APK_BYTES);
      const release = await publishAndroidRelease({
        versionCode,
        versionName,
        minSupportedVersionCode,
        mandatory: true,
        expectedSha256,
        releaseNotes: header(req, 'x-mr-scrap-release-notes'),
        apk
      });

      res.status(201).json({ published: true, ...release });
      return;
    }

    next();
  } catch (error) {
    const status = error instanceof ReleaseHttpError ? error.status : 503;
    const message = (error as Error)?.message || 'Android release service unavailable';
    res.status(status).json({ error: message });
  }
}
