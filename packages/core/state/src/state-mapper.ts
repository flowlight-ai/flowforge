/**
 * state-mapper — State 参数映射（TS 重写自 `core/state_mapper.py`，F27/FWK-04）。
 *
 * 消除 Agent 中硬编码的参数注入逻辑：通过声明式映射规则自动从
 * state/extra/context 中提取参数，支持嵌套字段、列表索引、auto.*
 * 快捷路径和 8 种转换操作。
 *
 * @module @flowforge/core-state
 */

/** 缺失哨兵（区分 None 与缺失）。 */
export const MISSING = Symbol('MISSING');

/** 单个参数映射规则。 */
export interface ParamMapping {
  /** 目标参数名（传给 Agent 的参数名）。 */
  paramName: string;
  /** 源路径，如 "state.topic_list[0]" 或 "auto.persona"。 */
  source: string;
  /** 是否必须（缺失时是否报错）。 */
  required: boolean;
  /** 默认值（当源路径不存在且 required=false 时使用）。 */
  default: unknown;
  /** 可选转换：json_parse / str_join / first / last / len / str / lower / upper。 */
  transform?: string;
}

/** 参数映射构造选项（source 必填，其余可选）。 */
export interface ParamMappingInput {
  paramName: string;
  source: string;
  required?: boolean;
  default?: unknown;
  transform?: string;
}

/** State 参数映射器：按映射规则从 state 中提取并填充 Agent 输入。 */
export class StateMapper {
  private readonly mappings: ParamMapping[];
  private readonly sourceCache = new Map<string, string[]>();

  constructor(mappings: ParamMapping[]) {
    this.mappings = mappings;
  }

  /**
   * 根据映射规则从 state 中提取参数，返回 params 字典。
   *
   * @param state 当前任务状态字典。
   * @param extra 额外输入参数（对应 input. 前缀）。
   */
  apply(
    state: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const mapping of this.mappings) {
      try {
        let value = this.resolveSource(mapping.source, state, extra);
        if (value === MISSING) {
          if (mapping.required) {
            // 必需参数缺失 → 跳过（对齐 Python warning 后 continue）
            continue;
          }
          value = mapping.default;
        }
        if (value !== MISSING && mapping.transform) {
          value = this.applyTransform(value, mapping.transform);
        }
        if (value !== MISSING) {
          params[mapping.paramName] = value;
        }
      } catch (e) {
        if (mapping.required) {
          throw e;
        }
      }
    }
    return params;
  }

  /**
   * 解析源路径，提取值。
   *
   * 支持的路径格式：state.field / state.nested.field / state.list[0] /
   * auto.persona|soul|memory|creation / input.field / context.field。
   */
  resolveSource(
    source: string,
    state: Record<string, unknown>,
    extra: Record<string, unknown>,
  ): unknown {
    if (source.startsWith('state.')) {
      return this.traversePath(state, source.slice('state.'.length));
    }
    if (source.startsWith('auto.')) {
      return this.resolveAuto(source.slice('auto.'.length), state);
    }
    if (source.startsWith('input.')) {
      return this.traversePath(extra, source.slice('input.'.length));
    }
    if (source.startsWith('context.')) {
      const contextData = (state['context_data'] ?? {}) as Record<string, unknown>;
      return this.traversePath(contextData, source.slice('context.'.length));
    }
    // 兜底：直接从 state 中取
    return this.traversePath(state, source);
  }

  /**
   * 沿路径遍历字典，支持嵌套字段和列表索引。
   *
   * @example
   * traversePath(data, 'topic_list[0]')   // → data.topic_list[0]
   * traversePath(data, 'items[2].name')   // → data.items[2].name
   */
  traversePath(data: unknown, path: string): unknown {
    if (data === null || data === undefined) {
      return MISSING;
    }
    const segments = this.parsePath(path);
    let current: unknown = data;
    for (const seg of segments) {
      if (current === null || current === undefined || current === MISSING) {
        return MISSING;
      }
      if (seg.startsWith('[') && seg.endsWith(']')) {
        // 列表索引
        const index = Number.parseInt(seg.slice(1, -1), 10);
        if (Number.isNaN(index)) {
          return MISSING;
        }
        if (Array.isArray(current) && -current.length <= index && index < current.length) {
          current = current[index];
        } else {
          return MISSING;
        }
      } else if (
        typeof current === 'object' &&
        !Array.isArray(current) &&
        seg in (current as Record<string, unknown>)
      ) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        return MISSING;
      }
    }
    return current;
  }

  /** 将路径字符串解析为段列表："topic_list[0].name" → ["topic_list", "[0]", "name"]。 */
  parsePath(path: string): string[] {
    const cached = this.sourceCache.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const segments: string[] = [];
    const tokens = path.match(/[^.\[\]]+|\[\d+\]/g) ?? [];
    for (const token of tokens) {
      segments.push(token);
    }
    this.sourceCache.set(path, segments);
    return segments;
  }

  /** 解析 auto.* 快捷路径（persona/soul/memory/creation）。 */
  resolveAuto(
    key: string,
    state: Record<string, unknown>,
  ): unknown {
    const autoMap: Record<string, string> = {
      persona: 'state.persona',
      soul: 'state.style_profile.soul',
      memory: 'state.style_profile.memory',
      creation: 'state.style_profile.creation',
    };
    const mappedSource = autoMap[key];
    if (mappedSource !== undefined) {
      return this.resolveSource(mappedSource, state, {});
    }
    return MISSING;
  }

  /** 对值应用转换操作（json_parse/str_join/first/last/len/str/lower/upper）。 */
  static applyTransform(value: unknown, transform: string): unknown {
    try {
      switch (transform) {
        case 'json_parse':
          return typeof value === 'string' ? JSON.parse(value) : value;
        case 'str_join':
          return Array.isArray(value) ? value.map(String).join('\n') : String(value);
        case 'first':
          return Array.isArray(value) && value.length > 0 ? value[0] : value;
        case 'last':
          return Array.isArray(value) && value.length > 0 ? value[value.length - 1] : value;
        case 'len':
          return value === null || value === undefined ? 0 : Array.isArray(value) ? value.length : typeof value === 'string' ? value.length : 0;
        case 'str':
          return value === null || value === undefined ? '' : String(value);
        case 'lower':
          return value === null || value === undefined ? '' : String(value).toLowerCase();
        case 'upper':
          return value === null || value === undefined ? '' : String(value).toUpperCase();
        default:
          return value;
      }
    } catch {
      return value;
    }
  }

  private applyTransform(value: unknown, transform: string): unknown {
    return StateMapper.applyTransform(value, transform);
  }

  /** 从配置字典创建 StateMapper：{paramName: sourcePath}。 */
  static fromConfig(config: Record<string, string>): StateMapper {
    const mappings: ParamMapping[] = Object.entries(config).map(
      ([paramName, source]) => ({
        paramName,
        source,
        required: true,
        default: null,
      }),
    );
    return new StateMapper(mappings);
  }
}
