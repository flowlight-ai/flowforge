/**
 * C25 ConciergeReplyValidator 测试（F229 KD-17 → KD-27，clowder 直译）。
 *
 * 覆盖：
 *  - [跳过去 R1｜title｜digest] 完整绑定 marker → teleport action（KD-23 per-invocation table）
 *  - BUG-UX-12：thread anchor 一律 teleport（原地看 也纠正为跳过去）
 *  - Fail-closed：未知 handle / title 不匹配 / digest 错误 / 非 thread anchor → 整组拒绝
 *  - 混合合法+非法 marker → 整组无效（integrity unit）
 *  - 同 action+handle 去重（BUG-UX-9：resolution 后去重）
 *  - KD-27：marker-free 回复 + verifiedToolAnchor → 单 teleport
 *  - Phase B：<!-- triage-plan --> 块提取（INV T1：proposed 先落）+ stripTriagePlanMarkers
 */

import { describe, expect, it } from 'vitest';
import type { HandleAnchor, HandleEntry } from '../src/models.js';
import { formatConciergeHandleBinding } from '../src/concierge/search-context.js';
import {
  buildConciergeActions,
  extractConciergeActions,
  extractTriagePlanIdsFromActions,
  extractTriagePlanActions,
  stripTriagePlanMarkers,
} from '../src/concierge/reply-validator.js';
import { MemoryConciergeTriagePlanStore } from '../src/concierge/triage-plan-store.js';

/** thread anchor（可导航）。 */
function threadAnchor(overrides: Partial<HandleAnchor> = {}): HandleAnchor {
  return { threadId: 'thread_xyz', title: 'RAG 性能问题排查', type: 'thread', ...overrides };
}

/** 生成 handle 表（label + anchor）。 */
function handlesFor(...anchors: HandleAnchor[]): HandleEntry[] {
  return anchors.map((anchor, i) => ({ label: `R${i + 1}`, anchor }));
}

/** 生成 duty cat 可复制的完整绑定 marker。 */
function marker(verb: '跳过去' | '原地看', handle: string, anchor: HandleAnchor): string {
  return `[${verb} ${formatConciergeHandleBinding(handle, anchor)}]`;
}

// ─── 完整绑定 marker → action ──────────────────────────────────────────────

describe('C25 extractConciergeActions：完整绑定 marker', () => {
  it('跳过去 thread anchor → concierge_teleport（带 label/handle/verb/payload）', () => {
    const anchor = threadAnchor();
    const actions = extractConciergeActions(marker('跳过去', 'R1', anchor), handlesFor(anchor));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('concierge_teleport');
    expect(actions[0]!.handle).toBe('R1');
    expect(actions[0]!.verb).toBe('跳过去');
    expect(actions[0]!.payload).toMatchObject({ threadId: 'thread_xyz' });
  });

  it('BUG-UX-12：原地看 thread anchor → action 纠正为 teleport（label 显示跳过去，verb 保留原始 marker）', () => {
    const anchor = threadAnchor();
    const actions = extractConciergeActions(marker('原地看', 'R1', anchor), handlesFor(anchor));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('concierge_teleport');
    expect(actions[0]!.label).toBe('跳过去：RAG 性能问题排查'); // displayVerb 纠正
    expect(actions[0]!.verb).toBe('原地看'); // 原始 marker verb 保留（对齐 clowder）
  });

  it('带 messageId 的 anchor 保留 messageId；无则省略', () => {
    const withMsg = threadAnchor({ messageId: 'm-9' });
    const [a1] = extractConciergeActions(marker('跳过去', 'R1', withMsg), handlesFor(withMsg));
    expect(a1!.payload.messageId).toBe('m-9');
    const [a2] = extractConciergeActions(marker('跳过去', 'R1', threadAnchor()), handlesFor(threadAnchor()));
    expect(a2!.payload.messageId).toBeUndefined();
  });

  it('BUG-UX-9：同 resolution（teleport）× 同 handle 去重（跳过去+原地看 只留 1 个）', () => {
    const anchor = threadAnchor();
    const text = `${marker('跳过去', 'R1', anchor)}\n${marker('原地看', 'R1', anchor)}`;
    const actions = extractConciergeActions(text, handlesFor(anchor));
    expect(actions).toHaveLength(1);
  });

  it('多个不同 handle → 多个 action（顺序保持）', () => {
    const a1 = threadAnchor({ threadId: 't-1', title: 'A' });
    const a2 = threadAnchor({ threadId: 't-2', title: 'B' });
    const text = `${marker('跳过去', 'R1', a1)}\n${marker('跳过去', 'R2', a2)}`;
    const actions = extractConciergeActions(text, handlesFor(a1, a2));
    expect(actions.map((a) => a.payload.threadId)).toEqual(['t-1', 't-2']);
  });
});

// ─── Fail-closed：integrity unit ───────────────────────────────────────────

describe('C25 Fail-closed：任何不完整/不匹配 → 整组拒绝', () => {
  it('未知 handle（跨轮 stale table）→ []', () => {
    const actions = extractConciergeActions(marker('跳过去', 'R9', threadAnchor()), handlesFor(threadAnchor()));
    expect(actions).toEqual([]);
  });

  it('title 不匹配 → []', () => {
    const anchor = threadAnchor();
    const tampered = marker('跳过去', 'R1', anchor).replace('RAG 性能问题排查', '别的标题');
    expect(extractConciergeActions(tampered, handlesFor(anchor))).toEqual([]);
  });

  it('digest 被篡改 → []', () => {
    const anchor = threadAnchor();
    const tampered = marker('跳过去', 'R1', anchor).replace(/[a-f0-9]{12}/, 'deadbeefdead');
    expect(extractConciergeActions(tampered, handlesFor(anchor))).toEqual([]);
  });

  it('混合：1 个完整 + 1 个裸 marker → 整组 invalid（[]）', () => {
    const anchor = threadAnchor();
    const text = `${marker('跳过去', 'R1', anchor)}\n[跳过去 R2]`;
    expect(extractConciergeActions(text, handlesFor(anchor))).toEqual([]);
  });

  it('非 thread anchor（feature/doc）→ 不可导航 → 整组 []', () => {
    const anchor: HandleAnchor = { threadId: 'feature:F229', title: 'F229', type: 'feature' };
    expect(extractConciergeActions(marker('跳过去', 'R1', anchor), handlesFor(anchor))).toEqual([]);
  });

  it('marker-free 回复 → []（KD-26：prefetch 结果不冒充导航意图）', () => {
    const anchor = threadAnchor();
    expect(extractConciergeActions('纯文本回复，无 marker', handlesFor(anchor))).toEqual([]);
  });
});

// ─── buildConciergeActions（KD-27 verified anchor fallback）────────────────

describe('C25 buildConciergeActions：triage 优先 + verified tool anchor fallback', () => {
  it('KD-27：marker-free + verifiedToolAnchor → 单 teleport（get_thread_context 同 invocation 结果）', async () => {
    const verified = threadAnchor({ threadId: 'thread_verified', title: '验证过的线程' });
    const actions = await buildConciergeActions('我找到了一个线程', [], undefined, verified);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('concierge_teleport');
    expect(actions[0]!.payload.threadId).toBe('thread_verified');
  });

  it('marker-free + 无 verified anchor → []', async () => {
    expect(await buildConciergeActions('没有动作', [])).toEqual([]);
  });

  it('triage-plan 块存在 → triage action 优先（handle actions 合并其后）', async () => {
    const store = new MemoryConciergeTriagePlanStore();
    const anchor = threadAnchor();
    const triageText = [
      '<!-- triage-plan -->',
      '**意图**: go',
      `**目标**: ${formatConciergeHandleBinding('R1', anchor)}`,
      '**操作**: 去这个线程看看',
      '<!-- /triage-plan -->',
    ].join('\n');
    const actions = await buildConciergeActions(triageText, handlesFor(anchor), {
      triagePlanStore: store,
      userId: 'user-1',
      sourceMessageId: 'msg-1',
    });
    expect(actions[0]!.action).toBe('concierge_triage_confirm');
    expect(actions[0]!.payload.intent).toBe('go');
    // INV T1：plan 已落库（proposed）
    const planIds = extractTriagePlanIdsFromActions(actions);
    expect(planIds).toHaveLength(1);
    const saved = await store.get(planIds[0]!);
    expect(saved?.status).toBe('proposed');
    expect(saved?.target.threadId).toBe('thread_xyz');
    expect(actions.at(-1)!.action).toBe('concierge_triage_cancel');
  });
});

// ─── Phase B：triage-plan 块 ───────────────────────────────────────────────

describe('C25 extractTriagePlanActions：块解析 + INV T1', () => {
  function triageBlock(fields: Record<string, string>): string {
    const lines = Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`);
    return ['<!-- triage-plan -->', ...lines, '<!-- /triage-plan -->'].join('\n');
  }

  it('relay intent + 显式目标猫 → confirm action（payload 带 targetCats）', async () => {
    const store = new MemoryConciergeTriagePlanStore();
    const anchor = threadAnchor();
    const block = triageBlock({
      意图: 'relay',
      目标: formatConciergeHandleBinding('R1', anchor),
      目标猫: '@cat-a @cat-b',
      原文: '帮我问问他们',
      操作: '传话给两位',
    });
    const actions = await extractTriagePlanActions(block, handlesFor(anchor), {
      triagePlanStore: store,
      userId: 'user-1',
      sourceMessageId: 'msg-1',
    });
    expect(actions).toHaveLength(2);
    const [confirm, cancel] = actions;
    expect(confirm!.action).toBe('concierge_triage_confirm');
    // INV C2：确认卡 payload 自包含 planId/intent；完整 targetCats 以 plan 为权威
    expect(confirm!.payload.targetCats).toBeUndefined();
    expect(cancel!.action).toBe('concierge_triage_cancel');
    const saved = await store.get(confirm!.payload.planId!);
    expect(saved?.intent).toBe('relay');
    expect(saved?.originalText).toBe('帮我问问他们');
    expect(saved?.target.targetCats).toEqual(['cat-a', 'cat-b']);
  });

  it('非法 intent → fail-closed 无 action 且不落库', async () => {
    const store = new MemoryConciergeTriagePlanStore();
    const actions = await extractTriagePlanActions(
      triageBlock({ 意图: 'fly_to_moon', 目标: 'x', 操作: 'y' }),
      [],
      { triagePlanStore: store, userId: 'u', sourceMessageId: 'm' },
    );
    expect(actions).toEqual([]);
    expect((await store.listByUser('u')).length).toBe(0);
  });

  it('go intent 目标 handle 不存在 → 无 action（不落库）', async () => {
    const store = new MemoryConciergeTriagePlanStore();
    const actions = await extractTriagePlanActions(
      triageBlock({ 意图: 'go', 目标: 'R9｜不存在｜aaaaaaaaaaaa', 操作: '去' }),
      handlesFor(threadAnchor()),
      { triagePlanStore: store, userId: 'u', sourceMessageId: 'm' },
    );
    expect(actions).toEqual([]);
  });

  it('investigate intent → query 目标（无 threadId）', async () => {
    const store = new MemoryConciergeTriagePlanStore();
    const actions = await extractTriagePlanActions(
      triageBlock({ 意图: 'investigate', 目标: 'RAG 检索为何慢', 操作: '调查' }),
      [],
      { triagePlanStore: store, userId: 'u', sourceMessageId: 'm' },
    );
    expect(actions).toHaveLength(2);
    const planId = extractTriagePlanIdsFromActions(actions)[0]!;
    const saved = await store.get(planId);
    expect(saved?.intent).toBe('investigate');
    expect(saved?.target.query).toBe('RAG 检索为何慢');
    expect(saved?.target.threadId).toBeUndefined();
  });
});

// ─── stripTriagePlanMarkers ────────────────────────────────────────────────

describe('C25 stripTriagePlanMarkers：控制块剥离', () => {
  it('完整块移除 + 空白折叠', () => {
    const text = ['开头', '<!-- triage-plan -->', '**意图**: go', '<!-- /triage-plan -->', '', '', '', '结尾'].join('\n');
    const stripped = stripTriagePlanMarkers(text);
    expect(stripped).not.toContain('triage-plan');
    expect(stripped).toBe('开头\n\n结尾');
  });

  it('dangling 块（未闭合）整体移除', () => {
    const text = ['<!-- triage-plan -->', '**意图**: go', '残留在外'].join('\n');
    expect(stripTriagePlanMarkers(text)).toBe('');
  });

  it('无块文本原样（仅 trim）', () => {
    expect(stripTriagePlanMarkers('  普通文本  ')).toBe('普通文本');
  });
});
