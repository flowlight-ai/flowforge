/**
 * @flowforge/external-agent guardrails/output-validation — L4 输出验证（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/output_validation.py：
 *   - OutputValidationConfig: sensitive_patterns 6 个 / max_output_length=1MB /
 *     require_lintable=false
 *   - OutputValidationResult: valid / violations / sanitized_output（mask）
 *   - OutputValidationGuardrail.validate(output, sandboxCwd?)：
 *     长度检查 → 敏感信息检查（[REDACTED] 脱敏）→ 路径越界 → lint 检查
 */

/** 输出验证配置（output_validation.py OutputValidationConfig）。 */
export interface OutputValidationConfig {
  /** 输出中禁止出现的敏感模式。 */
  readonly sensitive_patterns: readonly string[];
  /** 输出最大长度（防 DoS，1MB）。 */
  readonly max_output_length: number;
  /** 是否要求输出可被 lint（代码场景）。 */
  readonly require_lintable: boolean;
}

/** 默认输出验证配置。 */
export const DEFAULT_OUTPUT_VALIDATION_CONFIG: OutputValidationConfig = {
  sensitive_patterns: [
    String.raw`sk-[a-zA-Z0-9]{20,}`, // OpenAI API key
    String.raw`anthropic-[a-zA-Z0-9]{20,}`, // Anthropic API key
    String.raw`AKIA[0-9A-Z]{16}`, // AWS access key
    String.raw`-----BEGIN [A-Z ]+PRIVATE KEY-----`, // private key
    String.raw`password\s*[:=]\s*\S+`, // password
    String.raw`token\s*[:=]\s*\S+`, // token
  ],
  max_output_length: 1048576,
  require_lintable: false,
};

/** 输出验证结果（output_validation.py OutputValidationResult）。 */
export interface OutputValidationResult {
  /** 是否通过验证。 */
  readonly valid: boolean;
  /** 违规原因列表。 */
  readonly violations: readonly string[];
  /** 脱敏后的输出（敏感信息已 mask）。 */
  readonly sanitized_output: unknown;
}

/** L4 输出验证 Guardrail（output_validation.py OutputValidationGuardrail）。 */
export class OutputValidationGuardrail {
  private readonly _config: OutputValidationConfig;
  private readonly _sensitiveRe: RegExp[];

  constructor(config?: Partial<OutputValidationConfig>) {
    this._config = { ...DEFAULT_OUTPUT_VALIDATION_CONFIG, ...config };
    this._sensitiveRe = this._config.sensitive_patterns.map(
      (p) => new RegExp(p, 'i'),
    );
  }

  /**
   * 验证输出是否安全（output_validation.py validate）。
   *
   * @param output 三方 Agent 的原始输出。
   * @param sandboxCwd sandbox 工作目录（用于检查路径越界）。
   */
  validate(output: unknown, sandboxCwd?: string): OutputValidationResult {
    const violations: string[] = [];
    const outputStr = typeof output === 'string' ? output : String(output);

    // 1. 长度检查
    if (outputStr.length > this._config.max_output_length) {
      violations.push(
        `output_length=${outputStr.length} > max=${this._config.max_output_length}`,
      );
    }

    // 2. 敏感信息检查（脱敏：替换为 [REDACTED]）
    let sanitized = outputStr;
    for (const pattern of this._sensitiveRe) {
      const matches = outputStr.match(pattern);
      if (matches) {
        violations.push(
          `sensitive_pattern matched: ${pattern.source} (${matches.length} occurrences)`,
        );
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
    }

    // 3. 路径越界检查（如配置了 sandboxCwd）
    if (sandboxCwd) {
      const pathPattern = /(?:^|\s)((?:\/[^\s:]+)|(?:[A-Za-z]:[\\/][^\s:]+))/g;
      for (const match of outputStr.matchAll(pathPattern)) {
        const path = match[1]!;
        if (!path.startsWith(sandboxCwd)) {
          violations.push(
            `path_outside_sandbox: ${path} (cwd=${sandboxCwd})`,
          );
        }
      }
    }

    // 4. lint 校验（如要求）
    if (this._config.require_lintable && typeof output === 'string') {
      if (
        !output.includes('```') &&
        !output.includes('def ') &&
        !output.includes('function ')
      ) {
        violations.push(
          'require_lintable=True but output contains no code blocks',
        );
      }
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      sanitized_output: valid ? output : sanitized,
    };
  }

  /** 当前配置。 */
  get config(): OutputValidationConfig {
    return { ...this._config };
  }
}
