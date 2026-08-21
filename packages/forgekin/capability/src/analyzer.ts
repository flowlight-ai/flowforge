/**
 * @flowforge/forgekin-capability — 阶段7 T7.2 ProfileAnalyzer 能力画像分析器
 *
 * 本地化自 flowforge Python `core/capability/analyzer.py`（412 行）：
 * 任务画像 × 能力画像 gap 分析、盲点冲突检测、跨厂商配对推荐。
 * 对应 ADR 004 §4（动态路由）+ §5（跨厂商 review）。
 *
 * 设计约束（Python 铁律 3/红线 9/红线 11 的 TS 等价）：
 * - 分析器是纯函数组合，不持有可变状态
 * - 推荐文案为内置 fallback 常量（模板注入点保留 options）
 *
 * @module @flowforge/forgekin-capability/analyzer
 */

import type { BlindSpotCategory, CognitiveStyle, SkillPackage } from './models.js';
import type { CapabilityProfile } from './profile.js';
import { registerGapAnalyzer } from './profile.js';

// ──────────────────────────────────────────────────────────────────────────────
// 任务画像（输入）
// ──────────────────────────────────────────────────────────────────────────────

export interface TaskProfile {
  /** 任务唯一标识 */
  taskId: string;
  /** 任务类型（如 code_generation / review / writing） */
  taskType: string;
  /** 任务需要的知识包名称列表 */
  requiredSkills: string[];
  /** 任务需要的工具列表 */
  requiredTools: string[];
  /** 任务禁忌盲点类别列表（若 Forgekin 在该类别有盲点，标记为风险） */
  forbiddenBlindSpotCategories: BlindSpotCategory[];
  /** 期望的解释风格列表（如 ['structured', 'concise']） */
  preferredCognitiveStyles: string[];
  /** 最小上下文窗口要求（token 数，undefined 表示不限制） */
  minContextWindow?: number;
}

export function makeTaskProfile(
  init: Pick<TaskProfile, 'taskId' | 'taskType'> & Partial<Omit<TaskProfile, 'taskId' | 'taskType'>>,
): TaskProfile {
  return {
    requiredSkills: [],
    requiredTools: [],
    forbiddenBlindSpotCategories: [],
    preferredCognitiveStyles: [],
    ...init,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Gap 报告（输出）
// ──────────────────────────────────────────────────────────────────────────────

export interface GapReport {
  /** 缺失的知识包名称列表（任务要求但 Forgekin 未加载） */
  missingSkills: string[];
  /** 缺失的工具列表（任务要求但 Forgekin 未被授权） */
  missingTools: string[];
  /** 盲点风险列表（每项是 [category, description] 元组） */
  blindSpotRisks: Array<[string, string]>;
  /** 上下文窗口是否不足 */
  contextWindowInsufficient: boolean;
  /** 认知风格是否不匹配 */
  cognitiveStyleMismatch: boolean;
  /** 建议文案列表（人类可读） */
  recommendations: string[];
}

export function makeGapReport(init?: Partial<GapReport>): GapReport {
  return {
    missingSkills: [],
    missingTools: [],
    blindSpotRisks: [],
    contextWindowInsufficient: false,
    cognitiveStyleMismatch: false,
    recommendations: [],
    ...init,
  };
}

/** 是否存在关键 gap（缺失技能/工具、盲点风险 或 上下文不足） */
export function hasCriticalGap(report: GapReport): boolean {
  return Boolean(
    report.missingSkills.length > 0
    || report.missingTools.length > 0
    || report.blindSpotRisks.length > 0
    || report.contextWindowInsufficient,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 推荐文案 fallback 模板（Python 端由 config/prompts.yaml 注入，TS 端内置 fallback）
// ──────────────────────────────────────────────────────────────────────────────

export interface RecommendationTemplates {
  missingSkill?: string;
  missingTool?: string;
  blindSpotRisk?: string;
  contextWindowInsufficient?: string;
  cognitiveMismatch?: string;
}

const DEFAULT_TEMPLATES: Required<RecommendationTemplates> = {
  missingSkill: '建议加载技能包: {skill}',
  missingTool: '建议授权工具: {tool}',
  blindSpotRisk: '警告: 任务禁忌盲点类别 \'{category}\' 与当前Forgekin盲点重叠（{desc}），建议跨厂商 review',
  contextWindowInsufficient: '上下文窗口不足: 需要 {required}, 实际 {actual}',
  cognitiveMismatch: '认知风格不匹配: 期望 {preferred}, 实际 {actual}',
};

function formatRecommendation(template: string | undefined, fallback: string, kwargs: Record<string, unknown>): string {
  if (template) {
    try {
      return template.replace(/\{(\w+)\}/g, (_m, key: string) => String(kwargs[key] ?? `{${key}}`));
    } catch {
      // fallthrough to fallback
    }
  }
  return fallback.replace(/\{(\w+)\}/g, (_m, key: string) => String(kwargs[key] ?? `{${key}}`));
}

// ──────────────────────────────────────────────────────────────────────────────
// ProfileAnalyzer 静态分析器
// ──────────────────────────────────────────────────────────────────────────────

export interface ProfileAnalyzerLike {
  computeGap(profile: CapabilityProfile, taskProfile: TaskProfile): GapReport;
  detectBlindSpotConflicts(candidates: CapabilityProfile[]): Array<[string, string, string]>;
  recommendPairing(author: CapabilityProfile, candidates: CapabilityProfile[]): CapabilityProfile | undefined;
}

export interface AnalyzerOptions {
  /** 推荐文案模板（缺省内置 fallback，对应 Python prompts.yaml 注入点） */
  readonly templates?: RecommendationTemplates | undefined;
}

export class ProfileAnalyzer implements ProfileAnalyzerLike {
  private readonly templates: RecommendationTemplates;

  constructor(options: AnalyzerOptions = {}) {
    this.templates = { ...DEFAULT_TEMPLATES, ...options.templates };
  }

  /**
   * 任务画像 × 能力画像 gap 分析。
   * 分析四类 gap：缺失技能 / 缺失工具 / 盲点风险 / 上下文窗口不足 + 认知风格不匹配。
   */
  computeGap(profile: CapabilityProfile, taskProfile: TaskProfile): GapReport {
    // 1. 缺失技能：任务要求但未加载的知识包
    const loadedSkills = new Set(profile.skillPackages.map((sp: SkillPackage) => sp.name));
    const missingSkills = taskProfile.requiredSkills.filter((s) => !loadedSkills.has(s));

    // 2. 缺失工具：不在白名单或在黑名单
    const allowed = new Set(profile.toolBoundary.allowedTools);
    const forbidden = new Set(profile.toolBoundary.forbiddenTools);
    const missingTools = taskProfile.requiredTools.filter(
      (t) => !allowed.has(t) || forbidden.has(t),
    );

    // 3. 盲点风险：任务禁忌类别 ∩ Forgekin 盲点类别
    const myBlindCategories = new Set(profile.blindSpots.map((bs) => bs.category));
    const forbiddenSet = new Set(taskProfile.forbiddenBlindSpotCategories);
    const blindSpotRisks: Array<[string, string]> = [];
    for (const cat of myBlindCategories) {
      if (!forbiddenSet.has(cat)) continue;
      for (const bs of profile.blindSpots) {
        if (bs.category === cat) {
          blindSpotRisks.push([bs.category, bs.description]);
        }
      }
    }

    // 4. 上下文窗口
    const contextInsufficient = taskProfile.minContextWindow !== undefined
      && profile.modelCapability.contextWindow < taskProfile.minContextWindow;

    // 5. 认知风格
    const styleMismatch = taskProfile.preferredCognitiveStyles.length > 0
      && !taskProfile.preferredCognitiveStyles.includes(profile.cognitiveStyle.explanationStyle);

    // 6. 拼装建议文案
    const recommendations: string[] = [];
    for (const skill of missingSkills) {
      recommendations.push(formatRecommendation(this.templates.missingSkill, DEFAULT_TEMPLATES.missingSkill, { skill }));
    }
    for (const tool of missingTools) {
      recommendations.push(formatRecommendation(this.templates.missingTool, DEFAULT_TEMPLATES.missingTool, { tool }));
    }
    for (const [cat, desc] of blindSpotRisks) {
      recommendations.push(formatRecommendation(this.templates.blindSpotRisk, DEFAULT_TEMPLATES.blindSpotRisk, { category: cat, desc }));
    }
    if (contextInsufficient) {
      recommendations.push(formatRecommendation(
        this.templates.contextWindowInsufficient,
        DEFAULT_TEMPLATES.contextWindowInsufficient,
        { required: taskProfile.minContextWindow, actual: profile.modelCapability.contextWindow },
      ));
    }
    if (styleMismatch) {
      recommendations.push(formatRecommendation(
        this.templates.cognitiveMismatch,
        DEFAULT_TEMPLATES.cognitiveMismatch,
        { preferred: taskProfile.preferredCognitiveStyles.join('/'), actual: profile.cognitiveStyle.explanationStyle },
      ));
    }

    return makeGapReport({
      missingSkills,
      missingTools,
      blindSpotRisks,
      contextWindowInsufficient: contextInsufficient,
      cognitiveStyleMismatch: styleMismatch,
      recommendations,
    });
  }

  /**
   * 检测候选 Forgekin 集合中的盲点冲突（批量跨厂商 review 必要性判断）。
   * 返回冲突列表 [(profileIdA, profileIdB, conflictCategory), ...]，仅同厂商 + 同类别。
   */
  detectBlindSpotConflicts(candidates: CapabilityProfile[]): Array<[string, string, string]> {
    const conflicts: Array<[string, string, string]> = [];
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        if (a.modelCapability.provider !== b.modelCapability.provider) continue;
        const catA = new Set(a.blindSpots.map((bs) => bs.category));
        const catB = new Set(b.blindSpots.map((bs) => bs.category));
        for (const cat of catA) {
          if (catB.has(cat)) conflicts.push([a.profileId, b.profileId, cat]);
        }
      }
    }
    return conflicts;
  }

  /**
   * 为作者推荐跨厂商 reviewer（ADR 004 §5）：
   * 1. 优先不同厂商（结构性消除同厂商盲点）
   * 2. 不同厂商中选盲点不重叠的，选 harness_fit_score.overall 最高者
   * 3. 退而求其次选盲点重叠最少的；无可行返回 undefined（调用方升级 operator）
   */
  recommendPairing(author: CapabilityProfile, candidates: CapabilityProfile[]): CapabilityProfile | undefined {
    const authorVendor = author.modelCapability.provider;
    const authorBlindCats = new Set(author.blindSpots.map((bs) => bs.category));

    const crossVendor = candidates.filter(
      (c) => c.modelCapability.provider !== authorVendor && c.profileId !== author.profileId,
    );
    if (crossVendor.length === 0) return undefined;

    const nonOverlapping = crossVendor.filter(
      (c) => ![...new Set(c.blindSpots.map((bs) => bs.category))].some((cat) => authorBlindCats.has(cat)),
    );
    if (nonOverlapping.length > 0) {
      return nonOverlapping.reduce((best, c) => (
        c.harnessFitScore.overall > best.harnessFitScore.overall ? c : best
      ));
    }

    const overlapCount = (c: CapabilityProfile): number => (
      [...new Set(c.blindSpots.map((bs) => bs.category))].filter((cat) => authorBlindCats.has(cat)).length
    );
    return crossVendor.reduce((best, c) => (overlapCount(c) < overlapCount(best) ? c : best));
  }
}

// 模块加载即注册（ProfileAnalyzer 无状态，全局单例安全；profile.gapAnalysis 惰性委托）
const defaultAnalyzer = new ProfileAnalyzer();
registerGapAnalyzer(defaultAnalyzer);

export type { CognitiveStyle };
