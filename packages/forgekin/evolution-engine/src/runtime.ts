/**
 * 生产环境 SelfDev 启动入口 — F046 §3.1 Phase 5 + F045 桥接的生产装配点。
 * TS 重写自 Python `evolution/runtime.py`。
 *
 * 负责：
 * 1. 组装 ForgeMindEngine + CL-033 ApprovalHub
 * 2. 实例化 5 个 SelfDev 闭环（wenxin/sherlock/luban/vangogh/davinci）并注册
 * 3. 注入 approval_callback（I8 不变量：framework 闭环必须注入）
 * 4. 提供 run_xxx_loop 委托 + operator approve/reject 决策接口
 *
 * 审批模式：
 * - "auto": 自动批准（仅 demo / 测试用）
 * - "manual": 通过 ApprovalHub，operator 调用 runtime.approve/reject 决策
 * - "im": 通过 F047 IM 议事通道推送（ImCouncilPort 注入；T7.16 im-council 提供）
 *
 * 遵守铁律：红线 11（路径不硬编码）/ 红线 12（DI 注入）/ I8（framework approval）。
 */

import { randomUUID } from 'node:crypto';
import type { LlmChatClient } from '@flowforge/forgekin-loops';
import { SelfDevCodeLoop } from '@flowforge/forgekin-loops';
import { SelfDevDocLoop } from '@flowforge/forgekin-loops';
import { SelfDevFrameworkLoop } from '@flowforge/forgekin-loops';
import { SelfDevReviewLoop } from '@flowforge/forgekin-loops';
import { SelfDevTestLoop } from '@flowforge/forgekin-loops';
import type { DevPlan, DevTask, ForgekinConfig, RunOnceResult } from '@flowforge/forgekin-loops';
import { ForgeMindEngine } from './engine.js';
import {
  ApprovalHub,
  ApprovalRequest,
  makeApprovalRequest,
} from './approval-hub.js';
import type { ForemanRuntimePort } from './foreman.js';

/** approval_mode 类型。 */
export type ApprovalMode = 'auto' | 'manual' | 'im';

/** 默认审批超时（秒）。 */
export const DEFAULT_APPROVAL_TIMEOUT_SECONDS = 300;

/** 需要 approval_callback 的 forgekin（I8 不变量：framework 闭环）。 */
export const FRAMEWORK_FORGEKIN_ID = 'luban';

/** forgekin_id → SelfDev 闭环类映射（F046 v1.1 五闭环）。 */
export const FORGEKIN_LOOP_CLASSES = {
  wenxin: SelfDevDocLoop,
  sherlock: SelfDevCodeLoop,
  luban: SelfDevFrameworkLoop,
  vangogh: SelfDevReviewLoop,
  davinci: SelfDevTestLoop,
} as const;

export type ForgekinId = keyof typeof FORGEKIN_LOOP_CLASSES;

/** I8 approval 回调签名（对齐 loops 域 ApprovalCallback）。 */
export type ApprovalCallback = (plan: DevPlan, task: DevTask) => Promise<boolean>;

/**
 * F047 IM 议事端口 — approval_mode="im" 时必须注入。
 * 由 `packages/forgekin/im-council`（T7.16）提供实现：
 * 完整五步（提交→推送→等待→decide→归档，含 I1 降级链路）。
 */
export interface ImCouncilPort {
  requestApproval(request: ApprovalRequest, timeoutSeconds: number): Promise<boolean>;
}

export interface SelfDevRuntimeOptions {
  /** LLM 客户端（F045 Trae 桥接，必填；红线 12） */
  readonly llmClient: LlmChatClient;
  /** 5 个 forgekin 配置（projectRoot 必填；键 wenxin/sherlock/luban/vangogh/davinci） */
  readonly forgekinConfigs: Record<string, ForgekinConfig>;
  /** 审批模式（缺省 manual） */
  readonly approvalMode?: ApprovalMode | undefined;
  /** 审批超时秒数（缺省 300） */
  readonly approvalTimeoutSeconds?: number | undefined;
  /** F047 IM 议事端口（approval_mode="im" 时必填） */
  readonly imCouncil?: ImCouncilPort | undefined;
  /** 治理引擎（缺省新建） */
  readonly engine?: ForgeMindEngine | undefined;
  /** 审批中心（缺省新建） */
  readonly approvalHub?: ApprovalHub | undefined;
  /** 各 forgekin 觉醒阶覆盖（缺省 E3；framework=luban 为 E5） */
  readonly awakeningStages?: Record<string, string> | undefined;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 生产环境 SelfDev 五闭环运行时装配点。
 *
 * 通过 SelfDevRuntime.create(options) 装配（不直接 new — 内部需要先建
 * approval_callback 闭包再注入 framework 闭环配置）。
 */
export class SelfDevRuntime implements ForemanRuntimePort {
  readonly engine: ForgeMindEngine;
  readonly approvalHub: ApprovalHub;
  private readonly approvalMode: ApprovalMode;
  private readonly approvalTimeoutSeconds: number;
  private readonly imCouncil: ImCouncilPort | null;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  private constructor(options: {
    engine: ForgeMindEngine;
    approvalHub: ApprovalHub;
    approvalMode: ApprovalMode;
    approvalTimeoutSeconds: number;
    imCouncil: ImCouncilPort | null;
  }) {
    this.engine = options.engine;
    this.approvalHub = options.approvalHub;
    this.approvalMode = options.approvalMode;
    this.approvalTimeoutSeconds = options.approvalTimeoutSeconds;
    this.imCouncil = options.imCouncil;
  }

  /**
   * 生产装配入口 — 创建实例 + 实例化 5 个闭环并注册 + 注入 I8 approval_callback。
   *
   * @throws approval_mode="im" 且未注入 imCouncil 时抛错；
   *         forgekinConfigs 缺少任一内置 forgekin 时抛错。
   */
  static create(options: SelfDevRuntimeOptions): SelfDevRuntime {
    const approvalMode = options.approvalMode ?? 'manual';
    const approvalTimeoutSeconds = options.approvalTimeoutSeconds ?? DEFAULT_APPROVAL_TIMEOUT_SECONDS;

    if (approvalMode === 'im' && (options.imCouncil === undefined || options.imCouncil === null)) {
      throw new Error(
        'approval_mode="im" 需要 imCouncil 注入（F047 IM 议事通道；红线 12：DI 注入）',
      );
    }

    const engine = options.engine ?? new ForgeMindEngine();
    const approvalHub = options.approvalHub ?? new ApprovalHub();

    const runtime = new SelfDevRuntime({
      engine,
      approvalHub,
      approvalMode,
      approvalTimeoutSeconds,
      imCouncil: options.imCouncil ?? null,
    });

    // 实例化 5 个 SelfDev 闭环并注册到 engine（DI 注入，红线 12）
    for (const [forgekinId, LoopClass] of Object.entries(FORGEKIN_LOOP_CLASSES)) {
      const baseConfig = options.forgekinConfigs[forgekinId];
      if (baseConfig === undefined) {
        throw new Error(
          `forgekin '${forgekinId}' 配置缺失（bootstrap 要求全部 5 个内置 Forgekin 配置）`,
        );
      }

      // I8 不变量：framework 闭环必须注入 approval_callback
      const config: ForgekinConfig =
        forgekinId === FRAMEWORK_FORGEKIN_ID
          ? { ...baseConfig, approval_callback: runtime.makeApprovalCallback(FRAMEWORK_FORGEKIN_ID) }
          : { ...baseConfig };

      const awakeningStage =
        options.awakeningStages?.[forgekinId] ??
        (baseConfig['awakening_stage'] as string | undefined) ??
        (forgekinId === FRAMEWORK_FORGEKIN_ID ? 'E5' : 'E3');

      const loop = new LoopClass({
        llmClient: options.llmClient,
        forgekinConfig: config,
        awakeningStage,
      });
      engine.registerSelfDevLoop(loop);
    }

    return runtime;
  }

  // ── §2 approval_callback 工厂 ──────────────────────────────────

  /**
   * 创建 approval_callback（I8 不变量：framework 闭环必须注入）。
   *
   * - "auto": 记录请求后自动批准（仅 demo / 测试用）
   * - "manual": 提交到 ApprovalHub，等待 operator 决策（超时视为拒绝）
   * - "im": 通过 F047 IM 议事通道推送（ImCouncilPort.requestApproval）
   */
  makeApprovalCallback(forgekinId: string): ApprovalCallback {
    const runtime = this;
    return async (plan: DevPlan, task: DevTask): Promise<boolean> => {
      const requestId = `approval-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const expiresAt = new Date(
        Date.now() + runtime.approvalTimeoutSeconds * 1000,
      ).toISOString();

      // 提取目标路径（优先 task.targetPath，回退到 plan.steps[0].path）
      let targetPath = task.targetPath;
      if (!targetPath && plan.steps.length > 0) {
        const firstStep = plan.steps[0];
        if (firstStep !== undefined && typeof firstStep['path'] === 'string') {
          targetPath = firstStep['path'];
        }
      }

      const request = makeApprovalRequest({
        requestId,
        forgekinId,
        threadId: `self_dev:${task.loopType}`,
        requestType: 'config_change',
        title: `Framework 变更: ${targetPath || '(未指定)'}`,
        description:
          `任务: ${task.description}\n`
          + `预期效果: ${plan.expectedEffect}\n`
          + `风险评估: ${plan.riskAssessment}\n`
          + `步骤数: ${plan.steps.length}`,
        payload: {
          plan_id: plan.planId,
          task_id: task.taskId,
          loop_type: task.loopType,
          steps: plan.steps,
          target_path: targetPath,
        },
        expiresAt,
        priority: 'high',
      });

      // auto 模式：自动批准（仅 demo / 测试用）
      if (runtime.approvalMode === 'auto') {
        runtime.approvalHub.submit(request);
        runtime.approvalHub.approve({
          requestId,
          decidedBy: 'auto-approver',
          comments: 'auto 模式自动批准',
        });
        return true;
      }

      // im 模式：通过 F047 IM 议事通道推送（五步：提交→推送→等待→decide→归档）
      if (runtime.approvalMode === 'im') {
        const manager = runtime.imCouncil;
        if (manager === null) {
          runtime.approvalHub.submit(request);
          return false;
        }
        return manager.requestApproval(request, runtime.approvalTimeoutSeconds);
      }

      // manual 模式：提交到 ApprovalHub，等待 operator 决策
      runtime.approvalHub.submit(request);
      return runtime.waitForDecision(requestId);
    };
  }

  /** manual 模式等待 operator 决策（超时视为拒绝）。 */
  private waitForDecision(requestId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.pendingApprovals.delete(requestId);
        resolve(false);
      }, this.approvalTimeoutSeconds * 1000);
      this.timers.add(timer);
      this.pendingApprovals.set(requestId, { resolve, timer });
    });
  }

  // ── §3 五个 run_xxx_loop 方法 — 委托给 engine.runSelfDevLoop ──

  /** 运行文档闭环（wenxin/文心，E3）。 */
  async runDocLoop(context: Record<string, unknown>): Promise<RunOnceResult> {
    return this.engine.runSelfDevLoop('doc', context) as Promise<RunOnceResult>;
  }

  /** 运行代码闭环（sherlock/夏洛克，E4）。 */
  async runCodeLoop(context: Record<string, unknown>): Promise<RunOnceResult> {
    return this.engine.runSelfDevLoop('code', context) as Promise<RunOnceResult>;
  }

  /** 运行框架闭环（luban/鲁班，E5，含 I8 approval）。 */
  async runFrameworkLoop(context: Record<string, unknown>): Promise<RunOnceResult> {
    return this.engine.runSelfDevLoop('framework', context) as Promise<RunOnceResult>;
  }

  /** 运行审查闭环（vangogh/梵高，E3）。 */
  async runReviewLoop(context: Record<string, unknown>): Promise<RunOnceResult> {
    return this.engine.runSelfDevLoop('review', context) as Promise<RunOnceResult>;
  }

  /** 运行测试闭环（davinci/达芬奇，E3）。 */
  async runTestLoop(context: Record<string, unknown>): Promise<RunOnceResult> {
    return this.engine.runSelfDevLoop('test', context) as Promise<RunOnceResult>;
  }

  // ── §4 operator 接口 ───────────────────────────────────────────

  /**
   * operator 批准审批请求（唤醒等待中的 approval_callback，使其返回 true）。
   * 返回 false 表示 request_id 不存在/已决策/已过期。
   */
  approve(requestId: string, comments = ''): boolean {
    const { ok, reason } = this.approvalHub.approve({
      requestId,
      decidedBy: 'operator',
      comments,
    });
    if (!ok) {
      void reason;
      return false;
    }
    this.settlePending(requestId, true);
    return true;
  }

  /**
   * operator 拒绝审批请求（唤醒等待中的 approval_callback，使其返回 false）。
   * 返回 false 表示 request_id 不存在/已决策/已过期。
   */
  reject(requestId: string, comments = ''): boolean {
    const { ok, reason } = this.approvalHub.reject({
      requestId,
      decidedBy: 'operator',
      comments,
    });
    if (!ok) {
      void reason;
      return false;
    }
    this.settlePending(requestId, false);
    return true;
  }

  private settlePending(requestId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.pendingApprovals.delete(requestId);
    clearTimeout(pending.timer);
    this.timers.delete(pending.timer);
    pending.resolve(approved);
  }

  /** 列出所有待审批请求（operator 查看用）。 */
  listPendingApprovals(): Array<Record<string, unknown>> {
    return this.approvalHub.listPending().map((r) => ({
      request_id: r.requestId,
      forgekin_id: r.forgekinId,
      thread_id: r.threadId,
      request_type: r.requestType,
      title: r.title,
      description: r.description,
      priority: r.priority,
      created_at: r.createdAt,
      expires_at: r.expiresAt,
      payload: r.payload,
    }));
  }

  /** 获取运行时统计信息。 */
  getStats(): Record<string, unknown> {
    return {
      approval_stats: this.approvalHub.getStats(),
      registered_loops: this.engine.listSelfDevLoops(),
      pending_events_count: this.pendingApprovals.size,
      approval_mode: this.approvalMode,
      approval_timeout_seconds: this.approvalTimeoutSeconds,
    };
  }

  // ── §5 资源管理 ────────────────────────────────────────────────

  /**
   * 清理资源 — 归档 pending 请求、唤醒等待中的 approval_callback（视为拒绝）。
   * 调用后 runtime 不再可用，应重新 create 新实例。
   */
  shutdown(): void {
    // 1. 唤醒所有等待中的 approval_callback（视为拒绝）
    for (const requestId of [...this.pendingApprovals.keys()]) {
      this.settlePending(requestId, false);
    }

    // 2. 清理全部定时器
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // 3. 清理 ApprovalHub 过期请求
    this.approvalHub.purgeExpired();
  }
}
