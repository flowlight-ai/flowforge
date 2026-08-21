/**
 * CLI spawn 辅助 — 本地化自 clowder-ai `src/utils/cli-spawn.ts` 的
 * `maybeCollectStreamError`（F212 Phase A AC-A8 载体，Phase D 扩展 result error）。
 *
 * NDJSON stream 的 `error` 事件 / `result` 错误事件是 CLI provider 真实失败语义的
 * 主要渠道（Codex / opencode / Claude CLI），与 stderr 互为补充。本函数从事件对象
 * 显式提取错误文本（Error 实例字段不可枚举，JSON.stringify 会丢），并做有界收集，
 * 供调用方喂给 buildCliDiagnostics 做 reasonCode 分类。
 *
 * @module @flowforge/limb-terminal/cli/cli-spawn-helpers
 */

/**
 * F212 Phase A — collect text from NDJSON stream `error` events. CLI providers (Codex, opencode)
 * often report real failure semantics in stream events rather than stderr (AC-A8).
 *
 * 云端 codex P2 (2026-05-26): JSON.stringify alone drops `Error` instance fields because
 * `message`/`name`/`stack` are non-enumerable on Error. We extract those explicitly so the
 * classifier regex can still see provider error text.
 *
 * 云端 codex round-5 P2 (2026-05-26): bounded sink growth — long-running sessions emitting
 * repeated error events would otherwise grow streamErrorTexts unbounded. Enforce entry +
 * char caps consistent with tmux nonJsonOutput buffer pattern.
 */
const STREAM_ERROR_MAX_ENTRIES = 50;
const STREAM_ERROR_MAX_CHARS = 16384;

export function maybeCollectStreamError(value: unknown, sink: string[], structuredSink?: string[]): void {
  if (typeof value !== 'object' || value === null) return;
  const evt = value as Record<string, unknown>;
  const isErrorEvent = evt.type === 'error';
  // F212 Phase D: Claude CLI reports tool-call-parse failures via a result event whose shape is
  // counter-intuitive — verified against 7 real opus-4.8 archive samples (2026-05-29):
  //   {type:'result', subtype:'success', is_error:true, result:'...could not be parsed...', errors:null}
  // The authoritative error flag is `is_error===true` (NOT subtype — which stays 'success'); the cause
  // text lives in `result` (errors[] is null). We ALSO honor subtype!=='success' for any classic error
  // subtype CC may emit (e.g. error_during_execution / error_max_turns). This was the "未识别" root
  // cause: the result error never reached cliDiagnostics' rawText, and a subtype-only guard would
  // STILL have missed it because subtype is 'success'.
  const isResultError =
    evt.type === 'result' && (evt.is_error === true || (typeof evt.subtype === 'string' && evt.subtype !== 'success'));
  if (!isErrorEvent && !isResultError) return;
  // Bound: skip new entries once cap is reached (entries or total chars).
  if (sink.length >= STREAM_ERROR_MAX_ENTRIES) return;
  let currentChars = 0;
  for (const s of sink) currentChars += s.length;
  if (currentChars >= STREAM_ERROR_MAX_CHARS) return;
  // Explicit extraction of common error-shape fields (handles Error instances + plain objects)
  const explicitParts: string[] = [];
  const collectFrom = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    if (obj instanceof Error) {
      explicitParts.push(`${obj.name ?? 'Error'}: ${obj.message ?? ''}`);
      return;
    }
    const r = obj as Record<string, unknown>;
    if (typeof r.name === 'string') explicitParts.push(r.name);
    if (typeof r.message === 'string') explicitParts.push(r.message);
    if (r.data && typeof r.data === 'object') {
      const d = r.data as Record<string, unknown>;
      if (typeof d.message === 'string') explicitParts.push(d.message);
      if (typeof d.statusCode === 'number') explicitParts.push(String(d.statusCode));
    }
  };
  collectFrom(evt.error);
  collectFrom(evt);
  // F212 Phase D: result error fields (errors[] / result) carry CC's emitted cause text
  // (e.g. "The model's tool call could not be parsed"). type==='error' events don't have these.
  if (isResultError) {
    if (Array.isArray(evt.errors)) {
      for (const e of evt.errors) if (typeof e === 'string' && e.trim()) explicitParts.push(e);
    }
    if (typeof evt.result === 'string' && evt.result.trim()) explicitParts.push(evt.result);
  }
  const remainingChars = STREAM_ERROR_MAX_CHARS - currentChars;
  const pushBounded = (entry: string): void => {
    sink.push(entry.length > remainingChars ? entry.slice(0, remainingChars) : entry);
  };
  // AC-D3: CC structured friendly message (explicitParts) → structuredSink for unknown fallback
  // display ("Claude Code 报告：<cause>"). Safe source — CC standard wording, not raw stderr.
  // Cloud codex P1 fix (2026-05-29 on da1f81763): MUST gate on isResultError so unclassified
  // type='error' events (whose explicitParts include arbitrary provider stderr-like content)
  // don't leak through AC-D3 → buildCliDiagnostics → safeExcerpt. Result events with is_error:true
  // remain the only "safe structured source" admitted to structuredSink (KD-1/AC-A9 red line).
  if (structuredSink && isResultError && explicitParts.length > 0) {
    const friendly = explicitParts.join('\n');
    structuredSink.push(friendly.length > remainingChars ? friendly.slice(0, remainingChars) : friendly);
  }
  try {
    const serialized = JSON.stringify(evt);
    pushBounded(explicitParts.length > 0 ? `${explicitParts.join('\n')}\n${serialized}` : serialized);
  } catch {
    // Circular ref / non-serializable — at least preserve the extracted text
    if (explicitParts.length > 0) pushBounded(explicitParts.join('\n'));
  }
}
