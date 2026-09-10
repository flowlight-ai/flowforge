/**
 * env-mask — URL 凭据掩码工具。
 *
 * 源：clowder-ai `config/env-registry.ts` 的 maskUrlCredentials（domains/services
 * 依赖它做端点脱敏展示）。此处按包级自包含原则内联，避免跨包引入 registry。
 */

/** Mask credentials in a URL while preserving host/port/db for debugging. */
export function maskUrlCredentials(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = url.username ? '***' : '';
      url.password = '';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    // Not a valid URL — mask entirely to be safe
    return '***';
  }
}
