/**
 * @flowforge/external-agent guardrails/action-confirm — L5 操作确认（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/action_confirm.py：
 *   - ActionConfirmConfig: irreversible_patterns 15 个 / auto_approved_patterns 7 个
 *   - ConfirmResult: action_required / operation / reason / auto_approved
 *   - ActionConfirmGuardrail.check(operation)：先查 auto_approved →
 *     irreversible → 默认自动批准；confirm(operation, context)：
 *     confirm_callback 注入，无回调时默认拒绝（安全优先）
 */

/** 操作确认配置（action_confirm.py ActionConfirmConfig）。 */
export interface ActionConfirmConfig {
  /** 需要确认的不可逆操作模式（正则）。 */
  readonly irreversible_patterns: readonly string[];
  /** 自动批准的非不可逆操作（如 lint / test）。 */
  readonly auto_approved_patterns: readonly string[];
}

/** 默认操作确认配置。 */
export const DEFAULT_ACTION_CONFIRM_CONFIG: ActionConfirmConfig = {
  irreversible_patterns: [
    String.raw`git\s+push`,
    String.raw`git\s+merge`,
    String.raw`git\s+rebase`,
    String.raw`git\s+reset\s+--hard`,
    String.raw`git\s+clean\s+-fd`,
    String.raw`git\s+branch\s+-D`,
    String.raw`rm\s+-rf`,
    String.raw`rmdir\s+/s`,
    String.raw`del\s+/f`,
    String.raw`docker\s+rm`,
    String.raw`kubectl\s+delete`,
    String.raw`terraform\s+destroy`,
    String.raw`release\s+publish`,
    String.raw`npm\s+publish`,
    String.raw`pip\s+upload`,
  ],
  auto_approved_patterns: [
    String.raw`git\s+status`,
    String.raw`git\s+diff`,
    'pytest',
    'ruff',
    'mypy',
    String.raw`npm\s+test`,
    String.raw`npm\s+run\s+lint`,
  ],
};

/** 操作确认结果（action_confirm.py ConfirmResult）。 */
export interface ConfirmResult {
  /** 是否需要 operator 确认。 */
  readonly action_required: boolean;
  /** 请求的操作。 */
  readonly operation: string;
  /** 需要确认的原因。 */
  readonly reason: string;
  /** 是否自动批准（非不可逆操作）。 */
  readonly auto_approved: boolean;
}

/** operator 确认回调类型（(operation, reason) => bool）。 */
export type ConfirmCallback = (
  operation: string,
  reason: string,
) => Promise<boolean>;

/** L5 操作确认 Guardrail（action_confirm.py ActionConfirmGuardrail）。 */
export class ActionConfirmGuardrail {
  private readonly _config: ActionConfirmConfig;
  private readonly _confirmCallback?: ConfirmCallback;
  private readonly _irreversibleRe: RegExp[];
  private readonly _autoApprovedRe: RegExp[];

  constructor(
    config?: Partial<ActionConfirmConfig>,
    confirmCallback?: ConfirmCallback,
  ) {
    this._config = { ...DEFAULT_ACTION_CONFIRM_CONFIG, ...config };
    if (confirmCallback !== undefined) {
      this._confirmCallback = confirmCallback;
    }
    this._irreversibleRe = this._config.irreversible_patterns.map(
      (p) => new RegExp(p, 'i'),
    );
    this._autoApprovedRe = this._config.auto_approved_patterns.map(
      (p) => new RegExp(p, 'i'),
    );
  }

  /**
   * 检查操作是否需要 operator 确认（action_confirm.py check）：
   *   ① auto_approved 直接批准
   *   ② irreversible 需要确认
   *   ③ 其他默认自动批准
   */
  check(operation: string): ConfirmResult {
    // 1. 检查是否自动批准
    for (const pattern of this._autoApprovedRe) {
      if (pattern.test(operation)) {
        return {
          action_required: false,
          operation,
          auto_approved: true,
          reason: 'auto_approved (non-irreversible)',
        };
      }
    }

    // 2. 检查是否是不可逆操作
    for (const pattern of this._irreversibleRe) {
      if (pattern.test(operation)) {
        return {
          action_required: true,
          operation,
          auto_approved: false,
          reason: `irreversible_pattern matched: ${pattern.source}`,
        };
      }
    }

    // 3. 默认自动批准（非不可逆操作）
    return {
      action_required: false,
      operation,
      auto_approved: true,
      reason: 'default auto-approved',
    };
  }

  /**
   * 请求 operator 确认不可逆操作（action_confirm.py confirm）。
   * 无 confirm_callback 时默认拒绝（安全优先）。
   */
  async confirm(
    operation: string,
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    const result = this.check(operation);
    if (!result.action_required) {
      return true; // 自动批准
    }
    if (this._confirmCallback === undefined) {
      return false; // 无回调时默认拒绝
    }
    let reason = result.reason;
    if (context) {
      reason = `${reason} | context=${JSON.stringify(context)}`;
    }
    return this._confirmCallback(operation, reason);
  }

  /** 当前配置。 */
  get config(): ActionConfirmConfig {
    return { ...this._config };
  }
}
