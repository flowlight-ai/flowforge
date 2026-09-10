/**
 * Normalize arbitrary thrown values into a human-readable error string.
 *
 * Ported from clowder-ai `api/src/utils/normalize-error.ts`.
 * Covers: Error instances, plain strings, objects with `.message`, and a
 * fallback to `String()` / JSON serialization for anything else.
 */

/**
 * Coerce an unknown thrown value into a helpful message string.
 * Returns a stable `'Unknown error'` when even stringification fails.
 */
export function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err !== null) {
    try {
      const message = Reflect.get(err, 'message')
      if (typeof message === 'string') return message
    } catch {
      // Fall through to the generic fallback path when message access is hostile.
    }
  }
  try {
    const s = String(err)
    return s !== '[object Object]' ? s : JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}