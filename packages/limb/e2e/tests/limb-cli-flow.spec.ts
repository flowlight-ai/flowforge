/**
 * limb-cli-flow — T6.7 mock CLI 端到端集成测试
 *
 * 覆盖（对齐 26-stage6 T6.7 验收）：
 * - 配对（createPairingRequest → approvePairing）→ 节点注册 → 具身绑定
 * - 租约：acquireLease 互斥（同猫幂等 / 他猫 null）+ releaseAllLeasesByCat
 * - 执行：registry.invoke Phase B pipeline（policy → lease → action log → execute）
 *   → PluginLimbAdapter handler spawn mock CLI（跨平台 node 进程，Windows pty 路径冒烟）
 *   → limbAdapters 五模式解析（claude stream-json / codex json / gemini stream-json /
 *     opencode ndjson / agy plain text）
 * - 转录：text 事件 → LimbObservationRouter.route（binding 命中 → routed）→
 *   LimbTranscriptCatDelivery → messageStore.append（幂等键 + connector 源标注）
 * - 回传：fake trigger 收到转录文本（绑定猫触发）
 * - 租约冲突拒绝：他猫 invoke 被 pipeline 拒绝（currently leased by another cat）
 */

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Context } from '@flowforge/cordis';
import { LimbService, type LimbInvokeResult } from '@flowforge/limb-core';
import { EmbodimentService, type LimbDeclaration } from '@flowforge/limb-embodiment';
import { LimbNodeService, type InvokeHandler } from '@flowforge/limb-node';
import { ObservationService } from '@flowforge/limb-observation';
import { LimbAdaptersService, type CliEvent, type CliProviderKind } from '@flowforge/limb-adapters';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const MOCK_CLI = join(FIXTURES_DIR, 'mock-cli.mjs');

const NODE_ID = 'mock-cli-1';
const CAT_1 = 'cat-1';
const CAT_2 = 'cat-2';
const USER_1 = 'user-1';
const THREAD_1 = 'thread-1';

/** 五种模式的期望转录文本（与 mock-cli.mjs 固定输出对齐；custom 仅供类型完备） */
const EXPECTED_TEXT: Record<CliProviderKind, string> = {
  claude: 'Hello from mock claude',
  codex: 'Hello from mock codex',
  gemini: 'Hello from mock gemini',
  opencode: 'Hello from mock opencode',
  agy: 'Hello from mock agy',
  custom: '',
};

interface StoredMessage {
  threadId: string;
  userId: string;
  content: string;
  mentions: readonly string[];
  idempotencyKey: string;
  source: { connector: string; label: string; meta?: Record<string, unknown> };
}

interface Harness {
  ctx: Context;
  messages: StoredMessage[];
  triggers: string[];
  dispose(): Promise<void>;
}

/** 组装 limb 六域插件（core/embodiment/node/observation/adapters）+ mock CLI 节点 */
async function makeHarness(): Promise<Harness> {
  const ctx = new Context();
  const fibers: Array<{ dispose(): Promise<void> }> = [];
  fibers.push(await ctx.plugin(LimbService, { leaseTtlMs: 60_000 }));
  fibers.push(await ctx.plugin(EmbodimentService));
  fibers.push(await ctx.plugin(LimbNodeService, { registry: ctx.limb.registry }));
  fibers.push(await ctx.plugin(LimbAdaptersService));

  const messages: StoredMessage[] = [];
  const triggers: string[] = [];
  fibers.push(
    await ctx.plugin(ObservationService, {
      bindingStore: ctx.limbEmbodiment.store,
      transcriptOptions: {
        isKnownCat: (catId) => catId === CAT_1,
        messageStore: {
          append: async (input) => {
            messages.push(input);
            return { id: `msg-${messages.length}` };
          },
        },
        invokeTriggerProvider: {
          get: () => ({
            trigger: async (threadId, catId, userId, message) => {
              triggers.push(`${threadId}|${catId}|${userId}|${message}`);
              return 'dispatched' as const;
            },
          }),
        },
      },
    }),
  );

  const declaration: LimbDeclaration = {
    nodeId: NODE_ID,
    displayName: 'Mock CLI',
    platform: 'cli',
    capabilities: [{ cap: 'exec', commands: ['physical_limb.execute'], authLevel: 'leased' }],
    commands: {
      'physical_limb.execute': {
        type: 'invoke',
        description: 'Execute mock CLI and route transcript to bound cat thread',
        handler: 'e2e:cli_execute',
        params: {
          kind: { type: 'string', required: true },
          prompt: { type: 'string' },
        },
      },
    },
  };
  const node = ctx.limbNodes.createPluginAdapterFromDeclaration(declaration, {}, {
    'e2e:cli_execute': makeCliExecuteHandler(ctx, NODE_ID),
  });
  await ctx.limbNodes.registerNode(node);

  // 具身绑定：四肢 ↔ (user, thread, cat)
  await ctx.limbEmbodiment.putBinding({
    nodeId: NODE_ID,
    userId: USER_1,
    threadId: THREAD_1,
    catId: CAT_1,
    expressionRef: 'default',
    voiceProfileRef: 'default',
    volumePercent: 80,
    updatedAt: Date.now(),
  });

  return {
    ctx,
    messages,
    triggers,
    dispose: async () => {
      for (const fiber of fibers.reverse()) {
        await fiber.dispose();
      }
    },
  };
}

/** spawn mock CLI → limbAdapters 解析 → text 事件路由转录（执行→转录→回传核心） */
function makeCliExecuteHandler(ctx: Context, nodeId: string): InvokeHandler {
  return async (params): Promise<LimbInvokeResult> => {
    const kind = params.kind as CliProviderKind;
    const adapter = ctx.limbAdapters.get(kind);
    if (!adapter) return { success: false, error: `CLI adapter not found: ${kind}` };

    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    // 跨平台 spawn：node mock-cli.mjs（Windows pty 路径冒烟——不依赖 tmux/pty，任何平台可跑）
    const argv = [MOCK_CLI, '--mode', kind, ...adapter.buildSpawnArgs({ prompt })];
    const { stdout } = await execFileAsync(process.execPath, argv, { encoding: 'utf8', timeout: 30_000 });

    const parser = adapter.createParser();
    const events: CliEvent[] = [];
    const transcripts: string[] = [];

    // agy plain text 走 parsePlainText；其余走 NDJSON 流解析
    if (adapter.parsePlainText) {
      const result = adapter.parsePlainText(stdout, '');
      if (result.kind === 'text') {
        transcripts.push(result.content);
        await routeTranscript(ctx, nodeId, kind, {
          type: 'text',
          content: result.content,
          timestamp: Date.now(),
        });
      }
    } else {
      for (const line of stdout.split('\n')) {
        if (line.trim().length === 0) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }
        const out = parser.transform(raw);
        const batch = Array.isArray(out) ? out : out !== null ? [out] : [];
        for (const event of batch) {
          events.push(event);
          if (event.type === 'text') await routeTranscript(ctx, nodeId, kind, event);
        }
      }
    }
    return { success: true, data: { events: events.length, transcripts } };
  };
}

/** 单条 text 事件 → transcript observation → 观察路由（binding → receipt → 投递群聊） */
async function routeTranscript(ctx: Context, nodeId: string, kind: CliProviderKind, event: Extract<CliEvent, { type: 'text' }>): Promise<void> {
  const interactionId = `interaction-${kind}`;
  await ctx.limbObservation.route({
    v: 1,
    observationId: `obs-${kind}`,
    nodeId,
    occurredAt: new Date().toISOString(),
    sessionId: `mock-sess-${kind}`,
    kind: 'transcript',
    payload: { interactionId, text: event.content, captureDurationMs: 0 },
  });
}

describe('T6.7 mock CLI 端到端', () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    while (harnesses.length > 0) {
      const harness = harnesses.pop();
      await harness?.dispose();
    }
  });

  async function setup(): Promise<Harness> {
    const harness = await makeHarness();
    harnesses.push(harness);
    return harness;
  }

  it('配对：创建请求 → pending → 审批 → approved', async () => {
    const { ctx } = await setup();
    const request = ctx.limb.createPairingRequest({
      nodeId: NODE_ID,
      displayName: 'Mock CLI',
      platform: 'cli',
      endpointUrl: 'local://mock-cli',
      capabilities: [{ cap: 'exec', commands: ['physical_limb.execute'], authLevel: 'leased' }],
    });
    expect(request.status).toBe('pending');

    const approved = await ctx.limb.approvePairing(request.requestId, USER_1);
    expect(approved?.status).toBe('approved');
    expect(ctx.limb.listApprovedPairings().some((p) => p.nodeId === NODE_ID)).toBe(true);
  });

  it('租约互斥：同猫幂等 / 他猫 null / 按猫释放', async () => {
    const { ctx } = await setup();
    const lease = ctx.limb.acquireLease(CAT_1, NODE_ID, 'exec');
    expect(lease).not.toBeNull();
    expect(ctx.limb.isLeased(NODE_ID, 'exec')?.catId).toBe(CAT_1);

    // 同猫重复 acquire 幂等（同一租约）
    const again = ctx.limb.acquireLease(CAT_1, NODE_ID, 'exec');
    expect(again?.leaseId).toBe(lease?.leaseId);

    // 他猫 acquire → null（互斥）
    expect(ctx.limb.acquireLease(CAT_2, NODE_ID, 'exec')).toBeNull();

    // 按猫释放
    const released = ctx.limb.releaseAllLeasesByCat(CAT_1);
    expect(released).toContain(lease?.leaseId);
    expect(ctx.limb.isLeased(NODE_ID, 'exec')).toBeNull();
  });

  it('执行+转录+回传：claude 模式完整链路', async () => {
    const { ctx, messages, triggers } = await setup();
    const result = await ctx.limb.invoke(
      NODE_ID,
      'physical_limb.execute',
      { kind: 'claude', prompt: 'hi' },
      { catId: CAT_1, invocationId: 'inv-claude-1', userId: USER_1, threadId: THREAD_1 },
    );
    expect(result.success).toBe(true);

    // 转录 → 群聊落库（connector 源标注 + 幂等键）
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      threadId: THREAD_1,
      userId: USER_1,
      content: EXPECTED_TEXT.claude,
      mentions: [CAT_1],
    });
    expect(messages[0]!.source.connector).toBe('physical-limb.stackchan');
    expect(messages[0]!.source.meta?.nodeId).toBe(NODE_ID);
    expect(messages[0]!.idempotencyKey).toBe(`limb:${NODE_ID}:obs-claude`);

    // 回传：绑定猫触发（threadId|catId|userId|text）
    expect(triggers).toEqual([`${THREAD_1}|${CAT_1}|${USER_1}|${EXPECTED_TEXT.claude}`]);

    // pipeline 审计：action log 记录了本次调用
    const actions = ctx.limb.getActionsByNode(NODE_ID);
    expect(actions.length).toBe(1);
    expect(actions[0]!).toMatchObject({
      catId: CAT_1,
      command: 'physical_limb.execute',
      status: 'completed',
    });
  });

  it('五模式解析：claude/codex/gemini/opencode/agy 各一例转录成功', async () => {
    const { ctx, messages } = await setup();
    for (const kind of ['claude', 'codex', 'gemini', 'opencode', 'agy'] as CliProviderKind[]) {
      const result = await ctx.limb.invoke(
        NODE_ID,
        'physical_limb.execute',
        { kind, prompt: 'hi' },
        { catId: CAT_1, invocationId: `inv-${kind}`, userId: USER_1, threadId: THREAD_1 },
      );
      expect(result.success).toBe(true);
    }
    expect(messages.map((m) => m.content)).toEqual([
      EXPECTED_TEXT.claude,
      EXPECTED_TEXT.codex,
      EXPECTED_TEXT.gemini,
      EXPECTED_TEXT.opencode,
      EXPECTED_TEXT.agy,
    ]);
  });

  it('转录去重：同一 observationId 二次 route → duplicate（不重复落库）', async () => {
    const { ctx, messages } = await setup();
    const observation = {
      v: 1 as const,
      observationId: 'obs-claude',
      nodeId: NODE_ID,
      occurredAt: new Date().toISOString(),
      sessionId: 'mock-sess-claude',
      kind: 'transcript' as const,
      payload: { interactionId: 'interaction-claude', text: 'dup', captureDurationMs: 0 },
    };
    const first = await ctx.limbObservation.route(observation);
    const second = await ctx.limbObservation.route(observation);
    expect(first).toEqual({ status: 'routed', messageId: 'msg-1' });
    expect(second).toEqual({ status: 'duplicate' });
    expect(messages).toHaveLength(1);
  });

  it('租约冲突拒绝：他猫 invoke 被 pipeline 拒绝', async () => {
    const { ctx } = await setup();
    // cat-1 长时持有租约（模拟进行中的执行）
    expect(ctx.limb.acquireLease(CAT_1, NODE_ID, 'exec')).not.toBeNull();

    const result = await ctx.limb.invoke(
      NODE_ID,
      'physical_limb.execute',
      { kind: 'claude', prompt: 'hi' },
      { catId: CAT_2, invocationId: 'inv-conflict', userId: 'user-2', threadId: THREAD_1 },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/currently leased by another cat/);

    // 未授权的 cat 不应产生转录
    const actions = ctx.limb.getActionsByNode(NODE_ID);
    expect(actions).toHaveLength(0);
  });

  it('Windows pty 路径冒烟：mock CLI 跨平台 spawn（node 进程，不依赖 tmux/pty）', async () => {
    const { stdout } = await execFileAsync(process.execPath, [MOCK_CLI, '--mode', 'claude'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    // 首行应为 NDJSON 且可被 claude 适配器解析
    const first = JSON.parse(lines[0] ?? '{}') as { type?: string };
    expect(first.type).toBe('system');
  });
});
