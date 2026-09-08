/**
 * System prompt builder (self-contained port of clowder `SystemPromptBuilder.ts`).
 *
 * Builds per-invocation system prompts. The heavy static-identity + invocation
 * context generation delegates to the injected `CatContextPort.promptPipeline`
 * (the host's hook pipeline seam — EP2 wires it). Roster / review / dossier /
 * model / config / workflow-trigger / MCP-tools reads go through the injected
 * `CatContextPort` + `FileSystemSeam`. Pure functions, no side effects.
 */

import type {
  CatConfig,
  CatId,
  CompiledPackBlocks,
  ConciergeConfig,
  CrossThreadCoordination,
  WorldContextEnvelope,
} from '@flowforge/cats-shared';
import type { CatContextPort } from '../ports/cat-context.ts';
import type { FileSystemSeam } from '../ports/file-system.ts';
import {
  loadMcpToolsSection,
  loadWorkflowTriggers,
} from './prompt-template-loader.ts';
import { RICH_BLOCK_SHORT } from './rich-block-rules.ts';

const MERGE_GATE_SOURCE_PROVENANCE_TRIGGER = '- MG provenance override：外部finding修完后等PR truth，不@旧reviewer。';

/** Context for a single cat invocation. */
export interface InvocationContext {
  /** Which cat is being invoked. */
  catId: CatId;
  /** independent = sole responder, serial = part of a chain, parallel = concurrent ideation. */
  mode: 'independent' | 'serial' | 'parallel';
  /** 1-based position in chain (only for serial mode). */
  chainIndex?: number;
  /** Total cats in chain (only for serial mode). */
  chainTotal?: number;
  /** Other cats in this invocation (for teammate awareness). */
  teammates: readonly CatId[];
  /** Whether MCP tools are available for this cat. */
  mcpAvailable: boolean;
  /** Whether this invocation already receives compiled L0 natively. */
  nativeL0Injected?: boolean;
  /** Prompt-level tags like 'critique' (from IntentParser). */
  promptTags?: readonly string[];
  /** Whether A2A collaboration prompt should be injected. */
  a2aEnabled?: boolean;
  /** Direct-message sender (A2A) — invoked cat must reply to this cat. */
  directMessageFrom?: CatId;
  /** F167 L1: ping-pong streak warning. */
  pingPongWarning?: {
    pairedWith: CatId;
    count: number;
  };
  /** F193/F167 Phase R: cross-thread reply guidance. */
  crossThreadReplyHint?: {
    sourceThreadId: string;
    senderCatId: CatId;
    effectClass?: 'fyi' | 'coordinate' | 'investigate' | 'assign_work';
    coordination?: CrossThreadCoordination;
  };
  /** F032 Phase D2: thread participant activity for @ disambiguation. */
  activeParticipants?: readonly unknown[];
  /** F042: thread-scoped routing policy summary. */
  routingPolicy?: unknown;
  /** F073 P4: SOP stage hint. */
  sopStageHint?: unknown;
  /** F091: active Signal articles. */
  activeSignals?: readonly unknown[];
  /** F092: voice companion mode. */
  voiceMode?: boolean;
  /** Thread ID — injected for tools that need it. */
  threadId?: string;
  /** F087: bootcamp state. */
  bootcampState?: unknown;
  /** F155: matched guide candidate. */
  guideCandidate?: unknown;
  /** F087: number of cats currently registered. */
  bootcampMemberCount?: number;
  /** F129: compiled pack blocks. */
  packBlocks?: CompiledPackBlocks | null;
  /** F163: pre-fetched always_on + constitutional docs. */
  alwaysOnDocs?: readonly unknown[];
  /** F093: world context envelope. */
  worldContext?: WorldContextEnvelope;
  /** F229: concierge thread marker + config. */
  threadKind?: 'concierge';
  conciergeConfig?: ConciergeConfig;
}

export interface StaticIdentityOptions {
  /** Whether native MCP tools are available (Claude with --mcp-config). */
  mcpAvailable?: boolean;
  /** F129: compiled pack blocks to inject. */
  packBlocks?: CompiledPackBlocks | null;
  /** F237: insert `── [SN] Name ──` markers before each segment. */
  annotateSegments?: boolean;
}

interface CallableMentionsResult {
  readonly mentions: string[];
  readonly hasDuplicateDisplayNames: boolean;
  readonly uniqueHandleExample: string | null;
}

export function pickVariantMention(id: string, config: CatConfig): string {
  const expected = `@${id}`.toLowerCase();
  const byId = config.mentionPatterns.find((p) => p.toLowerCase() === expected);
  if (byId) return byId;
  if (config.mentionPatterns.length > 0) {
    return [...config.mentionPatterns].sort((a, b) => a.length - b.length)[0]!;
  }
  return `@${id}`;
}

function pickDisplayNameMention(config: CatConfig): string | null {
  const expected = `@${config.displayName}`.toLowerCase();
  return config.mentionPatterns.find((p) => p.toLowerCase() === expected) ?? null;
}

function pickDisplayNameOrVariantMention(id: string, config: CatConfig): string {
  return pickDisplayNameMention(config) ?? pickVariantMention(id, config);
}

/** Build the list of callable teammate mentions. */
export function buildCallableMentions(catContext: CatContextPort, currentCatId: CatId): CallableMentionsResult {
  const all = catContext.getAllConfigs();
  const entries = Object.entries(all)
    .filter(([id]) => id !== currentCatId && catContext.isCatAvailable(id))
    .map(([id, config]) => ({ id, config }));

  if (entries.length === 0) {
    return { mentions: [], hasDuplicateDisplayNames: false, uniqueHandleExample: null };
  }

  const byDisplayName = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = byDisplayName.get(entry.config.displayName);
    if (group) {
      group.push(entry);
    } else {
      byDisplayName.set(entry.config.displayName, [entry]);
    }
  }

  const hasDuplicateDisplayNames = Array.from(byDisplayName.values()).some((group) => group.length > 1);
  const mentions: string[] = [];
  const seen = new Set<string>();
  let uniqueHandleExample: string | null = null;

  for (const entry of entries) {
    const group = byDisplayName.get(entry.config.displayName) ?? [];
    const mention =
      group.length <= 1 || entry.config.isDefaultVariant
        ? pickDisplayNameOrVariantMention(entry.id, entry.config)
        : pickVariantMention(entry.id, entry.config);
    if (group.length > 1 && !entry.config.isDefaultVariant && uniqueHandleExample === null) {
      uniqueHandleExample = mention;
    }
    if (!seen.has(mention)) {
      seen.add(mention);
      mentions.push(mention);
    }
  }

  return { mentions, hasDuplicateDisplayNames, uniqueHandleExample };
}

/** Format a cat's handle-free identity label, anti-spoofing via variant label. */
export function formatHandleFreeLabel(catId: string, config: CatConfig | undefined): string {
  if (!config) return catId;
  const variantPart = config.variantLabel ? ` ${config.variantLabel}` : '';
  return `${config.displayName}${variantPart}(${catId})`;
}

function compactRosterModel(model: string): string {
  return model.replace(/-\d{8}$/u, '').replace(/^kimi-code\//u, '');
}

function compactRosterCell(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

/** @segment S13 — MCP tools section (loaded from template). */
export function getMcpToolsSection(fileSystem: FileSystemSeam): string {
  return `\n${loadMcpToolsSection(fileSystem, { RICH_BLOCK_SHORT })}`;
}

function ensureMergeGateSourceProvenanceTrigger(content: string): string {
  if (content.includes('MG provenance override') && content.includes('外部finding修完后等PR truth')) {
    return content;
  }
  return `${content.trimEnd()}\n${MERGE_GATE_SOURCE_PROVENANCE_TRIGGER}`;
}

/** @segment S6 — Per-breed workflow triggers (loaded from template). */
export function getWorkflowTriggers(fileSystem: FileSystemSeam): Record<string, string> {
  const triggers = loadWorkflowTriggers(fileSystem);
  return Object.fromEntries(
    Object.entries(triggers).map(([breed, content]) => [breed, ensureMergeGateSourceProvenanceTrigger(content)]),
  );
}

/** @segment F-Ground-3 — Build teammate roster table (excludes current cat). */
export function buildTeammateRoster(catContext: CatContextPort, currentCatId: CatId): string | null {
  const all = catContext.getAllConfigs();
  const entries = Object.entries(all).filter(([id]) => id !== currentCatId && catContext.isCatAvailable(id));
  if (entries.length === 0) return null;

  const rows: string[] = [];
  for (const [id, config] of entries) {
    const label = config.variantLabel
      ? `${config.displayName} ${config.variantLabel}`
      : config.nickname
        ? `${config.displayName}/${config.nickname}`
        : config.displayName;
    const pronouns = catContext.dossier.getL0Pronouns(id, catContext.rootDir)?.split('/')[0]?.trim();
    const rosterLabel = pronouns ? `${config.nickname ?? label}（${pronouns}）` : label;
    const mention = pickVariantMention(id, config);
    let resolvedModel = catContext.resolvedModel(id) || config.defaultModel;
    resolvedModel = compactRosterModel(resolvedModel);
    const mentionCell = resolvedModel ? `${mention} · ${resolvedModel}` : mention;
    const dossierSummary = catContext.dossier.getRosterSummary(id, catContext.rootDir);
    const strengths = compactRosterCell(dossierSummary ?? config.teamStrengths ?? config.roleDescription, 52);
    const restrictionsNote =
      config.restrictions && config.restrictions.length > 0 ? `**硬限制**：${config.restrictions.join('、')}` : null;
    const cautionCell = compactRosterCell(
      [config.caution ?? null, restrictionsNote].filter(Boolean).join('；') || '—',
      72,
    );
    rows.push(`| ${rosterLabel} | ${mentionCell} | ${strengths} | ${cautionCell} |`);
  }

  return [
    '## 队友名册',
    '| 猫猫 | @mention · 当前模型 | 擅长 | 注意 |',
    '|------|---------|------|------|',
    ...rows,
  ].join('\n');
}

/**
 * Build static identity prompt — persistent across invocations.
 * Delegates to the injected prompt pipeline seam (EP2 wires the host hook
 * pipeline). Returns '' for an unknown cat.
 */
export function buildStaticIdentity(
  catContext: CatContextPort,
  catId: CatId,
  options?: StaticIdentityOptions,
): string {
  const config = catContext.getConfig(catId as string);
  if (!config) return '';
  return catContext.promptPipeline.buildStaticIdentity(catId as string, {
    mcpAvailable: options?.mcpAvailable,
  });
}

/**
 * Build the pack-only slice of the static identity (F203 Phase C). User-message
 * systemPrompt carries ONLY the F129 pack blocks. Returns '' when there are no
 * pack blocks — route layer then omits the prepend.
 */
export function buildStaticIdentityPackOnly(
  catContext: CatContextPort,
  catId: CatId,
  options?: StaticIdentityOptions,
): string {
  const config = catContext.getConfig(catId as string);
  if (!config) return '';
  const pb = options?.packBlocks ?? null;
  if (!pb) return '';
  const blocks = [pb.masksBlock, pb.workflowsBlock, pb.guardrailBlock, pb.defaultsBlock, pb.worldDriverSummary].filter(
    (b): b is string => typeof b === 'string' && b.trim().length > 0,
  );
  return blocks.join('\n\n');
}

/**
 * Build dynamic invocation context — changes per call.
 * Delegates to the injected prompt pipeline seam.
 */
export function buildInvocationContext(catContext: CatContextPort, context: InvocationContext): string {
  const config = catContext.getConfig(context.catId as string);
  if (!config) return '';
  return catContext.promptPipeline.buildInvocationContext(context as unknown as Record<string, unknown>);
}

/**
 * F032 Phase D2: Build reviewer section for system prompt from the roster.
 */
export function buildReviewerSection(catContext: CatContextPort, catId: CatId): string | null {
  const roster = catContext.roster.getRoster();
  const policy = catContext.reviewPolicy;

  if (Object.keys(roster).length === 0) return null;
  const currentEntry = roster[catId];
  if (!currentEntry) return null;

  const crossFamily: string[] = [];
  const sameFamily: string[] = [];
  const unavailable: string[] = [];

  for (const [id, entry] of Object.entries(roster)) {
    if (id === catId) continue;
    if (!catContext.roster.catHasRole(id, 'peer-reviewer')) continue;

    const config = catContext.getConfig(id);
    const displayName = config?.displayName ?? id;
    const isLead = catContext.roster.isCatLead(id);
    const isDifferentFamily = entry.family !== currentEntry.family;

    const tags: string[] = [];
    if (isDifferentFamily) tags.push(entry.family);
    if (isLead) tags.push('lead');
    const desc = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    const mention = `@${id}`;
    const line = `- ${mention}${desc}`;

    const isEffectivelyAvailable = !policy.excludeUnavailable || catContext.isCatAvailable(id);
    if (isEffectivelyAvailable) {
      if (isDifferentFamily) {
        crossFamily.push(line);
      } else {
        sameFamily.push(line);
      }
    } else {
      unavailable.push(`- ${mention} (${displayName}, 没猫粮)`);
    }
  }

  let available: string[];
  let fallbackNote: string | null = null;
  if (policy.requireDifferentFamily) {
    if (crossFamily.length > 0) {
      available = crossFamily;
    } else if (sameFamily.length > 0) {
      available = sameFamily;
      fallbackNote = '[注意] 没有跨家族 reviewer 可用，以下同家族猫可作为 fallback：';
    } else {
      available = [];
    }
  } else {
    available = [...crossFamily, ...sameFamily];
  }

  if (available.length === 0 && unavailable.length === 0) return null;

  const lines: string[] = ['## 你当前的 Reviewers', ''];
  if (available.length > 0) {
    lines.push(fallbackNote ?? '根据 roster 配置，你当前可以找以下猫 review：');
    lines.push(...available);
    lines.push('');
  }
  if (unavailable.length > 0) {
    lines.push('[注意] 以下猫当前不可用：');
    lines.push(...unavailable);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build identity system prompt for a cat invocation.
 * Backward-compatible: staticIdentity + reviewer + invocationContext.
 */
export function buildSystemPrompt(
  catContext: CatContextPort,
  context: InvocationContext,
): string {
  const packBlocks = context.packBlocks;
  const staticPart = buildStaticIdentity(catContext, context.catId, {
    mcpAvailable: context.mcpAvailable,
    ...(packBlocks !== undefined ? { packBlocks } : {}),
  });
  if (!staticPart) return '';

  const parts: string[] = [staticPart];
  const reviewerSection = buildReviewerSection(catContext, context.catId);
  if (reviewerSection) parts.push(reviewerSection);
  const dynamicPart = buildInvocationContext(catContext, context);
  if (dynamicPart) parts.push(dynamicPart);

  return parts.join('\n\n');
}