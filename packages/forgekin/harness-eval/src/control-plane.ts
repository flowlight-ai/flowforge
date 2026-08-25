/**
 * control-plane — Harness Eval 控制面服务（F040 §3.2 ControlPlaneAPI）。
 *
 * 统一 Eval Hub——不是指标看板，而是 harness 生命周期的控制面：
 * 哪块机制正在增值 / 折旧 / 需要行动 / 成为瓶颈。
 * 挂载 `ctx.forgeHarnessEval`（Cordis 插件）。
 *
 * @module @flowforge/forgekin-harness-eval
 */

import { Service, type Context } from '@flowforge/cordis';
import {
  HarnessLifecycleState,
  type DailySummary,
  type HarnessAction,
  type HarnessComponentStatus,
} from './types.js';
import {
  LifecycleJudge,
  type LifecycleObservation,
} from './lifecycle.js';
import { ActionRecommender, DEFAULT_ACTION_ROUTING } from './recommender.js';
import { DailySummarizer, type ComponentObservationSource } from './summarizer.js';
import { FeedbackLoop, type FeedbackLoopOptions } from './feedback-loop.js';
import { EvalDomainRegistry } from './registry.js';

/** 控制面配置（对齐 F040 §3.4 YAML）。 */
export interface HarnessEvalControlPlaneOptions {
  /** 每日汇总 cron 表达式（默认 `0 2 * * *`） */
  readonly summarySchedule?: string | undefined;
  /** 增值阈值（默认 0.6） */
  readonly appreciationThreshold?: number | undefined;
  /** 摩擦阈值（默认 0.4） */
  readonly frictionThreshold?: number | undefined;
  /** 瓶颈连续折旧天数（默认 7） */
  readonly bottleneckConsecutiveDays?: number | undefined;
  /** 行动路由表（默认 F012/F020/escalate） */
  readonly actionRouting?: Partial<Record<HarnessLifecycleState, string>> | undefined;
  /** 组件观测源（聚合 F018/F019/F020 数据的投影） */
  readonly observationSource?: ComponentObservationSource | undefined;
  /** FeedbackLoop 配置（质量门控） */
  readonly feedbackLoop?: FeedbackLoopOptions | undefined;
  /** 自定义评估域（追加到内置 16 域） */
  readonly extraDomains?: ConstructorParameters<typeof EvalDomainRegistry>[0] | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    forgeHarnessEval: HarnessEvalControlPlaneService;
  }
}

/** Harness Eval 控制面服务——生命周期状态查询 + 每日汇总 + 行动派发 + 质量门控。 */
export class HarnessEvalControlPlaneService extends Service {
  /** 生命周期判定器 */
  readonly lifecycle: LifecycleJudge;
  /** 行动建议器 */
  readonly recommender: ActionRecommender;
  /** 每日汇总器 */
  readonly summarizer: DailySummarizer;
  /** 质量门控（外环守卫） */
  readonly feedbackLoop: FeedbackLoop;
  /** Eval 域注册表（内置 16 域） */
  readonly domains: EvalDomainRegistry;
  /** 汇总 cron（F040 §3.4 summary_schedule） */
  readonly summarySchedule: string;

  private readonly statuses = new Map<string, HarnessComponentStatus>();
  /** 最近一次观测快照（summarize 的输入源，避免依赖外部投影） */
  private readonly observations = new Map<string, import('./lifecycle.js').LifecycleObservation>();

  constructor(ctx: Context, options: HarnessEvalControlPlaneOptions = {}) {
    super(ctx, 'forgeHarnessEval');
    this.summarySchedule = options.summarySchedule ?? '0 2 * * *';
    this.lifecycle = new LifecycleJudge({
      appreciation_threshold: options.appreciationThreshold,
      friction_threshold: options.frictionThreshold,
      bottleneck_consecutive_days: options.bottleneckConsecutiveDays,
    });
    this.recommender = new ActionRecommender({
      ...DEFAULT_ACTION_ROUTING,
      ...(options.actionRouting ?? {}),
    });
    this.summarizer = new DailySummarizer({
      source: options.observationSource,
      judge: this.lifecycle,
      recommender: this.recommender,
    });
    this.feedbackLoop = new FeedbackLoop(options.feedbackLoop);
    this.domains = new EvalDomainRegistry(options.extraDomains);
  }

  // ========== ControlPlaneAPI（F040 §3.2）==========

  /** 查询组件状态（AC-1）。 */
  getStatus(componentId: string): HarnessComponentStatus | undefined {
    return this.statuses.get(componentId);
  }

  /** 按状态列出组件（AC-1）。 */
  listByState(state: HarnessLifecycleState): HarnessComponentStatus[] {
    return [...this.statuses.values()].filter((s) => s.lifecycle_state === state);
  }

  /** 全部组件状态。 */
  listAll(): HarnessComponentStatus[] {
    return [...this.statuses.values()];
  }

  /** 触发行动（AC-4：行动建议按状态派发对应处理方）。 */
  triggerAction(componentId: string, action: string): HarnessAction {
    const status = this.statuses.get(componentId);
    const dispatchedAt = Date.now();
    if (!status) {
      return {
        action,
        component_id: componentId,
        reason: 'component not observed — manual action',
        dispatched_at: dispatchedAt,
      };
    }
    this.statuses.set(componentId, { ...status, last_action: action, updated_at: dispatchedAt });
    return {
      action,
      component_id: componentId,
      reason: `manual trigger on state ${status.lifecycle_state}`,
      dispatched_at: dispatchedAt,
    };
  }

  /** 记录一次观测（更新组件状态并返回最新状态）。 */
  observe(observation: LifecycleObservation): HarnessComponentStatus {
    this.observations.set(observation.component_id, observation);
    const status = this.lifecycle.judge(observation);
    this.statuses.set(status.component_id, status);
    return status;
  }

  /** 批量观测。 */
  observeAll(observations: readonly LifecycleObservation[]): HarnessComponentStatus[] {
    return observations.map((o) => this.observe(o));
  }

  /** 每日汇总（AC-2/AC-3/AC-5：聚合契约/信号/归因，更新生命周期，派发行动，归因趋势）。 */
  summarize(now?: number): DailySummary {
    const summary = this.summarizer.summarize([...this.observations.values()], now);
    for (const component of summary.components) {
      this.statuses.set(component.component_id, component);
    }
    return summary;
  }

  /** 对一个执行结果做质量门控（外环守卫）。 */
  evaluate(
    result: Readonly<Record<string, unknown>>,
    mode?: import('./types.js').EvaluationMode,
  ): Promise<import('./feedback-loop.js').EvaluatedOutput> {
    return this.feedbackLoop.evaluate(result, mode);
  }

  /** 控制面快照（组件状态 + 汇总统计）。 */
  snapshot(): Readonly<{
    components: number;
    domains: number;
    enabledDomains: number;
    summarySchedule: string;
  }> {
    return {
      components: this.statuses.size,
      domains: this.domains.list().length,
      enabledDomains: this.domains.listEnabled().length,
      summarySchedule: this.summarySchedule,
    };
  }
}

/** Cordis 插件入口（同步赋值，对齐 observability/im-council 模式）。 */
export default function Plugin(ctx: Context, options: HarnessEvalControlPlaneOptions = {}) {
  ctx.forgeHarnessEval = new HarnessEvalControlPlaneService(ctx, options);
}

export type { HarnessLifecycleState };
