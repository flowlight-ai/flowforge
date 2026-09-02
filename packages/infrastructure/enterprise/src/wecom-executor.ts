/**
 * F162: WeCom CLI Executor — wecom-cli（Rust npm 包）子进程薄封装。
 *
 * JSON 输出解析 / MCP content 包装剥离 / 超时 / 错误分类。
 * ADR-029：CliExecutor 是 WeComActionService 的执行后端。
 *
 * 移植自 clowder-ai `infrastructure/enterprise/WeComCliExecutor.ts`。
 */

import type { EnterpriseLogger, ExecFileFn } from './lark-executor.ts';
import { defaultExecFile } from './lark-executor.ts';
import type { WeComBaseResponse } from './wecom-types.ts';

/** Default timeout for wecom-cli commands (30 seconds, matching upstream default) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Thrown when wecom-cli returns errcode !== 0 */
export class WeComApiError extends Error {
  constructor(
    readonly errcode: number,
    readonly errmsg: string,
    readonly category: string,
    readonly method: string,
  ) {
    super(`WeChat Work API error [${errcode}]: ${errmsg} (${category}.${method})`);
    this.name = 'WeComApiError';
  }
}

/** Thrown when wecom-cli itself fails (not installed, timeout, crash) */
export class WeComCliUnavailableError extends Error {
  readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'WeComCliUnavailableError';
    this.reason = reason;
  }
}

export interface WeComCliExecutorOptions {
  log: EnterpriseLogger;
  timeoutMs?: number;
  /** 测试桩：替换真实 execFile。 */
  execFileAsync?: ExecFileFn;
}

export class WeComCliExecutor {
  private available: boolean | null = null;
  private readonly log: EnterpriseLogger;
  private readonly timeoutMs: number;
  private readonly execFn: ExecFileFn;

  constructor(opts: WeComCliExecutorOptions) {
    this.log = opts.log;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.execFn = opts.execFileAsync ?? defaultExecFile;
  }

  /** 检测 wecom-cli 可用性（首次后缓存）。 */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const { stdout } = await this.execFn('wecom-cli', ['--version'], { timeout: 5_000, maxBuffer: 1024 * 1024 });
      this.log.info(`[WeComCli] wecom-cli detected: ${stdout.trim()}`);
      this.available = true;
    } catch {
      this.log.warn('[WeComCli] wecom-cli not found — enterprise actions will be unavailable');
      this.available = false;
    }
    return this.available;
  }

  /**
   * 执行 wecom-cli 命令并解析 JSON。
   * @param category - 命令类目（doc, todo, meeting, contact, ...）
   * @param method   - 方法名（create_doc, create_todo, ...）
   * @param params   - 传给命令的 JSON 参数
   * @throws WeComApiError（errcode!==0）/ WeComCliUnavailableError
   */
  async exec<T extends WeComBaseResponse>(
    category: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!(await this.isAvailable())) {
      throw new WeComCliUnavailableError('wecom-cli is not installed or not configured');
    }
    const jsonParams = JSON.stringify(params);
    const args = [category, method, jsonParams];
    this.log.info(`[WeComCli] exec ${category} ${method}`);

    try {
      const { stdout, stderr } = await this.execFn('wecom-cli', args, {
        timeout: this.timeoutMs,
        maxBuffer: 5 * 1024 * 1024, // 5MB for large responses (user lists)
      });
      if (stderr.trim()) {
        this.log.debug(`[WeComCli] stderr: ${stderr.trim()}`);
      }
      const parsed = this.unwrapOutput<T>(stdout.trim());
      if (parsed.errcode !== 0) {
        throw new WeComApiError(parsed.errcode, parsed.errmsg, category, method);
      }
      this.log.info(`[WeComCli] success ${category} ${method} errcode=${parsed.errcode}`);
      return parsed;
    } catch (err) {
      if (err instanceof WeComApiError) throw err;
      const error = err as NodeJS.ErrnoException & { killed?: boolean };
      if (error.killed) {
        throw new WeComCliUnavailableError(`wecom-cli timed out after ${this.timeoutMs}ms`, err);
      }
      if (error.code === 'ENOENT') {
        this.available = false;
        throw new WeComCliUnavailableError('wecom-cli binary not found', err);
      }
      throw new WeComCliUnavailableError(`wecom-cli execution failed: ${error.message}`, err);
    }
  }

  /**
   * 解析 wecom-cli stdout。兼容两种格式：
   *   raw: {"errcode":0,...}
   *   MCP content 包装: {"content":[{"text":"{...实际 JSON...}","type":"text"}],"isError":false}
   */
  private unwrapOutput<T>(raw: string): T {
    const outer = JSON.parse(raw) as Record<string, unknown>;
    // MCP content wrapper: extract text from content[0].text
    if (Array.isArray(outer.content) && outer.content.length > 0) {
      const first = outer.content[0] as { text?: string; type?: string };
      if (first.text && first.type === 'text') {
        return JSON.parse(first.text) as T;
      }
    }
    // Raw JSON (no wrapper) — return as-is
    return outer as T;
  }

  /** 重置可用性缓存（测试用）。 */
  _resetCache(): void {
    this.available = null;
  }
}
