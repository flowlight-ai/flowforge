/**
 * loopback-url — localhost → 127.0.0.1 归一化。
 * Ported from clowder-ai `domains/services/loopback-url.ts`（F195）。
 */

export function normalizeLoopbackUrl(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (url.hostname !== 'localhost') return endpoint;
    const hadTrailingSlash = endpoint.endsWith('/');
    url.hostname = '127.0.0.1';
    const serialized = url.toString();
    return !hadTrailingSlash && url.pathname === '/' ? serialized.replace(/\/$/, '') : serialized;
  } catch {
    return endpoint;
  }
}
