/**
 * HookPipeline — C41（F237 Phase 2-C）。
 *
 * 按 manifest order 执行指定 stage 的 hooks，产出 PromptPatch[]（渲染内容）
 * + TraceEvent[]（可观测性）。
 *
 * 每个 hook 的执行链路：
 *   1. enabled（基线）→ 关闭则 TraceEventDisabled
 *   2. resolver 判定 → 条件不满足则 TraceEventSkipped
 *   3. 解析 TEMPLATE_VARIANT（D7/D15 多模板 hook）
 *   4. 用 vars 渲染模板 → PromptPatch + TraceEventFired
 *
 * TS 移植自 clowder-ai `domains/prompt-hooks/HookPipeline.ts`。
 * 插件化改造决策：
 *   - renderer 作为构造参数注入（缺省内置 renderFromTemplatePath 回退）
 *   - resolvers 为 ReadonlyMap 注入（宿主可注册自定义 resolver）
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import type {
  AssemblerInput,
  HookResolver,
  HookStage,
  PromptPatch,
  RegisteredHook,
  ResolveResult,
  TraceEvent,
} from './types.js';
import type { HookRegistry } from './hook-registry.js';

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export interface PipelineResult {
  /** 已渲染内容补丁，按顺序，每 fired hook 一个。 */
  patches: PromptPatch[];
  /** stage 内全部 hooks 的 trace 事件（fired/skipped/disabled）。 */
  events: TraceEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 内容哈希（前 16 位 hex，紧凑存储）。 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 粗略 token 估算：混合中英文内容约 4 字符/token。
 * 仅用于 trace 展示 — 不用于计费。
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

// ---------------------------------------------------------------------------
// Renderer interface（与模板加载器解耦，便于测试）
// ---------------------------------------------------------------------------

/**
 * 模板渲染函数签名。返回渲染后的内容，模板缺失返回 null。
 * 对应 clowder-ai prompt-template-loader.renderSegment(segmentId, vars)。
 */
export type TemplateRenderer = (segmentId: string, vars: Record<string, string>) => string | null;

// ---------------------------------------------------------------------------
// HookPipeline
// ---------------------------------------------------------------------------

export class HookPipeline {
  constructor(
    private readonly registry: HookRegistry,
    private readonly resolvers: ReadonlyMap<string, HookResolver>,
    private readonly renderer: TemplateRenderer,
  ) {}

  /**
   * 回退渲染：从 hook 目录读取同目录模板文件。
   * 当主 renderer 返回 null（模板未注册进 TEMPLATE_FILES 但磁盘存在，
   * 如 B1/R1/R2）时使用。
   */
  private renderFromTemplatePath(hook: RegisteredHook, vars: Record<string, string>): string | null {
    if (!hook.templatePath || !existsSync(hook.templatePath)) return null;
    const raw = readFileSync(hook.templatePath, 'utf-8');
    // 剥 HTML 注释（同 prompt-template-loader.stripComments 逻辑）
    const stripped = raw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('<!--'))
      .join('\n')
      .trim();
    if (!stripped) return null;
    // 渲染 {{VAR}} 占位符（同 prompt-template-loader.renderTemplate 逻辑）
    return stripped.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = vars[key as keyof typeof vars];
      return value !== undefined ? value : match;
    });
  }

  /**
   * 渲染 fired hook 的内容：CONTENT passthrough → 模板 → 文件回退。
   * 返回 null 表示无模板（调用方发 template_missing trace）。
   */
  private renderContent(hook: RegisteredHook, templateId: string, vars: Record<string, string>): string | null {
    // Resolver 内容直通：resolver 提供 CONTENT var 时表示最终内容已组装完成
    // （如 S6 breed 工作流触发、S13 预渲染 MCP tools 段），跳过模板渲染 —
    // 模板文件可能只是数据源（YAML）或只期望 legacy 路径提供的 vars。
    if (vars.CONTENT) return vars.CONTENT;
    return this.renderer(templateId, vars) ?? this.renderFromTemplatePath(hook, vars);
  }

  /**
   * 按 manifest order 执行 stage 内全部 hooks。
   * 每个 hook：enabled → resolve → render → patch + trace。
   *
   * 用 manifest 基线判定 enabled/version。运行期覆盖（HookOverrideStore）
   * 由宿主另行接入。
   */
  executeStage(stage: HookStage, input: AssemblerInput): PipelineResult {
    const hooks = this.registry.getStageHooks(stage);
    const patches: PromptPatch[] = [];
    const events: TraceEvent[] = [];

    for (const hook of hooks) {
      const hookId = hook.manifest.id;
      const ts = Date.now();

      // 1. enabled 检查 — manifest 基线
      if (!hook.manifest.enabled) {
        events.push({
          hookId,
          stage,
          timestamp: ts,
          status: 'disabled',
          disabledBy: 'manifest',
        });
        continue;
      }

      // 2. resolve：运行 resolver 或无条件触发
      const resolver = this.resolvers.get(hookId);
      const result: ResolveResult = resolver ? resolver.resolve(input) : { status: 'fired', vars: {} };

      if (result.status === 'skipped') {
        events.push({
          hookId,
          stage,
          timestamp: ts,
          status: 'skipped',
          reasonCode: result.reasonCode,
          reason: result.reason,
        });
        continue;
      }

      // 3. 解析模板变体 + 渲染内容
      const templateId = result.vars.TEMPLATE_VARIANT ?? hookId;
      const content = this.renderContent(hook, templateId, result.vars);
      if (!content) {
        events.push({
          hookId,
          stage,
          timestamp: ts,
          status: 'skipped',
          reasonCode: 'template_missing',
          reason: `Template '${templateId}' not found`,
        });
        continue;
      }

      // 4. 产出 patch + trace（manifest version）
      patches.push({ hookId, content, order: hook.manifest.order });
      events.push({
        hookId,
        stage,
        timestamp: ts,
        status: 'fired',
        version: hook.manifest.version,
        contentHash: hashContent(content),
        tokenEstimate: estimateTokens(content),
      });
    }

    return { patches, events };
  }

  /**
   * 将 patches 组装为单个 prompt 字符串。
   * patches 已按序（来自 executeStage），双换行连接。
   */
  static assemblePatches(patches: readonly PromptPatch[]): string {
    return patches.map((p) => p.content).join('\n\n');
  }
}
