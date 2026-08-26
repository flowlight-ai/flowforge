/**
 * field-condition-gate — 字段条件门禁（TS 重写自 `core/field_condition_gate.py`，F27）。
 *
 * 与基于 LLM 评估器的 GateOrchestrator 不同，FieldConditionGate 对状态字段
 * 执行确定性检查（not_empty / == true / length >= n / length == n / >= n）。
 *
 * Gate YAML 格式：
 * ```yaml
 * gates:
 *   concept_approved:
 *     type: field_condition
 *     next_status: concept_approved
 *     next_phase: outline
 *     checks:
 *       - field: concept_package.logline
 *         condition: not_empty
 *         message: 缺少一句话梗概
 *       - field: outline.outline_score
 *         condition: ">= 60"
 *         allow_missing: true
 * ```
 *
 * @module @flowforge/core-state
 */

import { parse as parseYaml } from 'yaml';

/** 单个检查项。 */
export interface FieldCheck {
  field: string;
  condition: string;
  allow_missing?: boolean;
  message?: string;
}

/** 门禁定义。 */
export interface FieldGateDefinition {
  type?: string;
  description?: string;
  next_status?: string;
  next_phase?: string;
  checks: FieldCheck[];
}

/** 检查结果。 */
export interface GateCheckResult {
  passed: boolean;
  gate?: string;
  failures: Array<{ field: string; condition: string; message: string }>;
  next_status?: string | null;
  next_phase?: string | null;
  reason?: string;
}

/** 确定性质量门禁：检查状态字段条件。 */
export class FieldConditionGate {
  private readonly gates: Record<string, FieldGateDefinition>;

  constructor(gatesConfig: Record<string, FieldGateDefinition> = {}) {
    this.gates = gatesConfig;
  }

  /** 已加载门禁数。 */
  get size(): number {
    return Object.keys(this.gates).length;
  }

  /** 门禁名称列表。 */
  listGates(): string[] {
    return Object.keys(this.gates);
  }

  /**
   * 检查命名门禁与给定状态。
   *
   * @returns {passed, gate, failures, next_status, next_phase}
   */
  check(gateName: string, state: Record<string, unknown>): GateCheckResult {
    const gate = this.gates[gateName];
    if (gate === undefined) {
      return {
        passed: false,
        reason: `Unknown gate: ${gateName}`,
        failures: [],
      };
    }

    const failures: GateCheckResult['failures'] = [];
    for (const check of gate.checks) {
      const value = resolveField(state, check.field);
      const ok = evaluate(value, check.condition, check.allow_missing ?? false);
      if (!ok) {
        failures.push({
          field: check.field,
          condition: check.condition,
          message:
            check.message ??
            `Field ${check.field} failed condition ${check.condition}`,
        });
      }
    }

    if (failures.length > 0) {
      return {
        passed: false,
        gate: gateName,
        failures,
        next_status: null,
        next_phase: null,
      };
    }
    return {
      passed: true,
      gate: gateName,
      failures: [],
      next_status: gate.next_status ?? null,
      next_phase: gate.next_phase ?? null,
    };
  }

  /** 从 YAML 内容加载门禁定义（to_phase → next_phase 规范化）。 */
  static fromYaml(yamlContent: string): FieldConditionGate {
    const data = parseYaml(yamlContent) as { gates?: Record<string, unknown> };
    const gatesData = data?.gates ?? {};
    const gates: Record<string, FieldGateDefinition> = {};
    for (const [name, def] of Object.entries(gatesData)) {
      if (def !== null && typeof def === 'object' && !Array.isArray(def)) {
        const gate = def as Record<string, unknown>;
        if ('to_phase' in gate && !('next_phase' in gate)) {
          gate['next_phase'] = gate['to_phase'];
        }
        gates[name] = gate as unknown as FieldGateDefinition;
      }
    }
    return new FieldConditionGate(gates);
  }
}

/** 解析点分字段路径（含数组索引）从 state 中取值。 */
export function resolveField(
  state: Record<string, unknown>,
  fieldPath: string,
): unknown {
  const parts = fieldPath.replaceAll(']', '').replaceAll('[', '.').split('.');
  let current: unknown = state;
  for (const part of parts) {
    if (part === '') {
      continue;
    }
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isNaN(index) && -current.length <= index && index < current.length) {
        current = current[index];
      } else {
        return null;
      }
    } else {
      return null;
    }
    if (current === null || current === undefined) {
      return null;
    }
  }
  return current;
}

/** 对解析值执行条件求值。 */
export function evaluate(
  value: unknown,
  condition: string,
  allowMissing = false,
): boolean {
  if (value === null || value === undefined) {
    return allowMissing;
  }
  if (condition === 'not_empty') {
    return Boolean(value);
  }
  if (condition === '== true') {
    return value === true;
  }
  if (condition.startsWith('length >= ')) {
    const threshold = Number.parseInt(condition.slice('length >= '.length), 10);
    return (value as ArrayLike<unknown>).length >= threshold;
  }
  if (condition.startsWith('length == ')) {
    const threshold = Number.parseInt(condition.slice('length == '.length), 10);
    return (value as ArrayLike<unknown>).length === threshold;
  }
  if (condition.startsWith('>= ')) {
    const threshold = Number.parseFloat(condition.slice('>= '.length));
    const num = Number(value);
    return !Number.isNaN(num) && num >= threshold;
  }
  return false;
}
