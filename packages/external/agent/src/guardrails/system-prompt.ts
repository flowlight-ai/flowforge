/**
 * @flowforge/external-agent guardrails/system-prompt — L2 系统提示约束（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/system_prompt.py：
 *   - SystemPromptConfig: boundary_template（默认 6 条边界）/
 *     inject_position（prefix / suffix）
 *   - SystemPromptGuardrail.inject(original_prompt, context)：
 *     {{key}} 模板渲染 + prefix/suffix 注入
 *   - getBoundaryTemplate / updateBoundaryTemplate（prompts.yaml 加载时调用）
 */

/** 系统提示约束配置（system_prompt.py SystemPromptConfig）。 */
export interface SystemPromptConfig {
  /** 边界声明模板（实际值从 config/prompts.yaml 加载）。 */
  readonly boundary_template: string;
  /** 注入位置：prefix / suffix。 */
  readonly inject_position: 'prefix' | 'suffix';
}

/** 默认边界声明模板（system_prompt.py 缺省值）。 */
export const DEFAULT_BOUNDARY_TEMPLATE =
  '[FlowForge 边界声明]\n' +
  '你是Forgekin调用的三方 Agent，必须遵守以下边界：\n' +
  '1. 禁止绕过审计——所有操作必须记录到 worktree.audit\n' +
  '2. 禁止越权——仅可访问 sandbox.cwd 内文件\n' +
  '3. 禁止修改 VISION.md / rules.md / 铁律文件\n' +
  '4. 不可逆操作（merge/release/delete）必须等待 operator 确认\n' +
  '5. 成本上限：单次调用不超过 {{cost_ceiling}} token\n' +
  '6. 输出必须可被 lint + 测试校验\n';

/** L2 系统提示约束 Guardrail（system_prompt.py SystemPromptGuardrail）。 */
export class SystemPromptGuardrail {
  private _config: SystemPromptConfig;

  constructor(config?: Partial<SystemPromptConfig>) {
    this._config = {
      boundary_template: DEFAULT_BOUNDARY_TEMPLATE,
      inject_position: 'prefix',
      ...config,
    };
  }

  /**
   * 注入边界声明到 system prompt（{{key}} 模板渲染 + prefix/suffix 注入）。
   */
  inject(originalPrompt: string, context: Record<string, unknown> = {}): string {
    let boundary = this._config.boundary_template;
    for (const [key, value] of Object.entries(context)) {
      boundary = boundary.replaceAll(`{{${key}}}`, String(value));
    }
    if (this._config.inject_position === 'prefix') {
      return `${boundary}\n${originalPrompt}`;
    }
    return `${originalPrompt}\n\n${boundary}`;
  }

  /** 返回边界声明模板（供 prompts.yaml 加载时校验）。 */
  getBoundaryTemplate(): string {
    return this._config.boundary_template;
  }

  /** 更新边界声明模板（从 prompts.yaml 加载时调用）。 */
  updateBoundaryTemplate(template: string): void {
    this._config = { ...this._config, boundary_template: template };
  }

  /** 当前配置。 */
  get config(): SystemPromptConfig {
    return { ...this._config };
  }
}
