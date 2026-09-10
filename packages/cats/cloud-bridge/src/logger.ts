/**
 * Minimal injectable logger branding — keeps the bridge dependency-light and
 * lets hosts substitute their own sink without coupling to a logging library.
 * @flowforge/cats-cloud-bridge internal.
 */
export interface CloudBridgeLogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

export const silentLogger: CloudBridgeLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
}

function noop(): void {
  /* intentional no-op */
}