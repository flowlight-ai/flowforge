/**
 * @flowforge/forgekin-evolution-engine — 阶段7 T7.20 进化引擎三循环 Cordis 插件。
 *
 * 挂载 `ctx.forgeEvolution`：ForgeMindEngine 三模式治理（Mode A Scope Guard /
 * Mode B Process Evolution / Mode C Knowledge Evolution + 元认知路由 + Mode C 反思）
 * + CL-033 ApprovalHub + SelfDevRuntime 生产装配（auto/manual/im 三审批模式 + I8）
 * + ContinuousForeman 五 Forgekin 持续调度 + CL-034 QC Loop 7-Step +
 * CL-025 Close Gate。
 *
 * TS 重写自 Python `evolution/{engine,foreman,runtime,qc_loop,close_gate,
 * process_evolution,scope_guard,metacognition,models}.py` + `core/approval_hub.py`。
 */

import { Context, Service } from '@flowforge/cordis';
import type { ForgekinConfig, LlmChatClient } from '@flowforge/forgekin-loops';
import { ApprovalHub } from './approval-hub.js';
import { CloseGateValidator } from './close-gate.js';
import {
  ContinuousForeman,
  ForemanRuntimePort,
  type ContinuousForemanOptions,
} from './foreman.js';
import { ForgeMindEngine } from './engine.js';
import {
  MetacognitionReflector,
  MetacognitionRouter,
} from './metacognition.js';
import { QCLoop } from './qc-loop.js';
import { SelfDevRuntime, type ApprovalMode, type ImCouncilPort } from './runtime.js';

export * from './models.js';
export * from './scope-guard.js';
export * from './process-evolution.js';
export * from './metacognition.js';
export * from './qc-loop.js';
export * from './close-gate.js';
export * from './approval-hub.js';
export * from './engine.js';
export * from './foreman.js';
export * from './runtime.js';

export interface EvolutionServiceOptions {
  /** LLM 客户端（装配 SelfDevRuntime 时必填；红线 12 DI 注入） */
  readonly llmClient?: LlmChatClient | undefined;
  /** 5 个 forgekin 配置（wenxin/sherlock/luban/vangogh/davinci；projectRoot 必填） */
  readonly forgekinConfigs?: Record<string, ForgekinConfig> | undefined;
  /** 审批模式（缺省 manual） */
  readonly approvalMode?: ApprovalMode | undefined;
  /** 审批超时秒数（缺省 300） */
  readonly approvalTimeoutSeconds?: number | undefined;
  /** F047 IM 议事端口（approval_mode="im" 时必填；T7.16 提供） */
  readonly imCouncil?: ImCouncilPort | undefined;
  /** 治理引擎（缺省新建；可注入共享 forgekin-knowledge 实例） */
  readonly engine?: ForgeMindEngine | undefined;
  /** 审批中心（缺省新建） */
  readonly approvalHub?: ApprovalHub | undefined;
  /** Foreman 配置（提供 swarmCoordinator 时启用持续调度） */
  readonly foremanOptions?: ContinuousForemanOptions | undefined;
  /** 各 forgekin 觉醒阶覆盖 */
  readonly awakeningStages?: Record<string, string> | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 进化引擎域：三模式治理 + 审批中心 + 运行时装配 + Foreman 调度 */
    forgeEvolution: EvolutionService;
  }
}

/**
 * 进化引擎域服务 — 三模式自我进化统一入口。
 *
 * 组装：
 * - engine: ForgeMindEngine（三模式治理 + SelfDev 闭环注册表）
 * - approvalHub: CL-033 审批中心
 * - metacognition: 元认知路由 + Mode C 反思执行器
 * - closeGate: CL-025 Close Gate 校验器
 * - runtime: SelfDevRuntime（llmClient + forgekinConfigs 提供时装配五闭环）
 * - foreman: ContinuousForeman（foremanOptions 提供时创建，createForeman() 启动）
 */
export class EvolutionService extends Service {
  readonly engine: ForgeMindEngine;
  readonly approvalHub: ApprovalHub;
  readonly metacognition: MetacognitionRouter;
  readonly reflector: MetacognitionReflector;
  readonly closeGate: CloseGateValidator;
  readonly runtime: SelfDevRuntime | null;
  private foremanInstance: ContinuousForeman | null = null;

  constructor(ctx: Context, options: EvolutionServiceOptions = {}) {
    super(ctx, 'forgeEvolution');
    this.engine = options.engine ?? new ForgeMindEngine();
    this.approvalHub = options.approvalHub ?? new ApprovalHub();
    this.metacognition = this.engine.metacognition;
    this.reflector = new MetacognitionReflector();
    this.closeGate = new CloseGateValidator();

    // 装配 SelfDevRuntime（llmClient + forgekinConfigs 同时提供时）
    if (options.llmClient !== undefined && options.forgekinConfigs !== undefined) {
      this.runtime = SelfDevRuntime.create({
        engine: this.engine,
        approvalHub: this.approvalHub,
        llmClient: options.llmClient,
        forgekinConfigs: options.forgekinConfigs,
        approvalMode: options.approvalMode,
        approvalTimeoutSeconds: options.approvalTimeoutSeconds,
        imCouncil: options.imCouncil,
        awakeningStages: options.awakeningStages,
      });
    } else {
      this.runtime = null;
    }

    if (options.foremanOptions !== undefined) {
      const runtimePort: ForemanRuntimePort = this.runtime ?? new NoopForemanRuntime();
      this.foremanInstance = new ContinuousForeman(runtimePort, options.foremanOptions);
    }
  }

  /** 获取 Foreman 实例（foremanOptions 未提供时为 null）。 */
  get foreman(): ContinuousForeman | null {
    return this.foremanInstance;
  }

  /** 便捷委托：evaluate(context)。 */
  async evaluate(context: Parameters<ForgeMindEngine['evaluate']>[0]): Promise<ReturnType<ForgeMindEngine['evaluate']>> {
    return this.engine.evaluate(context);
  }

  /** 便捷委托：execute(action)。 */
  async execute(action: Parameters<ForgeMindEngine['execute']>[0]): Promise<Record<string, unknown>> {
    return this.engine.execute(action);
  }

  /** 创建 QC Loop（CL-034 7 步循环实例）。 */
  createQcLoop(options: ConstructorParameters<typeof QCLoop>[0] = {}): QCLoop {
    return new QCLoop(options);
  }
}

/** foreman 未装配 runtime 时的降级端口（闭环调用直接报错，不静默吞任务）。 */
class NoopForemanRuntime implements ForemanRuntimePort {
  async runDocLoop(): Promise<unknown> {
    throw new Error('SelfDevRuntime 未装配（需提供 llmClient + forgekinConfigs），闭环不可执行');
  }

  async runCodeLoop(): Promise<unknown> {
    throw new Error('SelfDevRuntime 未装配（需提供 llmClient + forgekinConfigs），闭环不可执行');
  }

  async runFrameworkLoop(): Promise<unknown> {
    throw new Error('SelfDevRuntime 未装配（需提供 llmClient + forgekinConfigs），闭环不可执行');
  }

  async runReviewLoop(): Promise<unknown> {
    throw new Error('SelfDevRuntime 未装配（需提供 llmClient + forgekinConfigs），闭环不可执行');
  }

  async runTestLoop(): Promise<unknown> {
    throw new Error('SelfDevRuntime 未装配（需提供 llmClient + forgekinConfigs），闭环不可执行');
  }
}

export default function Plugin(ctx: Context, options: EvolutionServiceOptions = {}): void {
  ctx.forgeEvolution = new EvolutionService(ctx, options);
}
