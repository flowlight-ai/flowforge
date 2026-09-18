/**
 * Logging seam.
 *
 * The legacy modules called `get_logger(...)` at import time, which made the
 * guardrail layer impossible to observe in tests. Logging is injected instead;
 * the default is silent, so host wiring is unchanged and default external
 * behaviour matches the source.
 */

/** Minimal logger surface used by the world engine. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Default logger: discards everything. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
