/**
 * Clock seam.
 *
 * The legacy modules called `datetime.now(timezone.utc)` directly, which made
 * timestamped behaviour untestable. Timestamps are injected instead; the
 * default is the system clock, so host wiring needs no configuration.
 */

/** Anything that can report the current instant as an ISO-8601 UTC string. */
export interface Clock {
  now(): string;
}

/** Default clock — ISO-8601 with milliseconds, matching Python `isoformat()`. */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** Read the clock, falling back to the system clock when none was injected. */
export function isoNow(clock?: Clock): string {
  return (clock ?? systemClock).now();
}
