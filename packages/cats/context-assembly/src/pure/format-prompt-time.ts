/**
 * Timezone-consistent timestamp formatting for agent prompts (ported from clowder
 * `format-time.ts`, delta-slimmed to what the context domain needs).
 *
 * The base always includes a UTC date + explicit "UTC" marker so cats align with
 * external UTC sources. Call sites needing co-creator time-of-day can pass an IANA
 * timezone to append the local wall clock.
 */

export interface PromptTimeFormatOptions {
  /** IANA timezone for co-creator-local rendering. Null/empty means UTC-only. */
  timeZone?: string | null;
  /** Invocation wall-clock. When set with includeAge, the formatter appends an age. */
  nowMs?: number;
  /** Age rendering mode (always / stale / off). */
  includeAge?: 'always' | 'stale' | false;
  /** Staleness threshold for includeAge='stale'. Defaults to 6 hours. */
  staleThresholdMs?: number;
  /** IANA timezone used only for stale cross-date comparison. */
  staleComparisonTimeZone?: string | null;
}

const DEFAULT_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

function dateTimeInZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${
    byType.get('hour') ?? '00'
  }:${byType.get('minute') ?? '00'}`;
}

function dateKeyInZone(epochMs: number, timeZone: string): string {
  return dateTimeInZone(epochMs, timeZone).slice(0, 10);
}

function utcDateTime(epochMs: number): string {
  return `${dateTimeInZone(epochMs, 'UTC')} UTC`;
}

function formatAge(epochMs: number, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - epochMs);
  const totalMinutes = Math.floor(deltaMs / 60_000);
  if (totalMinutes < 1) return '<1m ago';
  if (totalMinutes < 60) return `${totalMinutes}m ago`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `${totalHours}h${minutes > 0 ? `${minutes}m` : ''} ago`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d${hours > 0 ? ` ${hours}h` : ''} ago`;
}

function shouldAppendAge(epochMs: number, options?: PromptTimeFormatOptions): boolean {
  if (typeof options?.nowMs !== 'number') return false;
  if (options.includeAge === 'always') return true;
  if (options.includeAge !== 'stale') return false;

  const comparisonTz = options.staleComparisonTimeZone?.trim() || options.timeZone?.trim() || 'UTC';
  const crossesDate = dateKeyInZone(epochMs, comparisonTz) !== dateKeyInZone(options.nowMs, comparisonTz);
  if (crossesDate) return true;
  const threshold =
    typeof options.staleThresholdMs === 'number' ? options.staleThresholdMs : DEFAULT_STALE_THRESHOLD_MS;
  return options.nowMs - epochMs >= threshold;
}

function withAge(base: string, epochMs: number, options?: PromptTimeFormatOptions): string {
  if (typeof options?.nowMs !== 'number' || !shouldAppendAge(epochMs, options)) return base;
  return `${base} · ${formatAge(epochMs, options.nowMs)}`;
}

/** Format an epoch-ms timestamp for prompt injection. */
export function formatPromptTime(epochMs: number, options?: PromptTimeFormatOptions): string {
  const utc = utcDateTime(epochMs);
  const timeZone = (options?.timeZone ?? '').trim();
  if (!timeZone) return withAge(utc, epochMs, options);
  return withAge(`co-creator本地 ${dateTimeInZone(epochMs, timeZone)} ${timeZone} / ${utc}`, epochMs, options);
}