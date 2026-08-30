/**
 * F070 Phase 2: Dispatch Mission Pack
 *
 * Builds structured mission context from thread metadata and formats
 * it for system prompt injection when dispatching cats to external projects.
 *
 * 移植自 clowder-ai `config/governance/mission-pack.ts`。
 * 改造：formatMissionPackPrompt 原依赖 prompt-template-loader.renderSegment('M1')，
 * 此处改为注入式 renderer（缺省输出简洁 markdown 段）。
 */
import type { DispatchMissionPack } from '@flowforge/cats-shared';

export interface ThreadContext {
  title?: string | undefined;
  phase?: string | undefined;
  backlogItemId?: string | undefined;
}

/**
 * Build a structured mission pack from thread metadata.
 * This is injected into the system prompt when dispatching to external projects.
 *
 * Returns `null` when the thread has no concrete mission/work-item content
 * (clowder-ai#1037 accepted scope). Only `title` and `backlogItemId` can supply
 * that content — `phase` alone leaves `mission` / `work_item` as placeholders
 * ('External project task' / 'unspecified'), which the model interprets as
 * "dispatcher sent the marker but forgot the task body". So `phase` by itself
 * is NOT an injection anchor.
 */
export function buildMissionPack(thread: ThreadContext): DispatchMissionPack | null {
  const title = thread.title?.trim() ? thread.title.trim() : undefined;
  const phase = thread.phase?.trim() ? thread.phase.trim() : undefined;
  const backlogItemId = thread.backlogItemId?.trim() ? thread.backlogItemId.trim() : undefined;

  // Anchor set: only fields that can supply concrete mission/work-item content.
  if (!title && !backlogItemId) {
    return null;
  }

  return {
    mission: title ?? 'External project task',
    workItem: backlogItemId ?? title ?? 'unspecified',
    phase: phase ?? 'unknown',
    doneWhen: [],
    links: [],
  };
}

/** Mission 段渲染器（宿主可注入模板引擎，如 prompt-hooks 管线）。 */
export type MissionPromptRenderer = (vars: {
  MISSION: string;
  WORK_ITEM: string;
  PHASE: string;
  DONE_WHEN_BLOCK: string;
  LINKS_BLOCK: string;
}) => string | null;

function defaultMissionRenderer(vars: {
  MISSION: string;
  WORK_ITEM: string;
  PHASE: string;
  DONE_WHEN_BLOCK: string;
  LINKS_BLOCK: string;
}): string {
  const lines = [
    '## Dispatch Mission',
    `- mission: ${vars.MISSION}`,
    `- work_item: ${vars.WORK_ITEM}`,
    `- phase: ${vars.PHASE}`,
  ];
  if (vars.DONE_WHEN_BLOCK) lines.push(vars.DONE_WHEN_BLOCK);
  if (vars.LINKS_BLOCK) lines.push(vars.LINKS_BLOCK);
  return lines.join('\n');
}

/**
 * Format mission pack as a prompt block for system prompt injection.
 * clowder-ai 模板：assets/prompt-templates/m1-dispatch-mission.md（渲染器注入）。
 */
export function formatMissionPackPrompt(pack: DispatchMissionPack, renderer?: MissionPromptRenderer): string {
  const doneWhenBlock =
    pack.doneWhen.length > 0 ? ['done_when:', ...pack.doneWhen.map((c) => `  - ${c}`)].join('\n') : '';
  const linksBlock = pack.links.length > 0 ? ['links:', ...pack.links.map((l) => `  - ${l}`)].join('\n') : '';

  const rendered = renderer?.({
    MISSION: pack.mission,
    WORK_ITEM: pack.workItem,
    PHASE: pack.phase,
    DONE_WHEN_BLOCK: doneWhenBlock,
    LINKS_BLOCK: linksBlock,
  });
  return rendered ?? defaultMissionRenderer({
    MISSION: pack.mission,
    WORK_ITEM: pack.workItem,
    PHASE: pack.phase,
    DONE_WHEN_BLOCK: doneWhenBlock,
    LINKS_BLOCK: linksBlock,
  });
}
