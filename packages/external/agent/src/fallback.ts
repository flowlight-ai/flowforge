/**
 * @flowforge/external-agent fallback — F34 失败回退链（EX-007）。
 *
 * TS 重写自 flowforge/core/external_agent/fallback.py：
 *   - InvokeFn: (provider_name, task, context) => Promise<dict>
 *   - FallbackAttempt: provider_name / attempt / success / error /
 *     duration_ms / timestamp
 *   - FallbackResult: success / winning_provider / result / attempts /
 *     total_duration_ms
 *   - ExternalAgentFallback: withFallback 双层循环（provider × retry），
 *     result.success 判定，失败退避（最后一次不退避），全失败返回 success=false
 *
 * 默认链：anthropic.claude_code → openai.codex → opencode.opencode →
 *         bytedance.trae → flowforge.internal
 */

import { setTimeout as sleep } from 'node:timers/promises';

/** 默认 fallback 链（fallback.py DEFAULT_FALLBACK_CHAIN）。 */
export const DEFAULT_FALLBACK_CHAIN: readonly string[] = [
  'anthropic.claude_code',
  'openai.codex',
  'opencode.opencode',
  'bytedance.trae',
  'flowforge.internal',
];

/** 调用函数类型（fallback.py InvokeFn）。 */
export type InvokeFn = (
  providerName: string,
  task: string,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** 单次尝试记录（fallback.py FallbackAttempt）。 */
export interface FallbackAttempt {
  /** Provider 名称。 */
  readonly provider_name: string;
  /** 第几次尝试（1 起，同一 Provider 重试递增）。 */
  readonly attempt: number;
  /** 是否成功。 */
  readonly success: boolean;
  /** 失败时的错误信息。 */
  readonly error: string;
  /** 本次尝试耗时（毫秒）。 */
  readonly duration_ms: number;
  /** 尝试时间戳（ISO 8601）。 */
  readonly timestamp: string;
}

/** Fallback 链最终结果（fallback.py FallbackResult）。 */
export interface FallbackResult {
  /** 是否最终成功。 */
  readonly success: boolean;
  /** 成功的 Provider（失败时为空串）。 */
  readonly winning_provider: string;
  /** 最终结果（成功时）。 */
  readonly result: Record<string, unknown> | null;
  /** 全部尝试记录。 */
  readonly attempts: readonly FallbackAttempt[];
  /** 总耗时（毫秒）。 */
  readonly total_duration_ms: number;
}

/** 失败回退链（fallback.py ExternalAgentFallback）。 */
export class ExternalAgentFallback {
  /** 同 Provider 最大重试次数。 */
  readonly retryMaxAttempts: number;
  /** 重试退避间隔（秒）。 */
  readonly backoffSeconds: number;

  constructor(retryMaxAttempts = 3, backoffSeconds = 5.0) {
    this.retryMaxAttempts = retryMaxAttempts;
    this.backoffSeconds = backoffSeconds;
  }

  /** 默认 fallback 链（fallback.py get_default_chain）。 */
  getDefaultChain(): string[] {
    return [...DEFAULT_FALLBACK_CHAIN];
  }

  /**
   * 按 fallback 链调用（双层循环：provider × retry）。
   *
   * 语义（fallback.py with_fallback）：
   *   - 每个 Provider 最多重试 retryMaxAttempts 次；
   *   - 以 result.get('success') === true 判定成功；
   *   - 失败退避 backoffSeconds（最后一次尝试不退避）；
   *   - 全部失败返回 { success: false, attempts }。
   */
  async withFallback(
    providers: readonly string[],
    invokeFn: InvokeFn,
    task: string,
    context: Record<string, unknown>,
  ): Promise<FallbackResult> {
    const startedAt = Date.now();
    const attempts: FallbackAttempt[] = [];

    for (const providerName of providers) {
      for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt++) {
        const attemptStartedAt = Date.now();
        let success = false;
        let error = '';
        let result: Record<string, unknown> | null = null;
        try {
          const raw = await invokeFn(providerName, task, context);
          success = raw.success === true;
          if (success) {
            result = raw;
          } else {
            error = typeof raw.error === 'string' ? raw.error : 'unknown error';
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        attempts.push({
          provider_name: providerName,
          attempt,
          success,
          error,
          duration_ms: Date.now() - attemptStartedAt,
          timestamp: new Date().toISOString(),
        });
        if (success) {
          return {
            success: true,
            winning_provider: providerName,
            result,
            attempts,
            total_duration_ms: Date.now() - startedAt,
          };
        }
        // 失败退避（最后一次不退避）
        const isLastAttempt =
          attempt === this.retryMaxAttempts &&
          providerName === providers[providers.length - 1];
        if (!isLastAttempt) {
          await sleep(Math.round(this.backoffSeconds * 1000));
        }
      }
    }

    return {
      success: false,
      winning_provider: '',
      result: null,
      attempts,
      total_duration_ms: Date.now() - startedAt,
    };
  }
}
