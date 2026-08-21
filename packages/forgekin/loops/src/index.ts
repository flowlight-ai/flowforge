/**
 * @flowforge/forgekin-loops — 阶段7 T7.7 五自进化闭环域 Cordis 插件
 *
 * 挂载 `ctx.forgeLoops`：SelfDevLoopBase 五步循环框架（Discover→Plan→Act→Verify→Persist，
 * 不变量 I1-I8）+ 五闭环实现（doc/code/framework/review/test），
 * TS 重写自 Python `evolution/self_dev_{base,doc,code,framework,review,test}.py`。
 */
import { Context, Service } from '@flowforge/cordis';
import { SelfDevLoopBase, SelfDevLoopOptions } from './self-dev-loop.js';
import { SelfDevDocLoop } from './loops/doc-loop.js';
import { SelfDevCodeLoop } from './loops/code-loop.js';
import { SelfDevFrameworkLoop } from './loops/framework-loop.js';
import { SelfDevReviewLoop } from './loops/review-loop.js';
import { SelfDevTestLoop } from './loops/test-loop.js';
import { PersistEngine, LlmChatClient } from './types.js';
import { ForgekinConfig } from './self-dev-loop.js';
import { LoopExecutionRecord } from './models.js';

export * from './models.js';
export * from './errors.js';
export * from './types.js';
export * from './self-dev-loop.js';
export * from './loops/doc-loop.js';
export * from './loops/code-loop.js';
export * from './loops/framework-loop.js';
export * from './loops/review-loop.js';
export * from './loops/test-loop.js';

export interface LoopsServiceOptions {
  /** LLM 客户端（F045 Trae 桥接，必填） */
  readonly llmClient: LlmChatClient;
  /** 治理层（缺省 NoopPersistEngine） */
  readonly persistEngine?: PersistEngine | undefined;
  /** Forgekin 配置（projectRoot 必填） */
  readonly forgekinConfig: ForgekinConfig;
  /** 当前可进化智能体觉醒阶（E1-E6，缺省 E3） */
  readonly awakeningStage?: string | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 自进化闭环域：五闭环（doc/code/framework/review/test） */
    forgeLoops: LoopsService;
  }
}

export class LoopsService extends Service {
  readonly docLoop: SelfDevDocLoop;
  readonly codeLoop: SelfDevCodeLoop;
  readonly frameworkLoop: SelfDevFrameworkLoop;
  readonly reviewLoop: SelfDevReviewLoop;
  readonly testLoop: SelfDevTestLoop;
  private readonly loops: SelfDevLoopBase[];

  constructor(ctx: Context, options: LoopsServiceOptions) {
    super(ctx, 'forgeLoops');
    if (!options.llmClient) {
      throw new Error('LoopsService 必须注入 llmClient（红线 12：依赖注入）');
    }
    if (!options.forgekinConfig?.projectRoot) {
      throw new Error('LoopsService 的 forgekinConfig 必须包含 projectRoot（红线 11：路径不硬编码）');
    }
    const baseOptions: SelfDevLoopOptions = {
      llmClient: options.llmClient,
      forgekinConfig: options.forgekinConfig,
      persistEngine: options.persistEngine,
      awakeningStage: options.awakeningStage,
    };
    this.docLoop = new SelfDevDocLoop(baseOptions);
    this.codeLoop = new SelfDevCodeLoop(baseOptions);
    this.frameworkLoop = new SelfDevFrameworkLoop(baseOptions);
    this.reviewLoop = new SelfDevReviewLoop(baseOptions);
    this.testLoop = new SelfDevTestLoop(baseOptions);
    this.loops = [this.docLoop, this.codeLoop, this.frameworkLoop, this.reviewLoop, this.testLoop];
  }

  /**
   * 按 loop_type 获取闭环实例。
   * @throws Error 未知 loop_type
   */
  getLoop(loopType: string): SelfDevLoopBase {
    const loop = this.loops.find((l) => l.loopType === loopType);
    if (!loop) {
      throw new Error(`未知闭环类型: ${loopType}（合法值: doc/code/framework/review/test）`);
    }
    return loop;
  }

  /** 执行一次五步循环（context 支持 awakening_stage 覆盖） */
  runOnce(loopType: string, context: Record<string, unknown>): Promise<{ loopType: string; records: LoopExecutionRecord[]; summary: { total: number; passed: number; failed: number; reflectTotal: number } }> {
    return this.getLoop(loopType).runOnce(context);
  }

  /** 闭环快照（trace 日志） */
  snapshot(): Array<{ loopType: string; minAwakeningStage: string }> {
    return this.loops.map((l) => ({ loopType: l.loopType, minAwakeningStage: l.minAwakeningStage }));
  }
}

export default function Plugin(ctx: Context, options: LoopsServiceOptions) {
  return ctx.plugin(LoopsService, options);
}
