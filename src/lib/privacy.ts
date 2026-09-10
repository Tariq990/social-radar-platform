const BLOCKED_METADATA_KEY_PARTS = [
  'cookie', 'cookies', 'password', 'passwd', 'session', 'sessionid', 'xs', 'c_user',
  'token', 'access_token', 'authorization', 'bearer', 'credential', 'secret'
] as const;

/**
 * Sanitizes collector metadata before it can cross a network boundary.
 * Only bounded primitive diagnostics are retained; secret-shaped and nested values are dropped.
 */
export function sanitizeTransportMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  let kept = 0;
  for (const [rawKey, entry] of Object.entries(value as Record<string, unknown>)) {
    if (kept >= 64) break;
    const key = rawKey.trim().slice(0, 80);
    if (!key) continue;
    const lower = key.toLowerCase();
    if (BLOCKED_METADATA_KEY_PARTS.some(part => lower.includes(part))) continue;
    if (typeof entry === 'string') {
      output[key] = entry.slice(0, 2000);
      kept++;
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      output[key] = entry;
      kept++;
    } else if (typeof entry === 'boolean' || entry === null) {
      output[key] = entry;
      kept++;
    }
  }
  return output;
}
