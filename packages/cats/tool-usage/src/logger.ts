/**
 * Minimal no-op logger contract, inlined for the tool-usage domain.
 *
 * FlowForge convention: logging seams are injected/isolated. This replaces the
 * clowder `infrastructure/logger` dependency so the package stays self-contained.
 */
export interface ModuleLogger {
  info(objOrMsg: unknown, msg?: string): void
  warn(objOrMsg: unknown, msg?: string): void
  error(objOrMsg: unknown, msg?: string): void
}

const silent: ModuleLogger = {
  info(): void {},
  warn(): void {},
  error(): void {},
}

/** Returns a logger. Consumers may supply their own via dependency injection. */
export function createModuleLogger(_name: string): ModuleLogger {
  return silent
}