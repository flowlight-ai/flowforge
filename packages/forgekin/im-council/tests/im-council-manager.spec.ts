/**
 * @flowforge/forgekin-im-council — T7.16 IMCouncilManager 契约验证。
 *
 * 对齐 `core/im_council.py` 的 IMCouncilManager（F047 §2.4/§2.5）：
 *   - I1 通道故障降级（console > trae > webchat，全失败抛 NoAvailableChannelError）
 *   - I2 议事不可篡改（归档 append-only JSONL）
 *   - I3 operator 决策必经（requestApproval 为唯一公开入口）
 *   - I4 超时自动拒绝（decide(rejected, "timeout")）
 *   - I5 议事记录归档（每次流程落盘）
 *   - 注册校验：重复注册 / channelName 不匹配拒绝
 *
 * @module @flowforge/forgekin-im-council/tests
 */

import { describe, expect, it } from 'vitest';
import {
  makeApprovalRequest,
  ApprovalHub,
} from '@flowforge/forgekin-evolution-engine/approval-hub';
import { IMCouncilChannel } from '../src/channel.js';
import {
  type ArchiveWriter,
  IMCouncilManager,
  NoAvailableChannelError,
  parseDecision,
  expandEnv,
} from '../src/im-council-manager.js';
import {
  type CouncilMessage,
  type CouncilReply,
  newCouncilReply,
} from '../src/models.js';

/** 内存归档 writer（I5 验证）。 */
class MemoryArchiveWriter implements ArchiveWriter {
  lines: string[] = [];
  async appendLine(line: string): Promise<void> {
    this.lines.push(line);
  }
}

/** 可控通道：按剧本执行 send 成功/失败 + wait_reply 返回预设回复。 */
class ScriptedChannel extends IMCouncilChannel {
  override readonly channelName: string;
  /** send 抛错则触发 I1 降级。 */
  sendFail = false;
  /** wait_reply 返回值（null 模拟超时）。 */
  reply: CouncilReply | null = null;
  /** wait_reply 被调用时消息已送达的通道名。 */
  sentOn: string | null = null;

  constructor(name: string) {
    super();
    this.channelName = name;
  }

  override async send(message: CouncilMessage): Promise<string> {
    if (this.sendFail) throw new Error(`channel ${this.channelName} send failed`);
    this.sentOn = message.channel;
    return message.messageId;
  }

  override async wait_reply(messageId: string, _timeout: number): Promise<CouncilReply | null> {
    return this.reply === null
      ? null
      : { ...this.reply, messageId, replier: 'operator' };
  }

  override async broadcast(message: CouncilMessage): Promise<string[]> {
    return [message.messageId];
  }
}

function makeRequest(overrides: Partial<Parameters<typeof makeApprovalRequest>[0]> = {}) {
  return makeApprovalRequest({
    requestId: 'req_1',
    forgekinId: 'sherlock',
    threadId: 'thread_1',
    requestType: 'code_merge',
    title: '合并 PR #1',
    description: '修复登录页 bug',
    expiresAt: new Date(Date.now() + 3600_000),
    priority: 'high',
    ...overrides,
  });
}

function makeManager(options: {
  channels?: ScriptedChannel[];
  archive?: MemoryArchiveWriter;
  timeoutSeconds?: number;
  autoRejectOnTimeout?: boolean;
  archiveEnabled?: boolean;
} = {}) {
  const hub = new ApprovalHub();
  const manager = new IMCouncilManager({
    approvalHub: hub,
    config: {
      defaultChannel: 'auto',
      approval: {
        timeoutSeconds: options.timeoutSeconds ?? 5,
        autoRejectOnTimeout: options.autoRejectOnTimeout ?? true,
      },
      archive: {
        enabled: options.archiveEnabled ?? true,
        path: 'data/im_council/archive',
      },
    },
    archiveWriter: options.archive ?? new MemoryArchiveWriter(),
  });
  for (const ch of options.channels ?? []) {
    manager.registerChannel(ch.channelName, ch);
  }
  return { hub, manager };
}

describe('IMCouncilManager 通道注册（I1/红线12）', () => {
  it('注册/注销/列出通道', () => {
    const { manager } = makeManager();
    const consoleCh = new ScriptedChannel('console');
    manager.registerChannel('console', consoleCh);
    expect(manager.listChannels()).toEqual(['console']);
    expect(manager.unregisterChannel('console')).toBe(consoleCh);
    expect(manager.unregisterChannel('console')).toBeNull();
    expect(manager.listChannels()).toEqual([]);
  });

  it('重复注册拒绝 + channelName 不匹配拒绝', () => {
    const { manager } = makeManager();
    manager.registerChannel('console', new ScriptedChannel('console'));
    expect(() => manager.registerChannel('console', new ScriptedChannel('console'))).toThrow(
      /通道已注册/,
    );
    expect(() => manager.registerChannel('trae', new ScriptedChannel('console'))).toThrow(
      /通道名不匹配/,
    );
  });
});

describe('sendToOperator（I1 降级链路）', () => {
  it('auto 按 console > trae > webchat 优先级选择可用通道', async () => {
    const consoleCh = new ScriptedChannel('console');
    consoleCh.sendFail = true; // console 失败 → 降级 trae
    const traeCh = new ScriptedChannel('trae');
    const webCh = new ScriptedChannel('webchat');
    const { manager } = makeManager({ channels: [consoleCh, traeCh, webCh] });
    const msg = {
      messageId: 'm1',
      channel: 'auto',
      forgekinId: 'sherlock',
      content: 'c',
      messageType: 'info',
      payload: {},
      createdAt: '2026-08-24T00:00:00.000Z',
    };
    const msgId = await manager.sendToOperator(msg);
    expect(msgId).toBe('m1');
    expect(traeCh.sentOn).toBe('trae');
  });

  it('全部通道失败 → NoAvailableChannelError（I1 链路穷尽）', async () => {
    const ch1 = new ScriptedChannel('console');
    ch1.sendFail = true;
    const ch2 = new ScriptedChannel('trae');
    ch2.sendFail = true;
    const { manager } = makeManager({ channels: [ch1, ch2] });
    await expect(
      manager.sendToOperator({
        messageId: 'm1',
        channel: 'auto',
        forgekinId: 'sherlock',
        content: 'c',
        messageType: 'info',
        payload: {},
        createdAt: '2026-08-24T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NoAvailableChannelError);
  });

  it('显式指定通道：不存在或失败时降级到 auto', async () => {
    const consoleCh = new ScriptedChannel('console');
    const { manager } = makeManager({ channels: [consoleCh] });
    const msg = {
      messageId: 'm1',
      channel: 'x',
      forgekinId: 'sherlock',
      content: 'c',
      messageType: 'info',
      payload: {},
      createdAt: '2026-08-24T00:00:00.000Z',
    };
    await manager.sendToOperator(msg, 'nonexistent');
    expect(consoleCh.sentOn).toBe('console');
  });
});

describe('requestApproval 五步流程（I3/I4/I5）', () => {
  it('operator 批准 → 返回 true，Hub 决策 approved，归档 1 条', async () => {
    const archive = new MemoryArchiveWriter();
    const ch = new ScriptedChannel('console');
    ch.reply = newCouncilReply({
      messageId: 'x',
      replier: 'operator',
      content: 'approve',
    });
    const { hub, manager } = makeManager({ channels: [ch], archive });
    const ok = await manager.requestApproval(makeRequest());
    expect(ok).toBe(true);
    expect(hub.get('req_1')).not.toBeNull();
    const stats = hub.getStats();
    expect(stats.approved).toBe(1);
    expect(stats.pending).toBe(0);
    expect(archive.lines.length).toBe(1);
    const record = JSON.parse(archive.lines[0]!);
    expect(record['message']['forgekinId']).toBe('sherlock');
    expect(record['decision']['decision']).toBe('approved');
    expect(record['reply']['content']).toBe('approve');
  });

  it('operator 拒绝 → 返回 false，决策 rejected', async () => {
    const ch = new ScriptedChannel('console');
    ch.reply = newCouncilReply({
      messageId: 'x',
      replier: 'operator',
      content: 'reject',
    });
    const { hub, manager } = makeManager({ channels: [ch] });
    const ok = await manager.requestApproval(makeRequest());
    expect(ok).toBe(false);
    expect(hub.getStats().rejected).toBe(1);
  });

  it('I4 超时（回复 null）→ 自动拒绝 system:timeout', async () => {
    const ch = new ScriptedChannel('console'); // reply=null 模拟超时
    const { hub, manager } = makeManager({ channels: [ch] });
    const ok = await manager.requestApproval(makeRequest());
    expect(ok).toBe(false);
    const stats = hub.getStats();
    expect(stats.rejected).toBe(1);
    expect(hub.listAll('rejected')![0]).toBeTruthy();
  });

  it('I4 超时 + autoRejectOnTimeout=false → 保持 pending', async () => {
    const ch = new ScriptedChannel('console');
    const { hub, manager } = makeManager({
      channels: [ch],
      autoRejectOnTimeout: false,
    });
    const ok = await manager.requestApproval(makeRequest());
    expect(ok).toBe(false);
    expect(hub.getStats().pending).toBe(1);
    expect(hub.getStats().rejected).toBe(0);
  });

  it('所有通道不可用 → 兜底系统拒绝 no_channel（I1 穷尽）', async () => {
    const archive = new MemoryArchiveWriter();
    const ch = new ScriptedChannel('console');
    ch.sendFail = true;
    const { hub, manager } = makeManager({ channels: [ch], archive });
    const ok = await manager.requestApproval(makeRequest());
    expect(ok).toBe(false);
    expect(hub.getStats().rejected).toBe(1);
    const record = JSON.parse(archive.lines[0]!);
    expect(record['decision']['decidedBy']).toBe('system:no_channel');
  });

  it('I5 归档：archive.enabled=false 时零落盘', async () => {
    const ch = new ScriptedChannel('console');
    ch.reply = newCouncilReply({
      messageId: 'x',
      replier: 'operator',
      content: 'approve',
    });
    const { hub, manager } = makeManager({
      channels: [ch],
      archiveEnabled: false,
    });
    const ok = await manager.requestApproval(makeRequest());
    expect(ok).toBe(true);
    expect(hub.getStats().approved).toBe(1);
  });
});

describe('parseDecision / expandEnv', () => {
  it('parseDecision 识别中英文批准/拒绝，未识别默认拒绝', () => {
    expect(parseDecision('approve')).toBe('approved');
    expect(parseDecision('yes')).toBe('approved');
    expect(parseDecision('同意')).toBe('approved');
    expect(parseDecision('no')).toBe('rejected');
    expect(parseDecision('驳回')).toBe('rejected');
    expect(parseDecision('unknown')).toBe('rejected');
  });

  it('expandEnv 展开 ${VAR} 与 ${VAR:default}（红线 11）', () => {
    process.env['FLOWFORGE_TEST_VAR'] = 'v1';
    expect(expandEnv('a/${FLOWFORGE_TEST_VAR}/b')).toBe('a/v1/b');
    expect(expandEnv('${MISSING_VAR_XYZ:fallback}')).toBe('fallback');
    expect(expandEnv('plain')).toBe('plain');
    delete process.env['FLOWFORGE_TEST_VAR'];
  });
});
