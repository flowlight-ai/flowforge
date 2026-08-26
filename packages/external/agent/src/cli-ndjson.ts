/**
 * @flowforge/external-agent cli-ndjson — CLI NDJSON 流式解析 + stderr 收集（CL-038）。
 *
 * TS 重写自 flowforge/core/external_agent/cli_ndjson.py：
 *   - StderrCollector: 按级别（warning/info/error/fatal/unknown）收集 stderr；
 *     前缀匹配规则 fatal 在 error 之前（fatal/panic/traceback → error →
 *     warning/warn → info）
 *   - NDJSONParser: feed 单行 / feedChunk 多行 buffer 缓存 / flushBuffer /
 *     getParsedCount / getParsedObjects / getParseFailures；
 *     解析失败不抛错记 _failures；非 dict 包裹 {"_value": obj}
 *   - CLIResult: success 仅看 returncode==0（"stderr 也算活着"教训）
 *
 * 教训（CL-038）：CLI 子进程即使 stderr 有输出也算正常——stderr 非空
 * 不等于失败；success 仅以 returncode==0 为准。
 */

// ---------------------------------------------------------------------------
// StderrCollector
// ---------------------------------------------------------------------------

/** 分类级别常量。 */
export const STDERR_LEVELS: readonly string[] = [
  'warning',
  'info',
  'error',
  'fatal',
  'unknown',
];

/** 前缀匹配规则（按优先级顺序，大小写不敏感；fatal 必须在 error 之前）。 */
const PREFIX_RULES: readonly (readonly [string, readonly string[]])[] = [
  ['fatal', ['fatal', 'panic', 'traceback']],
  ['error', ['error']],
  ['warning', ['warning', 'warn']],
  ['info', ['info']],
];

/** 子进程 stderr 收集器（cli_ndjson.py StderrCollector）。 */
export class StderrCollector {
  private readonly _lines = new Map<string, string[]>(
    STDERR_LEVELS.map((level) => [level, []]),
  );
  private _firstLine: string | undefined;
  private _lastLine: string | undefined;

  /** 启发式分类一行 stderr 文本。 */
  static classify(line: string): string {
    if (!line) {
      return 'unknown';
    }
    const lowered = line.trimStart().toLowerCase();
    for (const [level, prefixes] of PREFIX_RULES) {
      for (const prefix of prefixes) {
        if (lowered.startsWith(prefix)) {
          return level;
        }
      }
    }
    return 'unknown';
  }

  /** 喂入一行 stderr 文本（bytes 自动 decode；空行不计入）。 */
  feed(line: string | Uint8Array): void {
    const text = typeof line === 'string' ? line : new TextDecoder().decode(line);
    const cleaned = text.replace(/[\r\n]+$/, '');
    if (!cleaned) {
      return;
    }
    const level = StderrCollector.classify(cleaned);
    this._lines.get(level)!.push(cleaned);
    if (this._firstLine === undefined) {
      this._firstLine = cleaned;
    }
    this._lastLine = cleaned;
  }

  /** 按级别过滤返回 stderr 行（None 返回全部级别合并）。 */
  getLines(level?: string): string[] {
    if (level === undefined) {
      const merged: string[] = [];
      for (const lvl of STDERR_LEVELS) {
        merged.push(...(this._lines.get(lvl) ?? []));
      }
      return merged;
    }
    return [...(this._lines.get(level) ?? [])];
  }

  /** 是否有 fatal 级别行（供阻断判定参考，默认不阻断）。 */
  hasFatal(): boolean {
    return (this._lines.get('fatal')?.length ?? 0) > 0;
  }

  /** 返回 stderr 收集摘要。 */
  summary(): Record<string, unknown> {
    const counts = Object.fromEntries(
      STDERR_LEVELS.map((level) => [level, this._lines.get(level)?.length ?? 0]),
    );
    const total = STDERR_LEVELS.reduce(
      (sum, level) => sum + (this._lines.get(level)?.length ?? 0),
      0,
    );
    return {
      total,
      ...counts,
      first_line: this._firstLine ?? null,
      last_line: this._lastLine ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// NDJSONParser
// ---------------------------------------------------------------------------

/** NDJSON 流式解析器（cli_ndjson.py NDJSONParser）。 */
export class NDJSONParser {
  private _buffer = '';
  private readonly _parsed: Record<string, unknown>[] = [];
  private readonly _failures: [string, string][] = [];

  /** 喂入一行，返回该行解析出的 JSON 对象列表。 */
  feed(line: string | Uint8Array): Record<string, unknown>[] {
    const text = typeof line === 'string' ? line : new TextDecoder().decode(line);
    const cleaned = text.replace(/[\r\n]+$/, '').trim();
    if (!cleaned) {
      return [];
    }
    let obj: unknown;
    try {
      obj = JSON.parse(cleaned);
    } catch (error) {
      this._failures.push([cleaned, error instanceof Error ? error.message : String(error)]);
      return [];
    }
    return this._storeParsed(obj);
  }

  /** 喂入可能含多行的 chunk（最后一行不完整则缓存）。 */
  feedChunk(chunk: string | Uint8Array): Record<string, unknown>[] {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    const data = this._buffer + text;
    if (!data) {
      return [];
    }
    if (!data.includes('\n')) {
      this._buffer = data;
      return [];
    }
    const lines = data.split('\n');
    this._buffer = lines.pop() ?? '';
    const results: Record<string, unknown>[] = [];
    for (const line of lines) {
      results.push(...this.feed(line));
    }
    return results;
  }

  /** 刷新缓冲区中剩余的不完整行。 */
  flushBuffer(): Record<string, unknown>[] {
    if (!this._buffer) {
      return [];
    }
    const remaining = this._buffer;
    this._buffer = '';
    return this.feed(remaining);
  }

  /** 已解析成功的 JSON 对象数。 */
  getParsedCount(): number {
    return this._parsed.length;
  }

  /** 已解析成功的 JSON 对象列表（副本）。 */
  getParsedObjects(): Record<string, unknown>[] {
    return [...this._parsed];
  }

  /** 解析失败列表（(line, error) 副本）。 */
  getParseFailures(): [string, string][] {
    return [...this._failures];
  }

  /** 规范化存储解析结果（非 dict 包裹 {"_value": obj}）。 */
  private _storeParsed(obj: unknown): Record<string, unknown>[] {
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
      const record = obj as Record<string, unknown>;
      this._parsed.push(record);
      return [record];
    }
    if (Array.isArray(obj)) {
      const results: Record<string, unknown>[] = [];
      for (const item of obj) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          this._parsed.push(record);
          results.push(record);
        } else {
          const wrapped = { _value: item };
          this._parsed.push(wrapped);
          results.push(wrapped);
        }
      }
      return results;
    }
    const wrappedScalar = { _value: obj };
    this._parsed.push(wrappedScalar);
    return [wrappedScalar];
  }
}

// ---------------------------------------------------------------------------
// CLIResult
// ---------------------------------------------------------------------------

/** CLI 调用结果封装（cli_ndjson.py CLIResult）。 */
export interface CLIResult {
  /** 原始 stdout 文本。 */
  readonly stdout: string;
  /** stderr 收集摘要。 */
  readonly stderr_summary: Record<string, unknown>;
  /** 从 stdout 解析出的 NDJSON 对象列表。 */
  readonly ndjson_objects: readonly Record<string, unknown>[];
  /** 子进程退出码。 */
  readonly returncode: number;
  /** 是否成功（仅 returncode==0，不看 stderr）。 */
  readonly success: boolean;
  /** 失败时的错误信息（returncode!=0 时填充）。 */
  readonly error?: string;
}

/** 解析一次 CLI 调用结果（cli_ndjson.py parse_cli_invocation）。 */
export function parseCliInvocation(
  stdout: string,
  stderr: string,
  returncode: number,
): CLIResult {
  const collector = new StderrCollector();
  for (const line of stderr.split('\n')) {
    collector.feed(line);
  }
  const parser = new NDJSONParser();
  const ndjsonObjects = parser.feedChunk(stdout);
  return {
    stdout,
    stderr_summary: collector.summary(),
    ndjson_objects: ndjsonObjects,
    returncode,
    success: returncode === 0,
    ...(returncode !== 0 ? { error: `cli exited with code ${returncode}` } : {}),
  };
}

/** 别名（cli_ndjson.py CLINDJSONParser）。 */
export { NDJSONParser as CLINDJSONParser };
