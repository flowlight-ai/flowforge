/**
 * attribution — 七类归因矩阵（对齐 Python core/eval/attribution.py，F020）。
 *
 * 归因不是"agent 没做好"（roleagent.md §5.4），而是定位到七类根因之一：
 * 1. harness 错位（HARNESS_MISALIGNMENT）
 * 2. 工具缺口（TOOL_GAP）
 * 3. 模型盲点（MODEL_BLIND_SPOT）
 * 4. 数据缺失（DATA_MISSING）
 * 5. 愿景缺口（VISION_GAP）
 * 6. 协作失败（COLLABORATION_FAILURE）
 * 7. 资源耗尽（RESOURCE_EXHAUSTION）
 *
 * 关键设计原则：禁止笼统归因；必须定位到七类之一；归因基于证据不靠猜测。
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

/** 七类归因类别——Eval 失败必须归因到其中之一。 */
export enum AttributionCategory {
  /** harness 错位——组件路由/调度/状态面错位 */
  HARNESS_MISALIGNMENT = 'harness_misalignment',
  /** 工具缺口——缺少必要工具或工具能力不足 */
  TOOL_GAP = 'tool_gap',
  /** 模型盲点——模型固有认知盲点导致 */
  MODEL_BLIND_SPOT = 'model_blind_spot',
  /** 数据缺失——上下文/记忆/检索数据缺失 */
  DATA_MISSING = 'data_missing',
  /** 愿景缺口——与愿景/目标/spec 方向偏离 */
  VISION_GAP = 'vision_gap',
  /** 协作失败——跨 agent 协作/交接/协议失败 */
  COLLABORATION_FAILURE = 'collaboration_failure',
  /** 资源耗尽——超时/配额/内存/token 耗尽 */
  RESOURCE_EXHAUSTION = 'resource_exhaustion',
}

/** 枚举定义顺序（平票时选首个 / 零匹配兜底遍历用） */
export const ATTRIBUTION_CATEGORY_ORDER: readonly AttributionCategory[] = [
  AttributionCategory.HARNESS_MISALIGNMENT,
  AttributionCategory.TOOL_GAP,
  AttributionCategory.MODEL_BLIND_SPOT,
  AttributionCategory.DATA_MISSING,
  AttributionCategory.VISION_GAP,
  AttributionCategory.COLLABORATION_FAILURE,
  AttributionCategory.RESOURCE_EXHAUSTION,
];

export interface AttributionReportInit {
  readonly failure_id?: string | undefined;
  readonly category: AttributionCategory;
  readonly root_cause: string;
  readonly evidence?: readonly string[];
  readonly recommendation: string;
  readonly confidence?: number;
  readonly attributed_at?: string;
}

/** 归因报告——Eval 失败的根因定位结果。 */
export class AttributionReport {
  readonly failure_id: string;
  readonly category: AttributionCategory;
  readonly root_cause: string;
  readonly evidence: string[];
  readonly recommendation: string;
  /** 归因置信度（0.0-1.0，基于证据强度） */
  readonly confidence: number;
  readonly attributed_at: string;

  constructor(init: AttributionReportInit) {
    this.failure_id = init.failure_id ?? `fail-${randomBytes(6).toString('hex')}`;
    this.category = init.category;
    this.root_cause = init.root_cause;
    this.evidence = [...(init.evidence ?? [])];
    this.recommendation = init.recommendation;
    this.confidence = init.confidence ?? 0.5;
    this.attributed_at = init.attributed_at ?? new Date().toISOString();
  }
}

// ========== 默认归因规则（keyword-based）==========

/** 构建默认归因关键词规则：匹配数最多的类别为归因结果。 */
export function buildDefaultRules(): Record<AttributionCategory, string[]> {
  return {
    [AttributionCategory.HARNESS_MISALIGNMENT]: [
      'harness', 'route', 'router', 'dispatch', 'ownership',
      'state surface', 'durable state', 'wrong agent',
      'component mismatch', 'routing', 'misalign',
      'state_updates', 'canonical read',
    ],
    [AttributionCategory.TOOL_GAP]: [
      'tool', 'missing tool', 'tool not found', 'tool unavailable',
      'no tool', 'tool gap', 'tool boundary', 'tool forbidden',
      'tool registry', 'tool_missing',
    ],
    [AttributionCategory.MODEL_BLIND_SPOT]: [
      'hallucinat', 'blind spot', 'blindspot', 'model limitation',
      'reasoning failure', 'model error', 'cognitive',
      'self referential', 'over confidence', 'overconfidence',
      'context compression', 'model blind',
    ],
    [AttributionCategory.DATA_MISSING]: [
      'data missing', 'no data', 'empty context', 'retrieval fail',
      'memory empty', 'context missing', 'no context',
      'data not found', 'retrieval empty', 'memory missing',
      'rag fail', 'no result',
    ],
    [AttributionCategory.VISION_GAP]: [
      'vision', 'direction', 'off track', 'off-track',
      'goal mismatch', 'spec drift', 'spec mismatch',
      'requirements mismatch', 'north star', 'cvo',
      'vision misalign', 'goal drift',
    ],
    [AttributionCategory.COLLABORATION_FAILURE]: [
      'handoff', 'collaboration', 'coordination', 'protocol',
      'agent conflict', 'deadlock', 'pingpong', 'ping-pong',
      '交接', 'capsule', 'ball custody', 'push back',
      'teamact', 'no response',
    ],
    [AttributionCategory.RESOURCE_EXHAUSTION]: [
      'timeout', 'timed out', 'quota', 'rate limit', 'ratelimit',
      'memory', 'oom', 'out of memory', 'token',
      'exhausted', 'capacity', 'limit exceeded', 'throttl',
    ],
  };
}

// ========== 默认文案（fallback，当模板未注入时使用）==========

export const DEFAULT_ROOT_CAUSES: Record<AttributionCategory, string> = {
  [AttributionCategory.HARNESS_MISALIGNMENT]:
    'harness 组件路由/调度/状态面错位，导致 agent 持球与任务不匹配',
  [AttributionCategory.TOOL_GAP]:
    '缺少必要工具或工具能力不足，agent 无法完成现实闭环',
  [AttributionCategory.MODEL_BLIND_SPOT]:
    '模型固有认知盲点导致错误，需跨厂商 review 补偿',
  [AttributionCategory.DATA_MISSING]:
    '上下文/记忆/检索数据缺失，agent 在信息不完整下决策',
  [AttributionCategory.VISION_GAP]:
    '产出与愿景/目标/spec 方向偏离，愿景收敛未达成',
  [AttributionCategory.COLLABORATION_FAILURE]:
    '跨 agent 协作/交接/协议失败，TeamAct 循环断裂',
  [AttributionCategory.RESOURCE_EXHAUSTION]:
    '超时/配额/内存/token 耗尽，资源约束导致中断',
};

export const DEFAULT_RECOMMENDATIONS: Record<AttributionCategory, string> = {
  [AttributionCategory.HARNESS_MISALIGNMENT]:
    '调整 harness 组件配置/路由规则/状态面映射，确保 agent 持球与任务匹配',
  [AttributionCategory.TOOL_GAP]:
    '补充缺失工具/升级工具能力/调整工具边界授权',
  [AttributionCategory.MODEL_BLIND_SPOT]:
    '启用跨厂商 review 补偿/更换模型/加 guardrail 拦截盲点',
  [AttributionCategory.DATA_MISSING]:
    '补充数据/修复检索入口/加载所需知识包/修复记忆召回',
  [AttributionCategory.VISION_GAP]:
    '对齐愿景方向/修正 spec/升级 CVO 确认，禁止 proxy 替代愿景收敛',
  [AttributionCategory.COLLABORATION_FAILURE]:
    '修复交接胶囊/调整路由/修复协作协议，检查 TeamAct 终止条件',
  [AttributionCategory.RESOURCE_EXHAUSTION]:
    '提高配额/优化 token 账本/启用降级处理/调整超时阈值',
};

interface AttributionTemplates {
  root_causes: Record<string, string>;
  recommendations: Record<string, string>;
}

/**
 * 加载归因文案模板（root_cause / recommendation）。
 * 铁律 5+P16：文案模板外置到 YAML，路径为 null / 文件不存在 / 解析失败均返回空模板
 * （调用方走 fallback 默认逻辑）。
 */
export function loadAttributionTemplates(promptsPath: string | null | undefined): AttributionTemplates {
  if (!promptsPath || !existsSync(promptsPath)) {
    return { root_causes: {}, recommendations: {} };
  }
  try {
    const data = (parseYaml(readFileSync(promptsPath, 'utf-8')) ?? {}) as Record<string, unknown>;
    return {
      root_causes: { ...((data['attribution_root_causes'] ?? {}) as Record<string, string>) },
      recommendations: { ...((data['attribution_recommendations'] ?? {}) as Record<string, string>) },
    };
  } catch {
    return { root_causes: {}, recommendations: {} };
  }
}

export interface AttributorOptions {
  /** prompts YAML 路径（外置文案模板）。不注入则走默认文案 */
  readonly promptsPath?: string | undefined;
  /** 自定义归因关键词规则。不提供则使用默认规则 */
  readonly rules?: Record<AttributionCategory, string[]> | undefined;
}

/**
 * 七类归因器——将 Eval 失败定位到具体根因类别（maturity=experimental）。
 *
 * 归因策略：
 * 1. 将 failure_data 递归展平为小写文本
 * 2. 按七类关键词规则扫描匹配
 * 3. 匹配数最多的类别为归因结果（平票按枚举顺序选首个）
 * 4. 若有 category_hint 字段，加权该类别（+1 匹配）
 * 5. 文案优先从外置 YAML 模板渲染（铁律 5+P16），回退到默认文案
 */
export class Attributor {
  private readonly rules: Record<AttributionCategory, string[]>;
  private readonly templates: AttributionTemplates;

  constructor(options: AttributorOptions = {}) {
    this.rules = options.rules ?? buildDefaultRules();
    this.templates = loadAttributionTemplates(options.promptsPath);
  }

  /**
   * 对 Eval 失败进行七类归因。
   *
   * @param failureData 失败数据。推荐字段：failure_id / component_ref /
   *   error_message / error / trace / signals / category_hint / context
   */
  async attribute(failureData: Record<string, unknown>): Promise<AttributionReport> {
    // 1. 提取文本特征
    const text = this.extractText(failureData);

    // 2. 七类关键词匹配
    const scores = new Map<AttributionCategory, string[]>();
    for (const category of ATTRIBUTION_CATEGORY_ORDER) {
      const keywords = this.rules[category] ?? [];
      const matched = keywords.filter((kw) => text.includes(kw.toLowerCase()));
      scores.set(category, matched);
    }

    // 3. category_hint 加权（+1 匹配）
    const hint = failureData['category_hint'];
    if (typeof hint === 'string' && hint.length > 0) {
      if ((Object.values(AttributionCategory) as string[]).includes(hint)) {
        const hintCat = hint as AttributionCategory;
        const list = scores.get(hintCat) ?? [];
        list.push('(category_hint)');
        scores.set(hintCat, list);
      }
      // 无效 hint 忽略（对齐 Python warning）
    }

    // 4. 选取匹配数最多的类别
    const bestCategory = this.selectBestCategory(scores);

    // 5. 生成文案（优先模板，回退默认）
    const rootCause = this.renderTemplate('root_causes', bestCategory, DEFAULT_ROOT_CAUSES, failureData);
    const recommendation = this.renderTemplate('recommendations', bestCategory, DEFAULT_RECOMMENDATIONS, failureData);

    // 6. 证据 = 匹配到的关键词
    const evidence = [...(scores.get(bestCategory) ?? [])];

    // 7. 置信度 = min(1.0, 0.3 + 0.2 * 证据数)
    const confidence = Math.round(Math.min(1.0, 0.3 + 0.2 * evidence.length) * 100) / 100;

    // 8. 失败 ID（优先用 failure_data 中的）
    const failureId = typeof failureData['failure_id'] === 'string' && failureData['failure_id']
      ? failureData['failure_id']
      : undefined;

    return new AttributionReport({
      failure_id: failureId,
      category: bestCategory,
      root_cause: rootCause,
      evidence,
      recommendation,
      confidence,
    });
  }

  /** 将 failure_data 递归展平为小写文本用于关键词扫描。 */
  private extractText(failureData: unknown): string {
    const parts: string[] = [];
    const flatten = (obj: unknown): void => {
      if (obj === null || obj === undefined) {
        return;
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          flatten(item);
        }
      } else if (typeof obj === 'object') {
        for (const v of Object.values(obj as Record<string, unknown>)) {
          flatten(v);
        }
      } else if (typeof obj === 'string') {
        parts.push(obj);
      } else {
        parts.push(String(obj));
      }
    };
    flatten(failureData);
    return parts.join(' ').toLowerCase();
  }

  /** 选取匹配数最多的类别。平票按枚举定义顺序选首个；全 0 兜底 HARNESS_MISALIGNMENT。 */
  private selectBestCategory(scores: Map<AttributionCategory, string[]>): AttributionCategory {
    let bestCat = AttributionCategory.HARNESS_MISALIGNMENT;
    let bestCount = -1;
    for (const category of ATTRIBUTION_CATEGORY_ORDER) {
      const count = (scores.get(category) ?? []).length;
      if (count > bestCount) {
        bestCount = count;
        bestCat = category;
      }
    }
    return bestCat;
  }

  /** 渲染文案——优先外置 YAML 模板，回退到默认文案（铁律 5+P16）。 */
  private renderTemplate(
    templateGroup: 'root_causes' | 'recommendations',
    category: AttributionCategory,
    defaults: Record<AttributionCategory, string>,
    failureData: Record<string, unknown>,
  ): string {
    const template = this.templates[templateGroup][category];
    const fallback = defaults[category];
    if (template) {
      const componentRef = typeof failureData['component_ref'] === 'string' ? failureData['component_ref'] : '(unknown)';
      const failureId = typeof failureData['failure_id'] === 'string' ? failureData['failure_id'] : '(unknown)';
      const error =
        typeof failureData['error_message'] === 'string'
          ? failureData['error_message']
          : typeof failureData['error'] === 'string'
            ? failureData['error']
            : '';
      return template
        .replaceAll('{component_ref}', componentRef)
        .replaceAll('{failure_id}', failureId)
        .replaceAll('{error}', error);
    }
    return fallback;
  }
}
