/**
 * @flowforge/external-agent guardrails/input-validation — L1 输入验证（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/input_validation.py：
 *   - InputValidationConfig: max_task_length=8192 / max_context_size=65536 /
 *     forbidden_patterns 8 个正则 / forbidden_path_patterns 6 个
 *   - ValidationResult: valid / violations / sanitized_input
 *   - InputValidationGuardrail.validate(task, context)：
 *     长度检查 → 危险模式 → 路径穿越 → 上下文危险模式
 */

/** 输入验证配置（input_validation.py InputValidationConfig）。 */
export interface InputValidationConfig {
  /** 任务描述最大长度。 */
  readonly max_task_length: number;
  /** 上下文最大字节数。 */
  readonly max_context_size: number;
  /** 危险模式正则列表。 */
  readonly forbidden_patterns: readonly string[];
  /** 禁止的路径模式（防路径穿越）。 */
  readonly forbidden_path_patterns: readonly string[];
}

/** 默认输入验证配置。 */
export const DEFAULT_INPUT_VALIDATION_CONFIG: InputValidationConfig = {
  max_task_length: 8192,
  max_context_size: 65536,
  forbidden_patterns: [
    String.raw`rm\s+-rf\s+/`,
    String.raw`\bsudo\b`,
    String.raw`chmod\s+777`,
    String.raw`curl\s+.*\|\s*sh`,
    String.raw`wget\s+.*\|\s*bash`,
    String.raw`<script[^>]*>`,
    'javascript:',
    'file:///',
  ],
  forbidden_path_patterns: [
    String.raw`\.\./`,
    String.raw`\.\.\\`,
    '/etc/passwd',
    '/etc/shadow',
    '~/.ssh',
    '%USERPROFILE%',
  ],
};

/** 输入验证结果（input_validation.py ValidationResult）。 */
export interface ValidationResult {
  /** 是否通过验证。 */
  readonly valid: boolean;
  /** 违规原因列表。 */
  readonly violations: readonly string[];
  /** 脱敏后的输入（未通过时为空串）。 */
  readonly sanitized_input: string;
}

/** L1 输入验证 Guardrail（input_validation.py InputValidationGuardrail）。 */
export class InputValidationGuardrail {
  private readonly _config: InputValidationConfig;
  private readonly _forbiddenRe: RegExp[];
  private readonly _pathRe: RegExp[];

  constructor(config?: Partial<InputValidationConfig>) {
    this._config = { ...DEFAULT_INPUT_VALIDATION_CONFIG, ...config };
    this._forbiddenRe = this._config.forbidden_patterns.map(
      (p) => new RegExp(p, 'i'),
    );
    this._pathRe = this._config.forbidden_path_patterns.map(
      (p) => new RegExp(p, 'i'),
    );
  }

  /** 验证输入是否安全。 */
  validate(task: string, context?: Record<string, unknown>): ValidationResult {
    const violations: string[] = [];

    // 1. 长度检查
    if (task.length > this._config.max_task_length) {
      violations.push(
        `task_length=${task.length} > max=${this._config.max_task_length}`,
      );
    }
    if (context) {
      const ctxSize = JSON.stringify(context).length;
      if (ctxSize > this._config.max_context_size) {
        violations.push(
          `context_size=${ctxSize} > max=${this._config.max_context_size}`,
        );
      }
    }

    // 2. 危险模式检查
    for (const pattern of this._forbiddenRe) {
      const match = pattern.exec(task);
      if (match) {
        violations.push(`forbidden_pattern matched: ${match[0]}`);
      }
    }

    // 3. 路径穿越检查
    for (const pattern of this._pathRe) {
      const match = pattern.exec(task);
      if (match) {
        violations.push(`forbidden_path_pattern matched: ${match[0]}`);
      }
    }

    // 4. 上下文中的危险模式检查
    if (context) {
      const ctxStr = JSON.stringify(context);
      for (const pattern of this._forbiddenRe) {
        if (pattern.test(ctxStr)) {
          violations.push(`forbidden_pattern in context: ${pattern.source}`);
        }
      }
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      sanitized_input: valid ? task : '',
    };
  }

  /** 当前配置。 */
  get config(): InputValidationConfig {
    return { ...this._config };
  }
}
