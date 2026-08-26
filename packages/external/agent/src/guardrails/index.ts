/**
 * @flowforge/external-agent guardrails — 六层 Guardrails 统一出口（EX-005）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/__init__.py：
 *   - L1 InputValidationGuardrail（input_validation.py）
 *   - L2 SystemPromptGuardrail（system_prompt.py）
 *   - L3 ToolAllowlistGuardrail（tool_allowlist.py）
 *   - L4 OutputValidationGuardrail（output_validation.py）
 *   - L5 ActionConfirmGuardrail（action_confirm.py）
 *   - L6 CostCeilingGuardrail（cost_ceiling.py）
 */

export * from './input-validation.js';
export * from './system-prompt.js';
export * from './tool-allowlist.js';
export * from './output-validation.js';
export * from './action-confirm.js';
export * from './cost-ceiling.js';

/** 六层 Guardrail 组合容器（顺序 = 调用前 L1-L3 / 调用后 L4-L6）。 */
export interface GuardrailBundle {
  /** L1 输入验证（调用前）。 */
  readonly inputValidation: import('./input-validation.js').InputValidationGuardrail;
  /** L2 系统提示约束（调用前）。 */
  readonly systemPrompt: import('./system-prompt.js').SystemPromptGuardrail;
  /** L3 工具白名单（调用前）。 */
  readonly toolAllowlist: import('./tool-allowlist.js').ToolAllowlistGuardrail;
  /** L4 输出验证（调用后）。 */
  readonly outputValidation: import('./output-validation.js').OutputValidationGuardrail;
  /** L5 操作确认（调用前，不可逆操作）。 */
  readonly actionConfirm: import('./action-confirm.js').ActionConfirmGuardrail;
  /** L6 成本上限（调用前，EX-006）。 */
  readonly costCeiling: import('./cost-ceiling.js').CostCeilingGuardrail;
}
