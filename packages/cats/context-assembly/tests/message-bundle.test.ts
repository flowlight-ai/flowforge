/**
 * Contract tests — Message Bundle subdomain (B12).
 *
 * Uses real in-memory ports (`MemoryMessageStore` / `MemoryThreadStore`), no
 * mocks. Covers quote anchoring, source projection aggregation, MessageSelection
 * admission for reply/quote/cli-quote/rich-block sources + sorting, and carrier
 * read-back with tombstone fallbacks.
 */

import { describe, it, expect } from 'vitest';
import type { RichBlock } from '@flowforge/cats-shared';
import {
  MemoryMessageStore,
  MemoryThreadStore,
  type StoredMessage,
  type Thread,
} from '../src/index.ts';
import {
  resolveReadableQuoteAnchor,
  resolveExactQuoteAnchor,
  type QuoteAnchor,
} from '../src/index.ts';
import { MessageSelectionResolver } from '../src/index.ts';
import {
  projectMessageBundleGroupReadableContent,
  projectMessageBundleGroupQuoteSourceV3,
} from '../src/index.ts';

const USER = 'user-1';
const THREAD = 'thread-1';

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: THREAD,
    projectPath: '/p',
    title: 'Thread',
    createdBy: USER,
    ...overrides,
  };
}

function message(
  id: string,
  overrides: Partial<StoredMessage> = {},
  timestamp = 1000,
): StoredMessage {
  return {
    id,
    threadId: THREAD,
    userId: USER,
    catId: null,
    content: '',
    timestamp,
    ...overrides,
  };
}

function makeResolver(messages: StoredMessage[], { threadOverrides = {} } = {}) {
  const messageStore = new MemoryMessageStore(messages);
  const threadStore = new MemoryThreadStore();
  threadStore.put(thread(threadOverrides));
  return new MessageSelectionResolver({ messageStore, threadStore });
}

describe('quote anchoring', () => {
  it('resolveReadableQuoteAnchor normalizes whitespace and returns unique offsets', () => {
    const result = resolveReadableQuoteAnchor({ text: 'world' } as never, 'hello   world\nhere');
    expect(result).not.toBe('ambiguous_quote');
    expect(result).not.toBe('quote_mismatch');
    const anchor = result as QuoteAnchor;
    expect('hello   world\nhere'.slice(anchor.selectionStart, anchor.selectionEnd)).toContain('world');
  });

  it('resolveReadableQuoteAnchor rejects ambiguous or missing quotes', () => {
    expect(resolveReadableQuoteAnchor({ text: 'dup' } as never, 'dup and dup')).toBe('ambiguous_quote');
    expect(resolveReadableQuoteAnchor({ text: 'absent' } as never, 'nothing here')).toBe('quote_mismatch');
  });

  it('resolveExactQuoteAnchor verifies given coordinates first', () => {
    const result = resolveExactQuoteAnchor({ text: 'ell', selectionStart: 1, selectionEnd: 4 }, 'hello');
    expect(result).toEqual({ selectionStart: 1, selectionEnd: 4 });
  });
});

describe('source projection aggregation & dedup', () => {
  it('aggregates a canonical group in timeline order and filters empty parts', () => {
    const m1 = message('m1', { content: 'first' }, 100);
    const m2 = message('m2', { content: 'second' }, 200);
    const mEmpty = message('m3', { content: '   ' }, 150);
    const projected = projectMessageBundleGroupReadableContent([m1, m2, mEmpty]);
    expect(projected).toBe('first\n\nsecond');
    expect(projected.includes('first')).toBe(true);
    expect(projected.indexOf('first')).toBeLessThan(projected.indexOf('second'));
  });

  it('v3 quote plane is the readable projection of the group content', () => {
    const m = message('m1', { content: '## Heading\n\nSome *bold* text' }, 100);
    const v3 = projectMessageBundleGroupQuoteSourceV3([m]);
    expect(v3).toContain('bold');
    expect(v3).not.toContain('##');
  });
});

describe('MessageSelectionResolver — admission', () => {
  it('admission for a reply/message item resolves the canonical bubble', async () => {
    const resolver = makeResolver([message('m1', { content: 'hello world' }, 100)]);
    const result = await resolver.resolveForAdmission(
      { sourceThreadId: THREAD, items: [{ kind: 'message', messageId: 'm1' }] },
      { userId: USER },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.carrier.items).toHaveLength(1);
    expect(result.items[0]?.readableContent).toContain('hello world');
  });

  it('sorts admitted items by timeline order regardless of input order', async () => {
    const resolver = makeResolver([
      message('b', { content: 'later' }, 200),
      message('a', { content: 'earlier' }, 100),
    ]);
    const result = await resolver.resolveForAdmission(
      { sourceThreadId: THREAD, items: [{ kind: 'message', messageId: 'b' }, { kind: 'message', messageId: 'a' }] },
      { userId: USER },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.carrier.items.map((i) => i.messageId)).toEqual(['a', 'b']);
  });

  it('rejects quote with renderedOccurrences !== 1 as ambiguous', async () => {
    const resolver = makeResolver([message('m1', { content: 'unique phrase here' }, 100)]);
    const result = await resolver.resolveForAdmission(
      {
        sourceThreadId: THREAD,
        items: [{ kind: 'quote', messageId: 'm1', text: 'unique phrase', renderedOccurrences: 2 }],
      },
      { userId: USER },
    );
    expect(result).toEqual({ status: 'invalid', reason: 'ambiguous_quote', messageId: 'm1' });
  });

  it('admits a unique quote and builds a v3 carrier item', async () => {
    const resolver = makeResolver([message('m1', { content: 'alpha beta gamma' }, 100)]);
    const result = await resolver.resolveForAdmission(
      {
        sourceThreadId: THREAD,
        items: [{ kind: 'quote', messageId: 'm1', text: 'beta', renderedOccurrences: 1 }],
      },
      { userId: USER },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    const item = result.carrier.items[0];
    expect(item?.kind).toBe('quote');
    if (item?.kind !== 'quote') return;
    expect(item.sourceProjectionVersion).toBe(3);
    expect(item.sourceProjectionSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('admits a cli_quote against a tool-use segment', async () => {
    const resolver = makeResolver([
      message('m1', {
        content: 'ran tool',
        toolEvents: [{ id: 'evt1', type: 'tool_use', label: 'read-file', detail: '{"file_path":"a.ts"}', timestamp: 100 }],
      }, 100),
    ]);
    const result = await resolver.resolveForAdmission(
      {
        sourceThreadId: THREAD,
        items: [{ kind: 'cli_quote', messageId: 'm1', sourceMessageIds: ['m1'], segmentId: 'tool-label:evt1', text: 'read-file', selectionStart: 0, selectionEnd: 9 }],
      },
      { userId: USER },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.carrier.items[0]?.kind).toBe('cli_quote');
  });

  it('admits a rich_block against stored rich blocks', async () => {
    const block: RichBlock = { id: 'b1', kind: 'card', v: 1, title: 'Card', bodyMarkdown: 'body text' };
    const resolver = makeResolver([
      message('m1', { content: '', extra: { rich: { blocks: [block] } } }, 100),
    ]);
    const result = await resolver.resolveForAdmission(
      {
        sourceThreadId: THREAD,
        items: [{ kind: 'rich_block', messageId: 'm1', sourceMessageIds: ['m1'], blockId: 'b1' }],
      },
      { userId: USER },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.carrier.items[0]?.kind).toBe('rich_block');
    expect(result.items[0]?.readableContent).toContain('body text');
  });

  it('rejects admission on a thread the user cannot access', async () => {
    const resolver = makeResolver([message('m1', { content: 'x' }, 100)], {
      threadOverrides: { createdBy: 'someone-else' },
    });
    const result = await resolver.resolveForAdmission(
      { sourceThreadId: THREAD, items: [{ kind: 'message', messageId: 'm1' }] },
      { userId: USER },
    );
    expect(result).toEqual({ status: 'invalid', reason: 'not_authorized' });
  });
});

describe('carrier read-back — tombstones', () => {
  it('production — reads back an admitted carrier to a resolved bundle', async () => {
    const resolver = makeResolver([message('m1', { content: 'hello world' }, 100)]);
    const admitted = await resolver.resolveForAdmission(
      { sourceThreadId: THREAD, items: [{ kind: 'message', messageId: 'm1' }] },
      { userId: USER },
    );
    expect(admitted.status).toBe('resolved');
    if (admitted.status !== 'resolved') return;
    const read = await resolver.resolveCarrier(admitted.carrier, { userId: USER });
    expect(read.status).toBe('resolved');
    if (read.status !== 'resolved') return;
    expect(read.items[0]?.status).toBe('available');
    expect(read.items[0]?.readableContent).toContain('hello world');
  });

  it('production — read-back tombstones an item whose source vanished', async () => {
    const resolver = makeResolver([message('m1', { content: 'hello' }, 100)]);
    const admitted = await resolver.resolveForAdmission(
      { sourceThreadId: THREAD, items: [{ kind: 'message', messageId: 'm1' }] },
      { userId: USER },
    );
    expect(admitted.status).toBe('resolved');
    if (admitted.status !== 'resolved') return;
    // Drop provenance: switch to an empty store reading the same carrier.
    const emptyResolver = makeResolver([]);
    const read = await emptyResolver.resolveCarrier(admitted.carrier, { userId: USER });
    expect(read.status).toBe('resolved');
    if (read.status !== 'resolved') return;
    expect(read.items[0]?.status).toBe('tombstone');
  });
});