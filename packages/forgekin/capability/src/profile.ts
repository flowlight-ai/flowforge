/**
 * @flowforge/forgekin-capability — 阶段7 T7.2 CapabilityProfile 能力画像主模型
 *
 * 本地化自 flowforge Python `core/capability/profile.py`（F001 + ADR 004）：
 * "profile 才是长期主体"——跨 session 持续，必须写盲点（决定谁该 review 谁）。
 *
 * 关键不变量：
 * 1. CapabilityProfile 是长期主体，跨 session 持续
 * 2. role 是运行时标签，每次任务可变（不复用 profile）
 * 3. 盲点必须写入（不只写优点）
 * 4. 历史表现只能积累，不能回退
 *
 * @module @flowforge/forgekin-capability/profile
 */

import {
  AgentState,
  BlindSpot,
  CognitiveStyle,
  HarnessFitScore,
  makeAgentState,
  makeCognitiveStyle,
  makeHarnessFitScore,
  makeModelCapability,
  makeSkillPackage,
  makeToolBoundary,
  ModelCapability,
  PerformanceLog,
  SkillPackage,
  ToolBoundary,
} from './models.js';
import type { GapReport, TaskProfile } from './analyzer.js';

/** CapabilityProfile — Forgekin 能力画像（长期主体画像） */
export interface CapabilityProfile {
  /** 画像唯一标识 */
  profileId: string;
  /** 所属 Forgekin 标识 */
  agentId: string;
  /** 模型固有能力（常量层） */
  modelCapability: ModelCapability;
  /** 认知风格（常量层） */
  cognitiveStyle: CognitiveStyle;
  /** 盲点列表（半常量层，必须写入） */
  blindSpots: BlindSpot[];
  /** 可加载知识包列表（变量层） */
  skillPackages: SkillPackage[];
  /** 工具边界（变量层） */
  toolBoundary: ToolBoundary;
  /** 历史表现日志列表（积累层） */
  historicalPerformance: PerformanceLog[];
  /** 当前状态（瞬时层） */
  currentState: AgentState;
  /** Harness 契合度评分（契合度层） */
  harnessFitScore: HarnessFitScore;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 最后更新时间 ISO 8601 */
  updatedAt: string;
}

export interface CapabilityProfileInit {
  profileId: string;
  agentId: string;
  modelCapability: ModelCapability;
  cognitiveStyle?: CognitiveStyle;
  blindSpots?: BlindSpot[];
  skillPackages?: SkillPackage[];
  toolBoundary?: ToolBoundary;
  historicalPerformance?: PerformanceLog[];
  currentState?: AgentState;
  harnessFitScore?: HarnessFitScore;
  createdAt?: string;
  updatedAt?: string;
}

/** 构造 CapabilityProfile（缺省维度走工厂默认值；createdAt == updatedAt 且盲点为空 → draft 画像） */
export function makeCapabilityProfile(init: CapabilityProfileInit): CapabilityProfile {
  const now = new Date().toISOString();
  return {
    cognitiveStyle: makeCognitiveStyle(init.cognitiveStyle),
    blindSpots: [...(init.blindSpots ?? [])],
    skillPackages: [...(init.skillPackages ?? [])],
    toolBoundary: makeToolBoundary(init.toolBoundary),
    historicalPerformance: [...(init.historicalPerformance ?? [])],
    currentState: makeAgentState(init.currentState),
    harnessFitScore: makeHarnessFitScore(init.harnessFitScore),
    createdAt: init.createdAt ?? now,
    updatedAt: init.updatedAt ?? now,
    profileId: init.profileId,
    agentId: init.agentId,
    modelCapability: init.modelCapability,
  };
}

/** 检测与另一个 Forgekin 的盲点冲突（ADR 004 §5）：同厂商 + 同类别 → 冲突 */
export function hasBlindSpotConflict(a: CapabilityProfile, b: CapabilityProfile): boolean {
  // 不同厂商 → 训练分布偏差天然分散 → 无冲突
  if (a.modelCapability.provider !== b.modelCapability.provider) return false;
  // 同厂商 → 检查盲点类别是否重叠
  const aCats = new Set(a.blindSpots.map((bs) => bs.category));
  const bCats = new Set(b.blindSpots.map((bs) => bs.category));
  for (const cat of aCats) {
    if (bCats.has(cat)) return true;
  }
  return false;
}

/** 任务画像 × 能力画像 gap 分析（委托 ProfileAnalyzer.computeGap） */
export function gapAnalysis(profile: CapabilityProfile, taskProfile: TaskProfile): GapReport {
  // 惰性引入避免循环依赖
  return computeGapImpl(profile, taskProfile);
}

/** 人类可读摘要（trace 日志 / operator 展示 / MindCouncil 议事） */
export function toProfileSummary(profile: CapabilityProfile): string {
  const strengths = profile.modelCapability.strengths.slice(0, 3).join(', ') || '(none)';
  const limitations = profile.modelCapability.limitations.slice(0, 3).join(', ') || '(none)';
  const blindSpotCats = profile.blindSpots.map((bs) => bs.category).join(', ') || '(none recorded)';
  const skills = profile.skillPackages.slice(0, 3).map((sp) => sp.name).join(', ') || '(none)';
  const perfSummary = profile.historicalPerformance.length > 0
    ? `${profile.historicalPerformance.length} task types`
    : '(no history)';
  return [
    `CapabilityProfile[${profile.profileId}]`,
    `agent=${profile.agentId}`,
    `model=${profile.modelCapability.provider}/${profile.modelCapability.modelName}`,
    `ctx=${profile.modelCapability.contextWindow}`,
    `strengths=[${strengths}]`,
    `limitations=[${limitations}]`,
    `cognitive(reasoning=${profile.cognitiveStyle.reasoningDepth.toFixed(2)}, risk=${profile.cognitiveStyle.riskAppetite.toFixed(2)})`,
    `blind_spots=[${blindSpotCats}]`,
    `skills=[${skills}]`,
    `performance=${perfSummary}`,
    `harness_fit=${profile.harnessFitScore.overall.toFixed(2)}`,
  ].join(' ');
}

/** 查询指定任务类型的历史表现 */
export function getPerformance(profile: CapabilityProfile, taskType: string): PerformanceLog | undefined {
  return profile.historicalPerformance.find((log) => log.taskType === taskType);
}

/** 检查是否加载了指定知识包 */
export function hasSkill(profile: CapabilityProfile, skillName: string): boolean {
  return profile.skillPackages.some((sp) => sp.name === skillName);
}

/** 转为普通可序列化对象 */
export function toProfileDict(profile: CapabilityProfile): Record<string, unknown> {
  return JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
}

// ─── Gap 分析实现（从 analyzer.ts 提升为内部函数以避免循环导入） ──────────

import type { ProfileAnalyzerLike } from './analyzer.js';

let analyzerImpl: ProfileAnalyzerLike | undefined;

/** 注册 gap 分析实现（由 analyzer 模块注入，避免循环依赖） */
export function registerGapAnalyzer(impl: ProfileAnalyzerLike): void {
  analyzerImpl = impl;
}

function computeGapImpl(profile: CapabilityProfile, taskProfile: TaskProfile): GapReport {
  if (!analyzerImpl) {
    throw new Error('gap analyzer 未注册——请先 import @flowforge/forgekin-capability/analyzer');
  }
  return analyzerImpl.computeGap(profile, taskProfile);
}

export { makeModelCapability, makeSkillPackage };
