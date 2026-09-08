export function postgresSsl(databaseUrl: string): false | { rejectUnauthorized: boolean } {
  const raw = databaseUrl.trim();
  if (raw.includes('localhost') || raw.includes('127.0.0.1')) return false;

  // Render-managed/internal PostgreSQL commonly requires TLS without a public CA chain.
  // Operators can opt into full certificate verification when their deployment supplies one.
  const verify = (process.env.PG_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase();
  return { rejectUnauthorized: verify === 'true' || verify === '1' || verify === 'yes' };
}
