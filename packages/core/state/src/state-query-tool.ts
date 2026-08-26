/**
 * state-query-tool — 状态查询工具基类（TS 重写自 `core/state_query_tool.py`，F27）。
 *
 * 提供状态型查询工具的通用模式：
 * 1. 从 Memory 加载域状态
 * 2. 通过子类 _doSearch 查询
 * 3. 状态为空或结果稀疏时降级 web_search
 * 4. 可选 LLM 语义增强
 *
 * @module @flowforge/core-state
 */

/** Memory 最小接口。 */
export interface QueryMemoryLike {
  working: {
    get(key: string): unknown;
  };
}

/** web_search 工具最小接口。 */
export interface WebSearchLike {
  execute(input: {
    params: Record<string, unknown>;
  }): Promise<{ result: Record<string, unknown>; error?: string }>;
}

/** 工具输出。 */
export interface ToolOutputLike {
  result: Record<string, unknown>;
  error?: string;
}

/** 状态查询工具配置（子类覆盖的静态字段）。 */
export interface StateQueryToolConfig {
  /** 状态 key 模板，如 "novel:{novel_id}:world_state"。 */
  stateKeyTemplate?: string;
  /** dict 合并字段（update）。 */
  stateMergeFields?: string[];
  /** list 扩展字段（append）。 */
  stateListFields?: string[];
  /** scope 过滤参数名（如 "chapter_number"）。 */
  stateScopeField?: string;
}

/**
 * 状态查询工具基类 — 子类需设置 name/description 并可选覆盖
 * doSearch(query, entityId, scope, stateData) 实现结构化查询。
 */
export class StateQueryTool {
  /** 工具名（基类为空串，防止误注册）。 */
  readonly name: string;
  /** 工具描述。 */
  readonly description: string;

  protected readonly memory: QueryMemoryLike | undefined;
  protected readonly webSearch: WebSearchLike | undefined;
  protected readonly config: Required<StateQueryToolConfig>;

  constructor(
    options: {
      name?: string;
      description?: string;
      memory?: QueryMemoryLike;
      webSearch?: WebSearchLike;
    } & StateQueryToolConfig = {},
  ) {
    this.name = options.name ?? '';
    this.description = options.description ?? '';
    this.memory = options.memory;
    this.webSearch = options.webSearch;
    this.config = {
      stateKeyTemplate: options.stateKeyTemplate ?? '',
      stateMergeFields: options.stateMergeFields ?? [],
      stateListFields: options.stateListFields ?? [],
      stateScopeField: options.stateScopeField ?? '',
    };
  }

  /**
   * 执行查询：加载状态 → 域查询 → 空结果/无状态时 web_search 降级。
   */
  async execute(params: Record<string, unknown>): Promise<ToolOutputLike> {
    const query = String(params['query'] ?? '');
    const entityId = String(params['entity_id'] ?? params['novel_id'] ?? '');
    const scopeRaw = params['scope'] ?? params['chapter_number'] ?? 999;
    const scope = Number.isNaN(Number(scopeRaw)) ? 999 : Number(scopeRaw);
    if (query.trim() === '') {
      return { result: {}, error: 'query is required' };
    }

    // 从 Memory 加载状态
    const stateData = await this.loadState(entityId, scope);

    if (Object.keys(stateData).length > 0) {
      const result = await this.doSearch(query, entityId, scope, stateData);
      if (this.isEmptyResult(result)) {
        const fallback = await this.fallbackSearch(query);
        if (fallback.result['results'] !== undefined) {
          fallback.result['state_empty'] = true;
          fallback.result['hint'] =
            '状态数据为空，结果来自 web_search 降级。' +
            '请先产生内容，系统会自动提取实体并写入状态。';
        }
        return fallback;
      }
      return result;
    }

    // 无状态数据 → web_search 降级
    return this.fallbackSearch(query);
  }

  /** 从 Memory 加载状态数据：按 scope 过滤，按字段类型合并。 */
  async loadState(entityId: string, scope: number): Promise<Record<string, unknown>> {
    if (this.memory === undefined || this.config.stateKeyTemplate === '') {
      return {};
    }
    try {
      const key = this.config.stateKeyTemplate.replaceAll('{entity_id}', entityId);
      const rawData = this.memory.working.get(key);
      if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) {
        return {};
      }

      const merged: Record<string, unknown> = {};
      for (const [entryKey, entryData] of Object.entries(rawData as Record<string, unknown>)) {
        if (entryData === null || typeof entryData !== 'object' || Array.isArray(entryData)) {
          continue;
        }
        // Scope 过滤：跳过超出 scope 的条目
        if (this.config.stateScopeField !== '' && scope !== 999) {
          const entryNum = Number(entryKey);
          if (!Number.isNaN(entryNum) && entryNum > scope) {
            continue;
          }
        }
        const entry = entryData as Record<string, unknown>;
        // 合并 dict 字段（update）
        for (const field of this.config.stateMergeFields) {
          const fieldValue = entry[field];
          if (fieldValue !== undefined && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
            const existing = merged[field];
            if (existing !== undefined && typeof existing === 'object' && !Array.isArray(existing)) {
              Object.assign(existing as Record<string, unknown>, fieldValue);
            } else {
              merged[field] = { ...(fieldValue as Record<string, unknown>) };
            }
          }
        }
        // 合并 list 字段（extend）
        for (const field of this.config.stateListFields) {
          const fieldValue = entry[field];
          if (Array.isArray(fieldValue)) {
            const existing = merged[field];
            if (Array.isArray(existing)) {
              existing.push(...fieldValue);
            } else {
              merged[field] = [...fieldValue];
            }
          }
        }
      }
      return merged;
    } catch {
      return {};
    }
  }

  /** 检查结果是否为空（子类可覆盖）。 */
  isEmptyResult(result: ToolOutputLike): boolean {
    if (result.error) {
      return true;
    }
    const data = result.result;
    if (data === null || Object.keys(data).length === 0) {
      return true;
    }
    const keys = ['characters', 'events', 'foreshadowing', 'rules', 'locations', 'results', 'items'];
    for (const key of keys) {
      const val = data[key];
      if (
        val !== undefined &&
        val !== null &&
        ((Array.isArray(val) && val.length > 0) ||
          (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0))
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 在 stateData 中执行默认关键词查询（子类可覆盖）。
   * 默认：大小写不敏感关键词匹配，返回字段级命中列表。
   */
  async doSearch(
    query: string,
    entityId: string,
    scope: number,
    stateData: Record<string, unknown>,
  ): Promise<ToolOutputLike> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t !== '');
    if (terms.length === 0) {
      return { result: { results: [] } };
    }
    const results: Array<Record<string, unknown>> = [];
    for (const [field, value] of Object.entries(stateData)) {
      const matches = matchStateValue(terms, value);
      if (matches.length > 0) {
        results.push({ field, matches });
      }
    }
    return {
      result: {
        query,
        entity_id: entityId,
        scope,
        results,
        state_query: true,
      },
    };
  }

  /** 降级到 web_search（无可用工具时返回空结果）。 */
  async fallbackSearch(query: string): Promise<ToolOutputLike> {
    if (this.webSearch !== undefined) {
      try {
        const result = await this.webSearch.execute({
          params: { query, max_results: 5 },
        });
        const searchResults =
          result.result['results'] ?? result.result['items'] ?? [];
        return {
          result: {
            query,
            results: searchResults,
            source: 'web_search_fallback',
          },
        };
      } catch {
        // 降级失败 → 返回不可用标记
      }
    }
    return {
      result: { query, results: [], source: 'unavailable' },
    };
  }
}

/** 在单个 state 字段值中执行关键词匹配，返回命中的条目列表。 */
function matchStateValue(
  terms: string[],
  value: unknown,
): Array<Record<string, unknown>> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const hits: Array<Record<string, unknown>> = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (terms.some((t) => String(k).toLowerCase().includes(t) || String(v).toLowerCase().includes(t))) {
        hits.push({ key: k, value: v });
      }
    }
    return hits;
  }
  if (Array.isArray(value)) {
    const hits: Array<Record<string, unknown>> = [];
    for (const item of value) {
      if (terms.some((t) => String(item).toLowerCase().includes(t))) {
        hits.push({ value: item });
      }
    }
    return hits;
  }
  if (terms.some((t) => String(value).toLowerCase().includes(t))) {
    return [{ value }];
  }
  return [];
}
