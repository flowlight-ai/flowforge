/**
 * F162: Lark CLI Executor — lark-cli 子进程薄封装。
 *
 * JSON 输出解析 / 超时 / 错误分类。ADR-029：CliExecutor 是
 * LarkActionService 的执行后端，全部 cat 侧 Lark 动作经 ActionService 走此处。
 *
 * 移植自 clowder-ai `infrastructure/enterprise/LarkCliExecutor.ts`
 * （FastifyBaseLogger → 注入式 EnterpriseLogger；execFile 可注入测试桩）。
 */

import type { LarkBaseResponse, LarkCliErrorDetail } from './lark-types.ts';

export type LarkFlagValue = string | number | boolean;

/** Default timeout for lark-cli commands (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFileFn = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
) => Promise<ExecResult>;

/** 缺省 execFile（延迟 import，测试可注入替换）。 */
export const defaultExecFile: ExecFileFn = async (file, args, opts) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  return promisify(execFile)(file, args, opts);
};

export interface EnterpriseLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** lark-cli 返回 ok: false（API 层错误） */
export class LarkApiError extends Error {
  readonly code: number;
  readonly type: string;
  readonly hint?: string | undefined;
  constructor(
    error: LarkCliErrorDetail,
    readonly domain: string,
    readonly command: string,
  ) {
    super(`Lark API error [${error.code} ${error.type}]: ${error.message} (${domain} ${command})`);
    this.name = 'LarkApiError';
    this.code = error.code;
    this.type = error.type;
    this.hint = error.hint;
  }
}

/** lark-cli 本身不可用（未安装/超时/崩溃/鉴权缺失） */
export class LarkCliUnavailableError extends Error {
  readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'LarkCliUnavailableError';
    this.reason = reason;
  }
}

/**
 * lark-cli 有输出但不符合 {ok, identity, data|error} 信封（非 JSON/截断/协议漂移）。
 * 与 UnavailableError 区分：CLI 可达但输出不可解释 → 500 而非 503，
 * 保留原始 payload 便于排查 vendor 形状变化。
 */
export class LarkCliProtocolError extends Error {
  readonly reason?: unknown;
  readonly rawOutput?: string | undefined;
  constructor(message: string, reason?: unknown, rawOutput?: string) {
    super(message);
    this.name = 'LarkCliProtocolError';
    this.reason = reason;
    this.rawOutput = rawOutput;
  }
}

export interface LarkCliExecutorOptions {
  log: EnterpriseLogger;
  timeoutMs?: number;
  /** 测试桩：替换真实 execFile。 */
  execFileAsync?: ExecFileFn;
}

export class LarkCliExecutor {
  private available: boolean | null = null;
  private readonly log: EnterpriseLogger;
  private readonly timeoutMs: number;
  private readonly execFn: ExecFileFn;

  constructor(opts: LarkCliExecutorOptions) {
    this.log = opts.log;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.execFn = opts.execFileAsync ?? defaultExecFile;
  }

  /** 检测 lark-cli 可用性（首次后缓存）。 */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const { stdout } = await this.execFn('lark-cli', ['--version'], { timeout: 5_000, maxBuffer: 1024 * 1024 });
      this.log.info(`[LarkCli] lark-cli detected: ${stdout.trim()}`);
      this.available = true;
    } catch {
      this.log.warn('[LarkCli] lark-cli not found — enterprise actions will be unavailable');
      this.available = false;
    }
    return this.available;
  }

  /**
   * 执行 lark-cli 命令并解析 JSON。
   * @param domain  - 顶层命令（docs, task, calendar, base, im, ...）
   * @param command - 子命令（多为 + 前缀，如 +create）
   * @param flags   - flag map；值字符串化，每项输出 `--flag value`
   * @throws LarkApiError（ok:false）/ LarkCliUnavailableError / LarkCliProtocolError
   */
  async exec<T extends LarkBaseResponse>(
    domain: string,
    command: string,
    flags: Record<string, LarkFlagValue | undefined> = {},
  ): Promise<T> {
    if (!(await this.isAvailable())) {
      throw new LarkCliUnavailableError('lark-cli is not installed or not configured');
    }

    const args: string[] = [domain, command];
    for (const [key, value] of Object.entries(flags)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'boolean') {
        if (value) args.push(`--${key}`);
        continue;
      }
      args.push(`--${key}`, String(value));
    }

    this.log.info(`[LarkCli] exec ${domain} ${command}`);

    try {
      const { stdout, stderr } = await this.execFn('lark-cli', args, {
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stderr.trim()) {
        this.log.debug(`[LarkCli] stderr: ${stderr.trim()}`);
      }

      const parsed = this.parseOutput<T>(stdout.trim());
      if (parsed.ok === false) {
        const errorDetail =
          parsed.error ?? { type: 'unknown', code: -1, message: 'lark-cli reported ok:false without error detail' };
        throw new LarkApiError(errorDetail, domain, command);
      }
      this.log.info(`[LarkCli] success ${domain} ${command}`);
      return parsed;
    } catch (err) {
      if (err instanceof LarkApiError) throw err;
      if (err instanceof LarkCliProtocolError) throw err;

      const error = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
      if (error.killed) {
        throw new LarkCliUnavailableError(`lark-cli timed out after ${this.timeoutMs}ms`, err);
      }
      if (error.code === 'ENOENT') {
        this.available = false;
        throw new LarkCliUnavailableError('lark-cli binary not found', err);
      }
      const detail = error.stderr ? `: ${error.stderr.trim().slice(0, 500)}` : '';
      throw new LarkCliUnavailableError(`lark-cli execution failed: ${error.message}${detail}`, err);
    }
  }

  /**
   * 解析 lark-cli stdout。接受 {ok, identity, data|error} 信封；
   * 部分命令输出纯 data（无信封）——无 ok 字段视为成功并合成信封。
   */
  private parseOutput<T>(raw: string): T {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new LarkCliProtocolError(`lark-cli returned non-JSON stdout (${raw.length} chars)`, err, raw.slice(0, 500));
    }
    if (typeof parsed.ok !== 'boolean') {
      return { ok: true, data: parsed } as unknown as T;
    }
    return parsed as T;
  }

  /** 重置可用性缓存（测试用）。 */
  _resetCache(): void {
    this.available = null;
  }
}

/** scope/permission 类 API 错误判定（searchUsers 降级用）。 */
export function isScopeOrPermissionError(err: LarkApiError): boolean {
  const type = err.type.toLowerCase();
  if (type.includes('permission') || type.includes('scope') || type.includes('forbidden')) return true;
  // Common Lark permission/scope codes (99991664 scope_denied, 99991668 forbidden, 1254xxx contact-scope)
  return err.code === 99991664 || err.code === 99991668 || (err.code >= 1254000 && err.code <= 1254999);
}
