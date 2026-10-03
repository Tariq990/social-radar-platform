import crypto from 'crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = 'mrscrap-render-release';
const EXPECTED_REPOSITORY = 'Tariq990/social-radar-platform';
const EXPECTED_REF = 'refs/heads/work/real-session-ai-provider';
const EXPECTED_WORKFLOW_REF = `${EXPECTED_REPOSITORY}/.github/workflows/android-alpha-release.yml@${EXPECTED_REF}`;
const CLOCK_SKEW_MS = 60_000;
const JWKS_CACHE_MS = 10 * 60_000;

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface GitHubOidcClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  ref?: string;
  workflow_ref?: string;
  sha?: string;
  run_id?: string;
}

let cachedJwks: { expiresAt: number; keys: any[] } | null = null;

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

async function getJwks(): Promise<any[]> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) return cachedJwks.keys;

  const response = await fetch(JWKS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`GitHub OIDC JWKS fetch failed with HTTP ${response.status}`);

  const body = await response.json() as { keys?: any[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('GitHub OIDC JWKS response did not contain signing keys');
  }
  cachedJwks = { expiresAt: now + JWKS_CACHE_MS, keys: body.keys };
  return body.keys;
}

function audienceMatches(value: string | string[] | undefined): boolean {
  if (typeof value === 'string') return value === AUDIENCE;
  return Array.isArray(value) && value.includes(AUDIENCE);
}

export async function verifyGitHubReleasePublisher(authorizationHeader: string | undefined): Promise<GitHubOidcClaims> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new Error('Missing GitHub Actions OIDC bearer token');
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed GitHub Actions OIDC token');

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonSegment<JwtHeader>(headerPart);
  const claims = decodeJsonSegment<GitHubOidcClaims>(payloadPart);

  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported GitHub OIDC signing algorithm');

  const keys = await getJwks();
  const jwk = keys.find(key => key?.kid === header.kid);
  if (!jwk) {
    cachedJwks = null;
    const refreshed = await getJwks();
    const refreshedKey = refreshed.find(key => key?.kid === header.kid);
    if (!refreshedKey) throw new Error('GitHub OIDC signing key was not found');
    return verifyWithKey(headerPart, payloadPart, signaturePart, claims, refreshedKey);
  }

  return verifyWithKey(headerPart, payloadPart, signaturePart, claims, jwk);
}

function verifyWithKey(
  headerPart: string,
  payloadPart: string,
  signaturePart: string,
  claims: GitHubOidcClaims,
  jwk: any
): GitHubOidcClaims {
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' } as any);
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`, 'ascii'),
    publicKey,
    Buffer.from(signaturePart, 'base64url')
  );
  if (!verified) throw new Error('GitHub Actions OIDC signature verification failed');

  const now = Date.now();
  if (claims.iss !== ISSUER) throw new Error('Unexpected GitHub OIDC issuer');
  if (!audienceMatches(claims.aud)) throw new Error('Unexpected GitHub OIDC audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - CLOCK_SKEW_MS) {
    throw new Error('GitHub Actions OIDC token is expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > now + CLOCK_SKEW_MS) {
    throw new Error('GitHub Actions OIDC token is not active yet');
  }
  if (claims.repository !== EXPECTED_REPOSITORY) throw new Error('Unexpected GitHub OIDC repository');
  if (claims.ref !== EXPECTED_REF) throw new Error('Unexpected GitHub OIDC ref');
  if (claims.workflow_ref !== EXPECTED_WORKFLOW_REF) throw new Error('Unexpected GitHub OIDC workflow');

  return claims;
}
