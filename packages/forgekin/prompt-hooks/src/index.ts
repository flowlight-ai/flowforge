/**
 * @flowforge/forgekin-prompt-hooks — C41 声明式 prompt hook 管线 Cordis 插件。
 *
 * TS 移植自 clowder-ai `domains/prompt-hooks/`（F237 Phase 1+2）：
 *   - hook-manifest-parser：hook.yaml 清单解析校验
 *   - HookRegistry：扫描/注册（目录前缀 + order 唯一 + 模板存在性）
 *   - HookPipeline：按 stage 执行（enabled → resolver → TEMPLATE_VARIANT →
 *     渲染 → patch + trace）
 *   - PipelinePromptBuilder：session/turn/system 三路组装（scope 过滤）
 *   - InjectionTraceStore：双层 trace 持久化（summary 常驻 + detail TTL）
 *   - resolvers：通用内置 resolver + 注册表（46 个 cats 业务 resolver 由宿主注入）
 *   附赠资产：46 个 hook.yaml 清单 + 48 个 prompt 模板（全量复制自 clowder-ai）
 *
 * 插件化改造决策：
 *   - 所有组件实例化持有（无模块级单例），随插件生命周期
 *   - trace 后端可注入（MemoryTraceBackend 缺省 / JsonlTraceBackend / 宿主自研）
 *   - renderer 可覆盖（缺省 = 模板文件直读回退）
 *   - resolver 由宿主通过 registerResolver 注入（S1/D7 等业务判定）
 *
 * 消费者加载默认插件：
 * ```ts
 * import ForgePromptHooks from '@flowforge/forgekin-prompt-hooks'
 * ctx.plugin(ForgePromptHooks, { hooksDir?, templatesDir?, traceBackend? })
 * // ctx.forgePromptHooks.executeStage('session-init', input)
 * // ctx.forgePromptHooks.buildSessionPrompt(input) / .buildTurnPrompt(input)
 * // ctx.forgePromptHooks.persistTrace(summary, detail) / .listSummaries(threadId)
 * // ctx.forgePromptHooks.registerResolver('S1', myResolver)
 * ```
 *
 * @module @flowforge/forgekin-prompt-hooks
 */

import { fileURLToPath } from 'node:url';

import { Context, Service } from '@flowforge/cordis';

import type { HookStage, AssemblerInput, HookResolver, InjectionTraceDetail, InjectionTraceSummary } from './types.js';
import { HookRegistry } from './hook-registry.js';
import type { PipelineResult } from './hook-pipeline.js';
import { PipelinePromptBuilder } from './prompt-builder.js';
import { InjectionTraceStore, MemoryTraceBackend, type TraceBackend } from './injection-trace.js';
import { ResolverRegistry } from './resolvers.js';

// Re-export 核心实现 + 类型（子路径导入也各自可用）。
export * from './types.js';
export { HookRegistry } from './hook-registry.js';
export { HookPipeline, hashContent, estimateTokens } from './hook-pipeline.js';
export type { PipelineResult, TemplateRenderer } from './hook-pipeline.js';export { PipelinePromptBuilder, assemblePatchesForScope } from './prompt-builder.js';
export type { PromptBuilderOptions } from './prompt-builder.js';
export {
  InjectionTraceStore,
  MemoryTraceBackend,
  JsonlTraceBackend,
} from './injection-trace.js';
export type { TraceBackend, TraceBackendEntry } from './injection-trace.js';
export {
  ResolverRegistry,
  alwaysFireResolver,
  InputGatedResolver,
  VariantPickerResolver,
  ContentPassthroughResolver,
} from './resolvers.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** prompt hook 管线域（C41）：manifest 注册表 + stage 执行 + prompt 组装 + trace */
    forgePromptHooks: ForgePromptHooksService;
  }
}

/** 插件配置（ctx.plugin(ForgePromptHooks, config)）。 */
export interface ForgePromptHooksConfig {
  /** hooks 目录（缺省 = 包内 assets/prompt-hooks）。 */
  hooksDir?: string;
  /** 集中模板回退目录（缺省 = 包内 assets/prompt-templates）。 */
  templatesDir?: string;
  /** trace 持久化后端（缺省 = MemoryTraceBackend）。 */
  traceBackend?: TraceBackend;
  /** detail TTL 秒数（缺省 7 天）。 */
  detailTtlSeconds?: number;
  /** session-init 输出 scope（缺省 /^S\d/）。 */
  sessionScope?: RegExp;
  /** per-turn 输出 scope（缺省 /^D\d/）。 */
  turnScope?: RegExp;
}

/**
 * prompt hook 管线服务 — 挂载 `ctx.forgePromptHooks`。
 *
 * 提供：
 *   - registry：scan / listHooks / getHook / getStageHooks / registrySize
 *   - pipeline：executeStage（直接执行，返回 patches + events）
 *   - builder：buildSessionPrompt / buildTurnPrompt / buildSystemPrompt
 *   - trace：persistTrace / getSummary / getDetail / listTurnIds /
 *     listSummaries / deleteTurn / drainTraces
 *   - resolvers：registerResolver / registerResolvers / getResolver / resolverIds
 *   - renderer：setRenderer（覆盖模板渲染，缺省文件回退）
 */
export class ForgePromptHooksService extends Service {
  readonly registry: HookRegistry;
  readonly resolvers: ResolverRegistry;
  readonly traceStore: InjectionTraceStore;
  readonly builder: PipelinePromptBuilder;

  constructor(ctx: Context, config: ForgePromptHooksConfig = {}) {
    super(ctx, 'forgePromptHooks');

    const assetsRoot = fileURLToPath(new URL('../assets/', import.meta.url));
    const hooksDir = config.hooksDir ?? `${assetsRoot}prompt-hooks`;
    const templatesDir = config.templatesDir ?? `${assetsRoot}prompt-templates`;

    this.registry = new HookRegistry(hooksDir, templatesDir);
    this.registry.scan();

    this.resolvers = new ResolverRegistry();
    this.traceStore = new InjectionTraceStore(config.traceBackend ?? new MemoryTraceBackend(), {
      ...(config.detailTtlSeconds !== undefined ? { detailTtlSeconds: config.detailTtlSeconds } : {}),
    });
    this.builder = new PipelinePromptBuilder(
      this.registry,
      this.resolvers.toReadonlyMap(),
      undefined,
      {
        ...(config.sessionScope !== undefined ? { sessionScope: config.sessionScope } : {}),
        ...(config.turnScope !== undefined ? { turnScope: config.turnScope } : {}),
      },
    );
  }

  // ────────── registry ──────────

  /** 已注册 hooks（按 ID 排序）。 */
  listHooks() {
    return this.registry.list();
  }

  /** 按 ID 取已注册 hook。 */
  getHook(hookId: string) {
    return this.registry.getHook(hookId);
  }

  /** 取指定 stage 的 hooks（按 order 升序）。 */
  getStageHooks(stage: HookStage) {
    return this.registry.getStageHooks(stage);
  }

  /** 已注册 hook 数量。 */
  registrySize(): number {
    return this.registry.size();
  }

  // ────────── pipeline ──────────

  /** 执行指定 stage 全部 hooks（返回 patches + trace events）。 */
  executeStage(stage: HookStage, input: AssemblerInput): PipelineResult {
    return this.builder.pipelineInstance.executeStage(stage, input);
  }

  /** 构建 session-init prompt（scope 过滤，缺省 S 系）。 */
  buildSessionPrompt(input: AssemblerInput, options?: { annotateSegments?: boolean }): string {
    return this.builder.buildSessionPrompt(input, options);
  }

  /** 构建 per-turn prompt（scope 过滤，缺省 D 系）。 */
  buildTurnPrompt(input: AssemblerInput, options?: { annotateSegments?: boolean }): string {
    return this.builder.buildTurnPrompt(input, options);
  }

  /** 构建全量 prompt（session + turn 不过滤，管线即真相源）。 */
  buildSystemPrompt(sessionInput: AssemblerInput, turnInput: AssemblerInput): {
    prompt: string;
    sessionTrace: PipelineResult;
    turnTrace: PipelineResult;
  } {
    return this.builder.buildSystemPrompt(sessionInput, turnInput);
  }

  /** 取并清空最近捕获的管线 traces（invocation 层持久化用）。 */
  drainTraces(): { session: PipelineResult | null; turn: PipelineResult | null } {
    return this.builder.drainCapturedTraces();
  }

  // ────────── resolvers ──────────

  /** 注册单 hook resolver。 */
  registerResolver(hookId: string, resolver: HookResolver): void {
    this.resolvers.registerResolver(hookId, resolver);
  }

  /** 批量注册 resolver（如宿主导入的 cats 业务 resolver 表）。 */
  registerResolvers(resolvers: Readonly<Record<string, HookResolver>>): void {
    this.resolvers.registerResolvers(resolvers);
  }

  /** 取 resolver（未注册返回 undefined）。 */
  getResolver(hookId: string): HookResolver | undefined {
    return this.resolvers.getResolver(hookId);
  }

  /** 已注册 resolver ID 列表。 */
  resolverIds(): readonly string[] {
    return this.resolvers.getRegisteredResolverIds();
  }

  // ────────── trace ──────────

  /** 持久化 summary + detail + 索引。 */
  persistTrace(summary: InjectionTraceSummary, detail: InjectionTraceDetail): Promise<void> {
    return this.traceStore.persist(summary, detail);
  }

  getSummary(threadId: string, turnId: string): Promise<InjectionTraceSummary | null> {
    return this.traceStore.getSummary(threadId, turnId);
  }

  getDetail(threadId: string, turnId: string): Promise<InjectionTraceDetail | null> {
    return this.traceStore.getDetail(threadId, turnId);
  }

  listTurnIds(threadId: string, options?: { limit?: number; offset?: number }) {
    return this.traceStore.listTurnIds(threadId, options);
  }

  listSummaries(threadId: string, options?: { limit?: number; offset?: number }) {
    return this.traceStore.listSummaries(threadId, options);
  }

  deleteTurn(threadId: string, turnId: string): Promise<void> {
    return this.traceStore.deleteTurn(threadId, turnId);
  }
}

export default ForgePromptHooksService;
