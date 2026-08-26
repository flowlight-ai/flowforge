/**
 * state-updates — 统一状态输出语法（TS 重写自 `core/state_updates.py`，F27）。
 *
 * 所有 Agent 输出统一为 `state_updates: {key: expression}` 格式；
 * StateUpdateMapper 自动映射到工作流状态（支持嵌套路径设置）。
 *
 * @module @flowforge/core-state
 */

/** 状态更新映射器：将 Agent 的 state_updates 输出映射到工作流状态。 */
export class StateUpdateMapper {
  /**
   * 将 state_updates 应用到工作流状态（原地修改并返回）。
   *
   * @example
   * state = { stage: 'coding', artifacts: {} }
   * updates = { stage: 'review', 'artifacts.code': 'main.py' }
   * apply(state, updates)
   * // state = { stage: 'review', artifacts: { code: 'main.py' } }
   */
  static apply(
    state: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const [key, value] of Object.entries(updates)) {
      if (key.includes('.')) {
        StateUpdateMapper.setNested(state, key, value);
      } else {
        state[key] = value;
      }
    }
    return state;
  }

  /** 设置嵌套字典值（"artifacts.code" → state.artifacts.code）。 */
  static setNested(
    state: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const keys = path.split('.');
    let current: Record<string, unknown> = state;
    for (const key of keys.slice(0, -1)) {
      const next = current[key];
      if (next === undefined || typeof next !== 'object' || Array.isArray(next)) {
        const fresh: Record<string, unknown> = {};
        current[key] = fresh;
        current = fresh;
      } else {
        current = next as Record<string, unknown>;
      }
    }
    current[keys[keys.length - 1]!] = value;
  }

  /**
   * 从 Agent 结果中提取 state_updates。
   * 兼容旧格式（output/output_mapping）和新格式（state_updates）。
   */
  static extractOutputs(
    agentResult: Record<string, unknown>,
  ): Record<string, unknown> {
    const direct = agentResult['state_updates'];
    if (direct !== undefined && typeof direct === 'object') {
      return direct as Record<string, unknown>;
    }

    // 兼容旧格式
    const updates: Record<string, unknown> = {};
    if ('output' in agentResult) {
      updates['output'] = agentResult['output'];
    }
    const outputMapping = agentResult['output_mapping'];
    if (
      outputMapping !== undefined &&
      typeof outputMapping === 'object' &&
      !Array.isArray(outputMapping)
    ) {
      for (const [targetKey, sourcePath] of Object.entries(
        outputMapping as Record<string, unknown>,
      )) {
        let value: unknown = agentResult;
        for (const key of String(sourcePath).split('.')) {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            value = (value as Record<string, unknown>)[key];
          } else {
            value = null;
            break;
          }
        }
        if (value !== null) {
          updates[targetKey] = value;
        }
      }
    }
    return updates;
  }
}
