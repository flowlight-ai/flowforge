/**
 * 会话文本净化 — 剥离泄漏进可见文本的内部 tool_uses JSON payload。
 *
 * 移植自 clowder-ai
 * `packages/api/src/domains/cats/services/agents/routing/route-helpers.ts`
 * （仅提取 `stripLeakedToolCallPayload` 及其私有依赖链 + 流式 stripper，
 * 其余 route-helpers 内容不随本包移植）。
 *
 * - 泄漏形态：模型把内部 tool call 信封（`functions.*` / `mcp__*` /
 *   `multi_tool_use.*` 的 recipient_name payload）当作正文吐出
 * - 保留形态：紧跟「示例 / 例如 / example / ```json」等示例前缀的
 *   JSON 是有意展示，不剥离
 * - 流式 stripper：按 chunk 增量剥离，潜在泄漏前缀先扣留、flush 再结算
 *
 * @module @flowforge/cats-session/sanitize
 */

function isInternalToolRecipientName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('functions.') || value.startsWith('mcp__') || value.startsWith('multi_tool_use.'))
  );
}

function looksLikeLeakedToolCallPayload(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('{')) return false;

  try {
    const parsed = JSON.parse(trimmed) as {
      tool_uses?: Array<{ recipient_name?: unknown }>;
      recipient_name?: unknown;
    };
    if (Array.isArray(parsed.tool_uses)) {
      return parsed.tool_uses.some((item) => isInternalToolRecipientName(item?.recipient_name));
    }
    return isInternalToolRecipientName(parsed.recipient_name);
  } catch {
    return false;
  }
}

const LEAKED_TOOL_CALL_SIGNATURES = [
  '{"tool_uses":[{"recipient_name":"functions.',
  '{"tool_uses":[{"recipient_name":"mcp__',
  '{"tool_uses":[{"recipient_name":"multi_tool_use.',
  '{"recipient_name":"functions.',
  '{"recipient_name":"mcp__',
  '{"recipient_name":"multi_tool_use.',
];

const INTENTIONAL_JSON_EXAMPLE_LINE_RE =
  /^(?:(?:(?:文档|JSON)\s*)?示例|for\s+example|example|json\s+example|例如|比如)\s*(?:[:：]\s*)?$/i;

function looksLikePotentialLeakedToolCallPayloadPrefix(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('{')) return false;

  const compact = trimmed.replace(/\s+/g, '');
  return LEAKED_TOOL_CALL_SIGNATURES.some(
    (signature) => signature.startsWith(compact) || compact.startsWith(signature),
  );
}

function findLineStartPayloadIndex(
  content: string,
  predicate: (candidate: string) => boolean,
): { index: number; candidate: string } | null {
  const lines = content.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('{')) {
      offset += line.length + 1;
      continue;
    }

    const leadingWhitespace = line.length - trimmed.length;
    const candidate = lines.slice(i).join('\n');
    if (predicate(candidate)) {
      return { index: offset + leadingWhitespace, candidate };
    }
    offset += line.length + 1;
  }

  return null;
}

function isIntentionalJsonExamplePrefix(prefix: string): boolean {
  const trimmed = prefix.trimEnd();
  if (!trimmed) return false;

  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;
    if (/^```(?:json)?$/i.test(line)) return true;
    return INTENTIONAL_JSON_EXAMPLE_LINE_RE.test(line);
  }

  return false;
}

/**
 * Strip a leaked internal tool-call JSON payload from visible text.
 *
 * Keeps intentional JSON examples (prefixed by an example marker line or a
 * ```json fence) intact; otherwise returns only the text before the payload.
 */
export function stripLeakedToolCallPayload(content: string): string {
  if (!content) return content;

  const match = findLineStartPayloadIndex(content, looksLikeLeakedToolCallPayload);
  if (match) {
    const prefix = content.slice(0, match.index);
    if (isIntentionalJsonExamplePrefix(prefix)) {
      return content;
    }
    return prefix.replace(/\s+$/, '');
  }

  return content;
}

/** Incremental stripper state for streaming text chunks. */
export interface LeakedToolCallStreamStripper {
  push(content: string): string;
  flush(): string;
}

/**
 * Create a stream-safe stripper: holds back chunk tails that may grow into a
 * leaked payload, emits only the confirmed-clean prefix of each chunk.
 */
export function createLeakedToolCallStreamStripper(): LeakedToolCallStreamStripper {
  let pending = '';
  let pendingEmittedLength = 0;

  return {
    push(content: string): string {
      if (!content) return content;

      const combined = pending + content;
      const alreadyEmittedLength = pendingEmittedLength;
      pending = '';
      pendingEmittedLength = 0;

      const stripped = stripLeakedToolCallPayload(combined);
      if (stripped !== combined) {
        return stripped.slice(alreadyEmittedLength);
      }

      const match = findLineStartPayloadIndex(combined, looksLikePotentialLeakedToolCallPayloadPrefix);
      if (!match) {
        return combined.slice(alreadyEmittedLength);
      }

      const emittedPrefix = combined.slice(0, match.index).replace(/\s+$/, '');
      pending = combined;
      pendingEmittedLength = emittedPrefix.length;
      return emittedPrefix.slice(alreadyEmittedLength);
    },
    flush(): string {
      if (!pending) return '';

      const remaining = pending;
      const alreadyEmittedLength = pendingEmittedLength;
      pending = '';
      pendingEmittedLength = 0;
      return stripLeakedToolCallPayload(remaining).slice(alreadyEmittedLength);
    },
  };
}
