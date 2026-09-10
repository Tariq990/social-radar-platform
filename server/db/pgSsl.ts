export function postgresSsl(databaseUrl: string): false | { rejectUnauthorized: boolean } {
  const raw = databaseUrl.trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    // Let the PostgreSQL client report malformed connection strings. Do not infer a local host
    // from arbitrary credential/path text because that could accidentally disable TLS.
  }

  const hostname = (parsed?.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;

  const sslMode = (parsed?.searchParams.get('sslmode') || '').trim().toLowerCase();
  if (sslMode === 'disable') return false;

  // verify-ca / verify-full explicitly request certificate verification. Other remote modes keep
  // the existing deployment behavior unless the operator opts into verification through env.
  if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
    return { rejectUnauthorized: true };
  }

  const verify = (process.env.PG_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase();
  return { rejectUnauthorized: verify === 'true' || verify === '1' || verify === 'yes' };
}
