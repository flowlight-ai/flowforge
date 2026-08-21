/**
 * TmuxAgentCarrierSession 单元测试 — T6.5 tmux-agent-carrier-session.ts
 * 覆盖：buildTmuxAgentCarrierPaneCommand 命令字符串（pipefail + 双 FIFO + 哨兵）、
 * shellEscape 单引号转义、factory 装配（mkfifo ×2 → createAgentPane → env 注入 →
 * execInPane → setPaneReadOnly → registry.register）、read/write/close 生命周期、
 * 非 JSON 输出报错、非法 env key 拒绝。
 */

import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPaneRegistry } from '../src/agent-pane-registry.js';
import {
  buildTmuxAgentCarrierPaneCommand,
  createTmuxAgentCarrierSessionFactory,
} from '../src/tmux-agent-carrier-session.js';
import type { TerminalGatewayLike } from '../src/types.js';

const h = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  createWriteStreamMock: vi.fn(),
  createReadStreamMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: h.execFileMock,
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: h.mkdtempMock,
  readFile: h.readFileMock,
  rm: h.rmMock,
}));

vi.mock('node:fs', () => ({
  createReadStream: h.createReadStreamMock,
  createWriteStream: h.createWriteStreamMock,
}));

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

function makeInputMock() {
  return {
    write: vi.fn((_data: unknown, cb?: (e?: Error | null) => void) => {
      cb?.(undefined);
      return true;
    }),
    end: vi.fn((cb?: () => void) => cb?.()),
    destroy: vi.fn(),
    destroyed: false,
  };
}

type ExecFileCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

/** Windows 路径分隔符：mock mkdtemp 返回真实 join(tmpdir) 结果，断言同步构造 */
const TMP = join(tmpdir(), 'ff-duplex-test');

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

describe('buildTmuxAgentCarrierPaneCommand', () => {
  it('命令字符串：pipefail + stdin FIFO + stderr 文件 + tee + EXIT 哨兵', () => {
    const cmd = buildTmuxAgentCarrierPaneCommand(
      { command: 'codex', args: ['exec', '--', '-'], invocationId: 'inv-1' },
      '/tmp/in.fifo',
      '/tmp/out.fifo',
      '/tmp/err.log',
      '/tmp/exit',
    );
    expect(cmd).toBe(
      "set -o pipefail; 'codex' 'exec' '--' '-' < '/tmp/in.fifo' 2> '/tmp/err.log' " +
        "| tee '/tmp/out.fifo'; echo \"EXIT:$?\" > '/tmp/exit'",
    );
  });

  it('shellEscape：参数中的单引号转义为引号序列', () => {
    const cmd = buildTmuxAgentCarrierPaneCommand(
      { command: 'claude', args: ['-p', "it's a test"], invocationId: 'inv-2' },
      '/tmp/in.fifo',
      '/tmp/out.fifo',
      '/tmp/err.log',
      '/tmp/exit',
    );
    expect(cmd).toContain("'it'\"'\"'s a test'");
  });
});

describe('createTmuxAgentCarrierSessionFactory', () => {
  let gateway: TerminalGatewayLike;
  let registry: { register: ReturnType<typeof vi.fn>; markDone: ReturnType<typeof vi.fn>; markCrashed: ReturnType<typeof vi.fn> };
  let inputMock: ReturnType<typeof makeInputMock>;

  beforeEach(() => {
    gateway = makeGateway();
    registry = { register: vi.fn(), markDone: vi.fn(), markCrashed: vi.fn() };
    inputMock = makeInputMock();
    installExecFileMock(() => ({}));
    h.mkdtempMock.mockReset().mockResolvedValue(TMP);
    h.rmMock.mockReset().mockResolvedValue(undefined);
    h.readFileMock.mockReset().mockResolvedValue('');
    h.createWriteStreamMock.mockReset().mockReturnValue(inputMock);
    h.createReadStreamMock.mockReset().mockReturnValue(Readable.from([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('装配：mkfifo ×2 → ensureServer → createAgentPane → pane 命令 → 只读 → register → start', async () => {
    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
      agentPaneRegistry: registry as unknown as AgentPaneRegistry,
    });

    const session = await factory({ command: 'codex', args: ['exec'], invocationId: 'inv-1', cwd: '/work' });

    expect(h.execFileMock).toHaveBeenCalledWith('mkfifo', [join(TMP, 'input.fifo')], expect.any(Function));
    expect(h.execFileMock).toHaveBeenCalledWith('mkfifo', [join(TMP, 'output.fifo')], expect.any(Function));
    expect(gateway.ensureServer).toHaveBeenCalledWith('wt-1');
    expect(gateway.createAgentPane).toHaveBeenCalledWith('wt-1', { cwd: '/work' });
    const execCalls = (gateway.execInPane as ReturnType<typeof vi.fn>).mock.calls;
    expect(execCalls[0]?.[2]).toContain('set -o pipefail');
    expect(execCalls[0]?.[2]).toContain(join(TMP, 'input.fifo'));
    expect(gateway.setPaneReadOnly).toHaveBeenCalledWith('wt-1', '%0', true);
    expect(registry.register).toHaveBeenCalledWith('inv-1', 'wt-1', '%0', 'u-1');
    expect(h.createWriteStreamMock).toHaveBeenCalledWith(join(TMP, 'input.fifo'), { encoding: 'utf8' });
    expect(h.createReadStreamMock).toHaveBeenCalledWith(join(TMP, 'output.fifo'), { encoding: 'utf8' });
    await session.close();
  });

  it('env 注入：合法 key 转 export；null 值跳过', async () => {
    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
    });
    const session = await factory({
      command: 'codex',
      args: [],
      invocationId: 'inv-1',
      env: { API_KEY: 'secret', NULL_KEY: null },
    });
    const execCalls = (gateway.execInPane as ReturnType<typeof vi.fn>).mock.calls;
    expect(execCalls[0]?.[2]).toBe("export API_KEY='secret'");
    expect(execCalls.some((c) => String(c[2]).includes('NULL_KEY'))).toBe(false);
    await session.close();
  });

  it('非法 env key（含空格）→ 拒绝且清理 tmpDir', async () => {
    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
    });
    await expect(
      factory({ command: 'codex', args: [], invocationId: 'inv-1', env: { 'bad key': 'v' } }),
    ).rejects.toThrow('Invalid tmux carrier environment key');
    expect(h.rmMock).toHaveBeenCalledWith(TMP, { recursive: true, force: true });
  });

  it('read()：NDJSON 事件 yield → EXIT 哨兵 → markDone', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from(['{"type":"ok","n":1}\n', '{"type":"done"}\n']));
    h.readFileMock.mockImplementation(async (p: string) => (p.endsWith('exit-code') ? 'EXIT:0' : ''));

    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
      agentPaneRegistry: registry as unknown as AgentPaneRegistry,
    });
    const session = await factory({ command: 'codex', args: [], invocationId: 'inv-1' });

    const events: unknown[] = [];
    for await (const evt of session.read()) events.push(evt);
    expect(events).toEqual([{ type: 'ok', n: 1 }, { type: 'done' }]);
    expect(registry.markDone).toHaveBeenCalledWith('inv-1', 0);
    expect(registry.markCrashed).not.toHaveBeenCalled();
  });

  it('read()：exit 非 0 → markCrashed + 报错（stderr 尾部入错误信息）', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from([]));
    h.readFileMock.mockImplementation(async (p: string) => {
      if (p.endsWith('exit-code')) return 'EXIT:4';
      if (p.endsWith('stderr.log')) return 'boom detail';
      return '';
    });

    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
      agentPaneRegistry: registry as unknown as AgentPaneRegistry,
    });
    const session = await factory({ command: 'codex', args: [], invocationId: 'inv-1' });

    await expect(async () => {
      for await (const _evt of session.read()) {
        /* no events expected */
      }
    }).rejects.toThrow('exited with code 4');
    expect(registry.markCrashed).toHaveBeenCalledWith('inv-1', expect.stringContaining('exited with code 4'));
  });

  it('read()：非 JSON 行 → 抛错（line 前 240 字符）', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from(['this is not json\n']));

    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
      agentPaneRegistry: registry as unknown as AgentPaneRegistry,
    });
    const session = await factory({ command: 'codex', args: [], invocationId: 'inv-1' });

    await expect(async () => {
      for await (const _evt of session.read()) {
        /* no events expected */
      }
    }).rejects.toThrow('non-JSON stdout');
    expect(registry.markCrashed).toHaveBeenCalledWith('inv-1', expect.stringContaining('this is not json'));
  });

  it('write()：JSON.stringify + 换行写入 input FIFO', async () => {
    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
    });
    const session = await factory({ command: 'codex', args: [], invocationId: 'inv-1' });
    await session.write({ type: 'input', value: 'x' });
    expect(inputMock.write).toHaveBeenCalledWith('{"type":"input","value":"x"}\n', expect.any(Function));
  });

  it('close()：input.end 收尾；read 完成后清理 tmpDir', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from([]));
    h.readFileMock.mockImplementation(async (p: string) => (p.endsWith('exit-code') ? 'EXIT:0' : ''));

    const factory = createTmuxAgentCarrierSessionFactory({
      worktreeId: 'wt-1',
      userId: 'u-1',
      tmuxGateway: gateway,
    });
    const session = await factory({ command: 'codex', args: [], invocationId: 'inv-1' });
    for await (const _evt of session.read()) {
      /* drain */
    }
    await session.close();
    expect(inputMock.end).toHaveBeenCalled();
    expect(h.rmMock).toHaveBeenCalledWith(TMP, { recursive: true, force: true });
  });
});
