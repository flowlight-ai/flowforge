/**
 * PipelinePromptBuilder — C41（F237 Phase 2，AC-P2-6）。
 *
 * 基于 HookPipeline 的 prompt 构建器：管线执行 + scope 过滤组装。
 *
 * 插件化改造决策（相对 clowder-ai 原版）：
 *   - 移除单例缓存/模块级状态，改为显式实例（PipelinePromptBuilder 类），
 *     由插件层持有并注入资产目录；测试可独立构造
 *   - scope 过滤由调用方传入正则（clowder 硬编码 SCOPE_S/SCOPE_D），
 *     宿主可自由划定（如 forgekin 阶段仅 D 系生效）
 *   - trace 捕获（drainCapturedTraces）收敛为实例方法，随实例销毁
 *   - 裁剪 cats 专属 buildConciergePromptLines 拼接（concierge 段由
 *     宿主自行通过 scope 内 hook 或补丁注入实现）
 */

import type { AssemblerInput, HookStage, PromptPatch } from './types.js';
import { HookPipeline, type PipelineResult, type TemplateRenderer } from './hook-pipeline.js';
import type { HookRegistry } from './hook-registry.js';

// ---------------------------------------------------------------------------
// Builder options
// ---------------------------------------------------------------------------

export interface PromptBuilderOptions {
  /** session-init 阶段输出 scope（hookId 前缀正则，如 /^S\d/）。 */
  sessionScope?: RegExp;
  /** per-turn 阶段输出 scope。 */
  turnScope?: RegExp;
}

// ---------------------------------------------------------------------------
// PipelinePromptBuilder — 显式实例（可注入 registry/resolvers/renderer）
// ---------------------------------------------------------------------------

export class PipelinePromptBuilder {
  private readonly pipeline: HookPipeline;
  private readonly sessionScope: RegExp;
  private readonly turnScope: RegExp;

  /** 最近一次执行的 trace（供调用方持久化，随下次执行覆盖）。 */
  private capturedSessionTrace: PipelineResult | null = null;
  private capturedTurnTrace: PipelineResult | null = null;

  constructor(
    registry: HookRegistry,
    resolvers: ReadonlyMap<string, import('./types.js').HookResolver>,
    renderer?: TemplateRenderer,
    options?: PromptBuilderOptions,
  ) {
    this.pipeline = new HookPipeline(registry, resolvers, renderer ?? defaultFileRenderer);
    this.sessionScope = options?.sessionScope ?? /^S\d/;
    this.turnScope = options?.turnScope ?? /^D\d/;
  }

  /** 访问底层管线（高级用途：直接执行任意 stage）。 */
  get pipelineInstance(): HookPipeline {
    return this.pipeline;
  }

  /**
   * 构建 session-init prompt（S scope 默认）。
   * 管线执行全部 session-init hooks（S+L+B+C）以覆盖完整 trace，
   * 但输出只含 scope 内 hooks（对齐 legacy 行为）。
   */
  buildSessionPrompt(input: AssemblerInput, options?: { annotateSegments?: boolean }): string {
    const trace = this.pipeline.executeStage('session-init', input);
    this.capturedSessionTrace = trace;
    return this.assembleScoped(trace, this.sessionScope, options?.annotateSegments);
  }

  /**
   * 构建 per-turn prompt（D scope 默认）。
   * 管线执行全部 per-turn hooks（D+R+N），输出只含 scope 内 hooks。
   */
  buildTurnPrompt(input: AssemblerInput, options?: { annotateSegments?: boolean }): string {
    const trace = this.pipeline.executeStage('per-turn', input);
    this.capturedTurnTrace = trace;
    return this.assembleScoped(trace, this.turnScope, options?.annotateSegments);
  }

  /**
   * 构建完整 prompt（session-init + per-turn 全量输出，不过滤）。
   * 当管线本身就是唯一真相源时使用。
   */
  buildSystemPrompt(sessionInput: AssemblerInput, turnInput: AssemblerInput): {
    prompt: string;
    sessionTrace: PipelineResult;
    turnTrace: PipelineResult;
  } {
    const sessionTrace = this.pipeline.executeStage('session-init', sessionInput);
    const turnTrace = this.pipeline.executeStage('per-turn', turnInput);
    this.capturedSessionTrace = sessionTrace;
    this.capturedTurnTrace = turnTrace;
    const sessionOutput = HookPipeline.assemblePatches(sessionTrace.patches);
    const turnOutput = HookPipeline.assemblePatches(turnTrace.patches);
    return { prompt: [sessionOutput, turnOutput].filter(Boolean).join('\n\n'), sessionTrace, turnTrace };
  }

  /**
   * 取并清空最近捕获的管线 traces。
   * 由调用方（invocation 层）在构建 prompt 后调用一次，用于持久化
   * InjectionTraceSummary + Detail。
   */
  drainCapturedTraces(): { session: PipelineResult | null; turn: PipelineResult | null } {
    const result = { session: this.capturedSessionTrace, turn: this.capturedTurnTrace };
    this.capturedSessionTrace = null;
    this.capturedTurnTrace = null;
    return result;
  }

  /** 按 scope 过滤 patches 并组装（可选 segment 标注）。 */
  private assembleScoped(trace: PipelineResult, scope: RegExp, annotate?: boolean): string {
    const scopedPatches = trace.patches.filter((p) => scope.test(p.hookId));
    if (!annotate) return HookPipeline.assemblePatches(scopedPatches);

    // 标注模式：为 scope 内每个事件输出 `── [id] name ──` 标记。
    // fired → 带内容；skipped/disabled → 空标记（段缺失）。
    const patchMap = new Map(scopedPatches.map((p) => [p.hookId, p.content]));
    return trace.events
      .filter((ev) => scope.test(ev.hookId))
      .map((ev) => {
        const content = patchMap.get(ev.hookId);
        return content ? `── [${ev.hookId}] ${ev.hookId} ──\n${content}` : `── [${ev.hookId}] ${ev.hookId} ──`;
      })
      .join('\n\n');
  }
}

// ---------------------------------------------------------------------------
// 缺省 renderer — 直接从 hook 模板路径读取渲染
// ---------------------------------------------------------------------------

/** 缺省 renderer：无主渲染器时直接读 hook 同目录/回退目录模板文件。 */
function defaultFileRenderer(segmentId: string, vars: Record<string, string>): string | null {
  // 主 renderer 缺失时由 HookPipeline.renderFromTemplatePath 兜底 —
  // 此处返回 null 即触发文件回退路径。
  void segmentId;
  void vars;
  return null;
}

// ---------------------------------------------------------------------------
// 便捷函数（保持与 clowder 同名 API 形态，适配注入式构造）
// ---------------------------------------------------------------------------

/** 将 stage 执行结果按 scope 过滤并组装。 */
export function assemblePatchesForScope(patches: readonly PromptPatch[], scope: RegExp): string {
  return HookPipeline.assemblePatches(patches.filter((p) => scope.test(p.hookId)));
}

/** 便捷引用：执行指定 stage（需要已构造的管线实例）。 */
export function executeStage(
  pipeline: HookPipeline,
  stage: HookStage,
  input: AssemblerInput,
): PipelineResult {
  return pipeline.executeStage(stage, input);
}
