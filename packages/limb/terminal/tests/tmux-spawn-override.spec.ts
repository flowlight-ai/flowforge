/**
 * createTmuxSpawnOverride 单元测试 — T6.5 tmux-agent-spawner.ts override 装配
 * 覆盖：__tmuxPaneCreated 拦截 → AgentPaneRegistry.register；无 registry 静默；
 * spawn 抛错 → markCrashed + 异常传播。
 *
 * 注：override 内部直接引用模块绑定 spawnCliInTmux（vi.mock 导出替换无效），
 * 因此按 carrier 测试惯例 mock 底层依赖（child_process / fs / fs/promises），
 * 让真实 spawnCliInTmux 跑通后再验证 override 的拦截与错误传播。
 */

import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPaneRegistry } from '../src/agent-pane-registry.js';
import { createTmuxSpawnOverride } from '../src/tmux-agent-spawner.js';
import type { TerminalGatewayLike } from '../src/types.js';

const h = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  createReadStreamMock: vi.fn(),
  openSyncMock: vi.fn(),
  closeSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: h.execFileMock,
  execFileSync: h.execFileSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: h.mkdtempMock,
  readFile: h.readFileMock,
  rm: h.rmMock,
}));

vi.mock('node:fs', () => ({
  closeSync: h.closeSyncMock,
  constants: { O_WRONLY: 1, O_NONBLOCK: 4 },
  createReadStream: h.createReadStreamMock,
  openSync: h.openSyncMock,
  statSync: h.statSyncMock,
}));

/** Windows 路径分隔符：mock mkdtemp 返回真实 join(tmpdir) 结果，断言同步构造 */
const TMP = join(tmpdir(), 'ff-override-test');

type ExecFileCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

/** execFile 经 promisify 包装后底层总是 callback 风格；mock 必须回调才能 resolve */
function installExecFileMock(impl: (args: string[]) => { stdout?: string } | Error): void {
  h.execFileMock.mockImplementation((_bin: string, args: string[], cb?: ExecFileCb) => {
    const out = impl(args);
    if (cb) {
      if (out instanceof Error) cb(out);
      else cb(null, { stdout: out.stdout ?? '', stderr: '' });
    }
  });
}

function makeGateway(): TerminalGatewayLike {
  return {
    tmuxBin: '/fake/bin/tmux',
    socketName: (id) => `flowforge-${id}`,
    ensureServer: vi.fn(async () => 'flowforge-wt-1'),
    createPane: vi.fn(async () => '%0'),
    createAgentPane: vi.fn(async () => '%0'),
    execInPane: vi.fn(async () => {}),
    setPaneReadOnly: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    capturePane: vi.fn(async () => ''),
    listPanes: vi.fn(async () => []),
    resizePane: vi.fn(async () => {}),
    killPane: vi.fn(async () => {}),
    destroyServer: vi.fn(async () => {}),
  };
}

/** 让真实 spawnCliInTmux 的 NDJSON 路径跑通（FIFO 空流 + EXIT:0 哨兵） */
function installHappyPath(): void {
  installExecFileMock(() => ({}));
  h.mkdtempMock.mockReset().mockResolvedValue(TMP);
  h.rmMock.mockReset().mockResolvedValue(undefined);
  h.readFileMock.mockReset().mockImplementation(async (p: string) =>
    p.endsWith('exit-code') ? 'EXIT:0' : '',
  );
  h.createReadStreamMock.mockReset().mockReturnValue(Readable.from([]));
  h.openSyncMock.mockReset().mockImplementation(() => {
    throw new Error('no fifo');
  });
  h.closeSyncMock.mockReset();
  h.statSyncMock.mockReset().mockImplementation(() => {
    throw new Error('not found');
  });
  h.execFileSyncMock.mockReset();
}

beforeEach(() => {
  installHappyPath();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTmuxSpawnOverride', () => {
  it('拦截 __tmuxPaneCreated 注册 registry，其余事件透传', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from(['{"type":"message","content":"hi"}\n']));
    const gateway = makeGateway();
    const registry = { register: vi.fn(), markCrashed: vi.fn() } as unknown as AgentPaneRegistry;

    const override = createTmuxSpawnOverride('wt-1', 'inv-1', 'u-1', gateway, registry);
    expect(gateway.ensureServer).not.toHaveBeenCalled();

    const events: unknown[] = [];
    for await (const evt of override({ command: 'codex', args: [] })) events.push(evt);

    expect(gateway.ensureServer).toHaveBeenCalledWith('wt-1');
    // 真实 spawner 装配：mkdtemp → mkfifo → createAgentPane → pane 命令
    expect(h.mkdtempMock).toHaveBeenCalledWith(expect.stringContaining('flowforge-agent-inv-1-'));
    expect(h.execFileMock).toHaveBeenCalledWith('mkfifo', [join(TMP, 'output.fifo')], expect.any(Function));
    expect(gateway.createAgentPane).toHaveBeenCalledWith('wt-1', {});
    expect(registry.register).toHaveBeenCalledWith('inv-1', 'wt-1', '%0', 'u-1');
    expect(registry.markCrashed).not.toHaveBeenCalled();
    expect(events).toEqual([
      { __tmuxPaneCreated: true, paneId: '%0', worktreeId: 'wt-1' },
      { type: 'message', content: 'hi' },
    ]);
  });

  it('无 registry 时注册步骤静默跳过', async () => {
    const gateway = makeGateway();

    const override = createTmuxSpawnOverride('wt-1', 'inv-1', 'u-1', gateway);
    const events: unknown[] = [];
    for await (const evt of override({ command: 'codex', args: [] })) events.push(evt);
    expect(events).toHaveLength(1);
    expect((events[0] as { __tmuxPaneCreated?: boolean }).__tmuxPaneCreated).toBe(true);
  });

  it('spawn 抛错 → markCrashed + 异常传播', async () => {
    const gateway = makeGateway();
    (gateway.createAgentPane as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('pane create failed'),
    );
    const registry = { register: vi.fn(), markCrashed: vi.fn() } as unknown as AgentPaneRegistry;

    const override = createTmuxSpawnOverride('wt-1', 'inv-1', 'u-1', gateway, registry);
    await expect(async () => {
      for await (const _evt of override({ command: 'codex', args: [] })) {
        /* no events expected */
      }
    }).rejects.toThrow('pane create failed');
    expect(registry.markCrashed).toHaveBeenCalledWith('inv-1', 'pane create failed');
    // setup 失败时清理 tmpDir
    expect(h.rmMock).toHaveBeenCalledWith(TMP, { recursive: true, force: true });
  });
});
