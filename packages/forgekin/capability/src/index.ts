/**
 * @flowforge/forgekin-capability — 阶段7 T7.2 能力画像域 Cordis 插件
 *
 * 挂载 `ctx.forgeCapability`：CapabilityProfile 六维画像注册/查询/更新 +
 * 盲点冲突检测 + gap 分析 + 跨厂商配对推荐（内存注册表，组合根可注入持久化后端）。
 * 对齐 Python `core/capability/{profile,analyzer}.py` 语义（F001 + ADR 004）。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  hasBlindSpotConflict,
  makeCapabilityProfile,
  toProfileDict,
  toProfileSummary,
  CapabilityProfile,
  CapabilityProfileInit,
} from './profile.js';
import {
  GapReport,
  ProfileAnalyzer,
  TaskProfile,
} from './analyzer.js';
import {
  makeAgentState,
  makePerformanceLog,
  makeSkillPackage,
  makeToolBoundary,
  AgentState,
  PerformanceLog,
  SkillPackage,
  ToolBoundary,
} from './models.js';

export * from './models.js';
export * from './profile.js';
export * from './analyzer.js';

/** CapabilityProfile 注册表后端（组合根可注入 SQLite/Redis 持久化） */
export interface CapabilityRegistry {
  /** 保存画像（同 profileId 幂等覆盖） */
  put(profile: CapabilityProfile): Promise<void>;
  /** 按 profileId 查询 */
  get(profileId: string): Promise<CapabilityProfile | undefined>;
  /** 列出全部画像 */
  list(): Promise<CapabilityProfile[]>;
  /** 删除画像 */
  remove(profileId: string): Promise<boolean>;
}

/** 内存注册表（默认后端） */
export class MemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityProfile>();

  async put(profile: CapabilityProfile): Promise<void> {
    this.entries.set(profile.profileId, profile);
  }

  async get(profileId: string): Promise<CapabilityProfile | undefined> {
    return this.entries.get(profileId);
  }

  async list(): Promise<CapabilityProfile[]> {
    return [...this.entries.values()];
  }

  async remove(profileId: string): Promise<boolean> {
    return this.entries.delete(profileId);
  }
}

export interface CapabilityServiceOptions {
  /** 画像注册表（缺省 Memory；组合根注入持久化后端） */
  readonly registry?: CapabilityRegistry | undefined;
  /** 推荐文案模板（透传 ProfileAnalyzer） */
  readonly templates?: Record<string, string> | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 能力画像域：六维画像注册/查询 + gap 分析 + 配对推荐 */
    forgeCapability: CapabilityService;
  }
}

export class CapabilityService extends Service {
  readonly registry: CapabilityRegistry;
  private readonly analyzer: ProfileAnalyzer;

  constructor(ctx: Context, options: CapabilityServiceOptions = {}) {
    super(ctx, 'forgeCapability');
    this.registry = options.registry ?? new MemoryCapabilityRegistry();
    this.analyzer = new ProfileAnalyzer({ templates: options.templates });
  }

  /** 创建并登记一个能力画像 */
  async create(init: CapabilityProfileInit): Promise<CapabilityProfile> {
    const profile = makeCapabilityProfile(init);
    await this.registry.put(profile);
    return profile;
  }

  /** 按 profileId 查询画像 */
  get(profileId: string): Promise<CapabilityProfile | undefined> {
    return this.registry.get(profileId);
  }

  /** 列出全部画像 */
  list(): Promise<CapabilityProfile[]> {
    return this.registry.list();
  }

  /** 更新画像（覆盖写入；由调用方保证历史表现只积累不回退） */
  async update(profile: CapabilityProfile): Promise<void> {
    await this.registry.put(profile);
  }

  /** 删除画像 */
  remove(profileId: string): Promise<boolean> {
    return this.registry.remove(profileId);
  }

  /** 盲点冲突检测（ADR 004 §5）：同厂商 + 同类别 → 冲突 */
  hasConflict(a: CapabilityProfile, b: CapabilityProfile): boolean {
    return hasBlindSpotConflict(a, b);
  }

  /** 批量盲点冲突检测：返回所有冲突配对 */
  detectConflicts(candidates: CapabilityProfile[]): Array<[string, string, string]> {
    return this.analyzer.detectBlindSpotConflicts(candidates);
  }

  /** 任务画像 × 能力画像 gap 分析 */
  gapAnalysis(profile: CapabilityProfile, taskProfile: TaskProfile): GapReport {
    return this.analyzer.computeGap(profile, taskProfile);
  }

  /** 跨厂商 review 配对推荐（ADR 004 §5） */
  recommendPairing(author: CapabilityProfile, candidates: CapabilityProfile[]): CapabilityProfile | undefined {
    return this.analyzer.recommendPairing(author, candidates);
  }

  /** 人类可读摘要（trace 日志 / operator 展示） */
  summarize(profile: CapabilityProfile): string {
    return toProfileSummary(profile);
  }

  /** 转为普通可序列化对象 */
  toDict(profile: CapabilityProfile): Record<string, unknown> {
    return toProfileDict(profile);
  }

  // ── 维度级工厂（供组合根 / 调用方便捷使用） ──────────────────────────────

  makeAgentState(init?: Partial<AgentState>): AgentState { return makeAgentState(init); }
  makeSkillPackage(init: Parameters<typeof makeSkillPackage>[0]): SkillPackage { return makeSkillPackage(init); }
  makePerformanceLog(init: Parameters<typeof makePerformanceLog>[0]): PerformanceLog { return makePerformanceLog(init); }
  makeToolBoundary(init?: Partial<ToolBoundary>): ToolBoundary { return makeToolBoundary(init); }
}

export default function Plugin(ctx: Context, options?: CapabilityServiceOptions) {
  return ctx.plugin(CapabilityService, options);
}
