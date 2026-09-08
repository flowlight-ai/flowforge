/**
 * Context assembler (self-contained port of clowder `ContextAssembler.ts`).
 *
 * Assembles message-store history into a context string prepended to a cat's
 * prompt, solving cross-cat history invisibility. `formatMessage` is also reused
 * by the export route (chat log export). Sender-name resolution goes through the
 * injected `CatContextPort`; token estimation / time formatting are local pure
 * modules.
 */

import { isCrossThreadProvenance } from '@flowforge/cats-shared';
import { estimateTokens } from '../pure/token-estimate.ts';
import { formatPromptTime } from '../pure/format-prompt-time.ts';
import { isDelivered, type StoredMessage } from '../ports/message-store.ts';
import type { CatContextPort } from '../ports/cat-context.ts';

export interface ContextAssemblerOptions {
  /** Invocation-owned token ceiling for the already-selected history. */
  maxTotalTokens?: number;
}

export interface AssembledContext {
  contextText: string;
  messageCount: number;
  estimatedTokens: number;
}

const DEFAULT_MAX_TOTAL_TOKENS = 2000;
/** Injection-safety bound, not a per-member prompt policy. */
const PROMPT_MESSAGE_SAFETY_CHAR_LIMIT = 100_000;
/** Max chars for inline reply-to preview (saves agents a get_message call). */
const REPLY_PREVIEW_LENGTH = 60;

/** Build a lookup map from message array for O(1) replyTo resolution. */
export function buildMessageMap(messages: readonly StoredMessage[]): ReadonlyMap<string, StoredMessage> {
  const map = new Map<string, StoredMessage>();
  for (const m of messages) {
    map.set(m.id, m);
  }
  return map;
}

/**
 * Sanitize an external display name for safe embedding in prompt history
 * headers. Strips characters that could break the `[timestamp sender] content`
 * format or spoof other speakers.
 */
function sanitizeDisplaySegment(raw: string): string {
  return raw
    .replace(/[\n\r\u2028\u2029]/g, ' ')
    .replace(/[[\]]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .trim();
}

/**
 * Get display name for a connector source, including individual sender for
 * group chat messages. Format: `SenderName via Label` (group) | `Label` (p2p).
 */
export function getSourceDisplayName(source: {
  label: string;
  sender?: { id: string; name?: string };
}): string {
  const safeLabel = sanitizeDisplaySegment(source.label);
  if (source.sender) {
    const name = sanitizeDisplaySegment(source.sender.name || source.sender.id);
    return `${name} via ${safeLabel}`;
  }
  return safeLabel;
}

/**
 * Get display name for a message sender via the injected cat context.
 * catId === null → user ("co-creator"); otherwise resolve from config.
 */
export function getSenderName(catId: string | null, catContext?: Pick<CatContextPort, 'getConfig'>): string {
  if (catId === null) return 'co-creator';
  const config = catContext?.getConfig(catId);
  if (!config) return catId;
  const variantLabel = config.variantLabel?.trim();
  if (!variantLabel) return config.displayName;
  if (config.displayName.toLowerCase().includes(variantLabel.toLowerCase())) {
    return config.displayName;
  }
  return `${config.displayName}(${variantLabel})`;
}

/** Truncate content preserving both head (40%) and tail (60%). */
function truncateHeadTail(content: string, limit: number): string {
  const dropped = content.length - limit;
  const marker = `\n\n[...truncated ${dropped} chars...]\n\n`;
  const available = limit - marker.length;
  if (available <= 0) return content.slice(0, limit);
  const headSize = Math.floor(available * 0.4);
  const tailSize = available - headSize;
  return content.slice(0, headSize) + marker + content.slice(-tailSize);
}

/**
 * Format a single message for display. Shared by context assembly (with
 * truncation) and export (without truncation).
 *
 * @returns `[timestamp 角色名] 内容`
 */
export interface FormatMessageOptions {
  truncate?: number;
  formatTime?: (epochMs: number) => string;
  /** Message lookup map for inline reply-to preview. */
  messageMap?: ReadonlyMap<string, StoredMessage>;
  /** Sanitizer for parent content before inlining preview. */
  sanitizeContent?: (content: string) => string;
  catContext?: Pick<CatContextPort, 'getConfig'>;
}

export function formatMessage(msg: StoredMessage, options?: FormatMessageOptions): string {
  const time = (options?.formatTime ?? formatPromptTime)(msg.timestamp);
  const sender = msg.source
    ? getSourceDisplayName(msg.source)
    : getSenderName(msg.catId, options?.catContext);
  const sourceThreadId = msg.extra?.crossPost?.sourceThreadId;
  const crossPostTag = isCrossThreadProvenance(sourceThreadId, msg.threadId)
    ? ` ← from thread:${sourceThreadId.slice(0, 8)}`
    : '';

  let replyPrefix = '';
  if (msg.replyTo && options?.messageMap) {
    const parent = options.messageMap.get(msg.replyTo);
    if (parent) {
      const parentSender = parent.source ? getSourceDisplayName(parent.source) : getSenderName(parent.catId, options.catContext);
      const sanitized = options?.sanitizeContent ? options.sanitizeContent(parent.content) : parent.content;
      const raw = sanitized.replaceAll('\n', ' ');
      const preview = raw.length > REPLY_PREVIEW_LENGTH ? `${raw.slice(0, REPLY_PREVIEW_LENGTH)}…` : raw;
      replyPrefix = `[↩ ${parentSender}: ${preview}] `;
    }
  }

  let content = msg.content;
  if (options?.truncate !== undefined && content.length > options.truncate) {
    content = truncateHeadTail(content, options.truncate);
  }
  return `[${time} ${sender}${crossPostTag}] ${replyPrefix}${content}`;
}

/** Assemble recent thread history into a context string for prompt prepend. */
export function assembleContext(
  messages: readonly StoredMessage[],
  options?: ContextAssemblerOptions & { catContext?: Pick<CatContextPort, 'getConfig'> },
): AssembledContext {
  const maxTotalTokens = options?.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;

  // F117: exclude undelivered messages from prompt context. Also exclude
  // system-generated messages and briefing artifacts; exclude legacy error
  // messages labeled [错误] (context poisoning, PR #992).
  const deliveredMessages = messages.filter(
    (m) =>
      isDelivered(m) &&
      m.userId !== 'system' &&
      m.origin !== 'briefing' &&
      !(m.catId && m.content?.startsWith('[错误]')),
  );

  if (deliveredMessages.length === 0) {
    return { contextText: '', messageCount: 0, estimatedTokens: 0 };
  }

  const messageMap = buildMessageMap(deliveredMessages);
  const formatted = deliveredMessages.map((m) =>
    formatMessage(m, {
      truncate: PROMPT_MESSAGE_SAFETY_CHAR_LIMIT,
      messageMap,
      ...(options?.catContext ? { catContext: options.catContext } : {}),
    }),
  );

  const overheadTokens = estimateTokens('[对话历史 - 最近 99 条]\n[/对话历史]');

  let totalTokens = overheadTokens;
  let startIndex = formatted.length;
  for (let i = formatted.length - 1; i >= 0; i--) {
    const lineTokens = estimateTokens(`${formatted[i] ?? ''}\n`);
    if (totalTokens + lineTokens > maxTotalTokens) break;
    totalTokens += lineTokens;
    startIndex = i;
  }

  const included = formatted.slice(startIndex);
  if (included.length === 0) {
    return { contextText: '', messageCount: 0, estimatedTokens: 0 };
  }

  const header = `[对话历史 - 最近 ${included.length} 条]`;
  const contextText = `${header}\n${included.join('\n')}\n[/对话历史]`;

  return { contextText, messageCount: included.length, estimatedTokens: totalTokens };
}