/**
 * C25 ConciergeSearchContext 测试（F229 KD-17 → KD-23）。
 *
 * 覆盖：
 *  - normalizeConciergeHandleTitle：NFKC 折叠 + 保留分隔符清理 + 空标题回退
 *  - formatConciergeHandleBindingTitle：markdown 安全字符全角替换（含 P2 R3 尖括号中和）
 *  - computeConciergeHandleDigest：确定性、label 参与（R2 ≠ R1）、messageId 参与
 *  - formatConciergeHandleBinding：R{n}｜title｜digest 三字段格式
 *  - buildConciergeSearchContext：fail-open（无 store / search 抛错）+ drillDown 优先解析
 *    + maxResults cap + KD-23 per-invocation handle 表
 */

import { describe, expect, it } from 'vitest';
import type { ConciergeEvidenceItem, ConciergeEvidenceStore } from '../src/models.js';
import {
  buildConciergeSearchContext,
  computeConciergeHandleDigest,
  formatConciergeHandleBinding,
  formatConciergeHandleBindingTitle,
  normalizeConciergeHandleTitle,
} from '../src/concierge/search-context.js';
import { extractConciergeActions } from '../src/concierge/reply-validator.js';

// ─── Title 规范化 ──────────────────────────────────────────────────────────

describe('C25 normalizeConciergeHandleTitle：canonical 形式', () => {
  it('NFKC 折叠（全角→半角）+ 保留分隔符清理', () => {
    expect(normalizeConciergeHandleTitle('ＲＡＧ 性能')).toBe('RAG 性能');
    expect(normalizeConciergeHandleTitle('A|B｜C')).toBe('A B C'); // | 和 ｜ 都清理
    expect(normalizeConciergeHandleTitle('带\n换行\t标题')).toBe('带 换行 标题');
    expect(normalizeConciergeHandleTitle('标题[带]括号')).toBe('标题 带 括号');
  });

  it('空白标题回退为未命名记录', () => {
    expect(normalizeConciergeHandleTitle('')).toBe('未命名记录');
    expect(normalizeConciergeHandleTitle('   ')).toBe('未命名记录');
    expect(normalizeConciergeHandleTitle('||||')).toBe('未命名记录');
  });

  it('markdown 特殊字符全角替换（防 ReactMarkdown 拆 marker，P2 R3）', () => {
    expect(formatConciergeHandleBindingTitle('a*b_c(d)e~f`g\\h')).toBe('a＊b＿c（d）e～f｀g＼h');
    // 尖括号中和：<https://url> 不被 remarkGfm 展开为 autolink
    expect(formatConciergeHandleBindingTitle('see <https://x.dev/a>')).toBe('see ＜https://x.dev/a＞');
  });
});

// ─── Digest 确定性 ─────────────────────────────────────────────────────────

describe('C25 computeConciergeHandleDigest：身份证明', () => {
  const anchor = { threadId: 't-1', title: '标题', type: 'thread' };

  it('同 (handle, anchor) 确定性强一致', () => {
    expect(computeConciergeHandleDigest('R1', anchor)).toBe(computeConciergeHandleDigest('R1', anchor));
    expect(computeConciergeHandleDigest('R1', anchor)).toMatch(/^[a-f0-9]{12}$/);
  });

  it('label 参与身份（R2 不能借用 R1 的 digest）', () => {
    expect(computeConciergeHandleDigest('R1', anchor)).not.toBe(computeConciergeHandleDigest('R2', anchor));
  });

  it('messageId 参与身份（有/无 messageId digest 不同）', () => {
    expect(computeConciergeHandleDigest('R1', anchor)).not.toBe(
      computeConciergeHandleDigest('R1', { ...anchor, messageId: 'm-1' }),
    );
  });
});

// ─── Binding 格式 ──────────────────────────────────────────────────────────

describe('C25 formatConciergeHandleBinding：R{n}｜title｜digest', () => {
  it('三字段完整格式且可被 validator 消费（闭环）', () => {
    const anchor = { threadId: 't-1', title: '性能问题排查', type: 'thread' };
    const binding = formatConciergeHandleBinding('R1', anchor);
    expect(binding).toBe(`R1｜性能问题排查｜${computeConciergeHandleDigest('R1', anchor)}`);
    // 闭环：marker 引用 binding → 生成 teleport action
    const actions = extractConciergeActions(`[跳过去 ${binding}]`, [
      { label: 'R1', anchor },
    ]);
    expect(actions[0]?.payload.threadId).toBe('t-1');
  });
});

// ─── buildConciergeSearchContext ───────────────────────────────────────────

describe('C25 buildConciergeSearchContext：prefetch + fail-open', () => {
  const items: ConciergeEvidenceItem[] = [
    {
      anchor: 'thread-thread_xyz',
      title: 'RAG 性能问题排查',
      kind: 'thread',
      summary: '讨论了索引慢的问题',
    },
    {
      anchor: 'doc',
      title: '指南文档',
      kind: 'doc',
      drillDown: { tool: 'x', params: { threadId: 'thread_from_drill', messageId: 'm-9' }, hint: '' },
    },
  ];
  const store: ConciergeEvidenceStore = { search: async () => items };

  it('fail-open：无 evidenceStore → 空上下文', async () => {
    const result = await buildConciergeSearchContext({ userMessage: 'q', threadId: 't' });
    expect(result.contextString).toBe('');
    expect(result.handleCount).toBe(0);
    expect(result.handles).toEqual([]);
  });

  it('fail-open：search 抛错 → 空上下文不崩溃', async () => {
    const bad: ConciergeEvidenceStore = {
      search: async () => {
        throw new Error('store down');
      },
    };
    const result = await buildConciergeSearchContext({ userMessage: 'q', threadId: 't', evidenceStore: bad });
    expect(result.handleCount).toBe(0);
  });

  it('drillDown.params.threadId 优先（SqliteEvidenceStore 归一化 ID）', async () => {
    const result = await buildConciergeSearchContext({ userMessage: 'q', threadId: 't', evidenceStore: store });
    expect(result.handleCount).toBe(2);
    expect(result.handles[0]!.label).toBe('R1');
    expect(result.handles[0]!.anchor.threadId).toBe('thread_xyz'); // thread- 前缀解析
    expect(result.handles[1]!.anchor.threadId).toBe('thread_from_drill'); // drillDown 优先
    expect(result.handles[1]!.anchor.messageId).toBe('m-9');
    expect(result.handles[1]!.anchor.type).toBe('thread');
    expect(result.contextString).toContain('[跳过去 R1｜');
    expect(result.contextString).toContain('RAG 性能问题排查');
  });

  it('maxResults cap（超出截断）', async () => {
    const many: ConciergeEvidenceItem[] = Array.from({ length: 25 }, (_, i) => ({
      anchor: `thread-t${i}`,
      title: `结果 ${i}`,
      kind: 'thread',
    }));
    const bigStore: ConciergeEvidenceStore = { search: async () => many };
    const result = await buildConciergeSearchContext({
      userMessage: 'q', threadId: 't', evidenceStore: bigStore, maxResults: 5,
    });
    expect(result.handleCount).toBe(5);
    expect(result.handles.at(-1)!.label).toBe('R5');
  });

  it('搜索参数透传：scope=threads / mode=hybrid / depth=raw（AC-A3 recall）', async () => {
    let captured: Record<string, unknown> | undefined;
    const spy: ConciergeEvidenceStore = {
      search: async (_q, options) => {
        captured = options;
        return [];
      },
    };
    await buildConciergeSearchContext({ userMessage: 'q', threadId: 't', evidenceStore: spy });
    expect(captured).toMatchObject({ limit: 10, scope: 'threads', mode: 'hybrid', depth: 'raw' });
  });
});
