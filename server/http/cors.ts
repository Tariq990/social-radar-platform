import type { Request, Response, NextFunction } from 'express';

import { handleReleasePreRoute, isReleasePreRoute } from '../releases/releaseMiddleware';

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();

  origins.add('https://localhost');
  origins.add('capacitor://localhost');

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    const origin = normalizeOrigin(appUrl);
    if (origin) origins.add(origin);
  }

  for (const raw of (process.env.CORS_ALLOWED_ORIGINS || '').split(',')) {
    const origin = normalizeOrigin(raw);
    if (origin) origins.add(origin);
  }

  const mode = (process.env.APP_MODE || 'production').trim().toLowerCase();
  if (mode !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://127.0.0.1:5173');
  }

  return origins;
}

const ALLOWED_METHODS = 'GET,POST,PATCH,PUT,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type,Authorization,X-MR-SCRAP-CLIENT,X-MR-SCRAP-ADMIN-TOKEN';

function continueRequest(req: Request, res: Response, next: NextFunction) {
  // The APK publisher uploads a raw binary body. This middleware is installed before express.json,
  // so updater endpoints are intentionally handled here before any body parser can consume them.
  if (isReleasePreRoute(req)) {
    void handleReleasePreRoute(req, res, next);
    return;
  }
  return next();
}

/**
 * Strict credentialed CORS for the hosted API used by the web/Capacitor clients.
 * Requests without Origin (for example Android WorkManager HttpURLConnection) are not browser
 * CORS requests and pass through normally. Production never uses wildcard origin.
 */
export function strictCors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;

  if (!origin) {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return continueRequest(req, res, next);
  }

  const allowed = configuredOrigins();
  if (!allowed.has(origin)) {
    if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: 'CORS origin is not allowed' });
    }
    return res.status(403).json({ error: 'Origin is not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return continueRequest(req, res, next);
}
