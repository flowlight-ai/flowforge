/**
 * TmuxGateway 单元测试 — T6.5 tmux-gateway.ts
 * Windows 环境无 tmux：mock node:child_process + node:fs，纯单元验证
 * 命令序列 / socket 命名 / 自愈 / 解析逻辑（对齐 clowder-ai tmux-gateway.test.js 语义）。
 *
 * 本地化断言：socket 名 `flowforge-{worktreeId}`（原 catcafe- 前缀）、
 * FF_TMUX_PATH 环境变量（原 CAT_CAFE_TMUX_PATH）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  statSyncMock: vi.fn(),
  accessSyncMock: vi.fn(),
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: h.execFileMock,
  execFileSync: h.execFileSyncMock,
}));

vi.mock('node:fs', () => ({
  accessSync: h.accessSyncMock,
  constants: { X_OK: 1 },
  statSync: h.statSyncMock,
}));

import { TmuxGateway } from '../src/tmux-gateway.js';

function noServerError(): Error {
  const err = new Error('no server running on /tmp/tmux-1000/default');
  (err as { stderr?: string }).stderr = 'no server running on /tmp/tmux-1000/default';
  return err;
}

type ExecFileCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

/** execFile 经 promisify 包装后底层总是 callback 风格；且可能带 options 参数（cb 在末位） */
function installExecFileMock(impl: (args: string[]) => { stdout?: string } | Error): void {
  h.execFileMock.mockImplementation(
    (_bin: string, args: string[], optOrCb?: unknown, maybeCb?: ExecFileCb) => {
      const cb = (typeof optOrCb === 'function' ? optOrCb : maybeCb) as ExecFileCb | undefined;
      const out = impl(args);
      if (cb) {
        if (out instanceof Error) cb(out);
        else cb(null, { stdout: out.stdout ?? '', stderr: '' });
      }
    },
  );
}

describe('TmuxGateway', () => {
  beforeEach(() => {
    process.env.FF_TMUX_PATH = '/fake/bin/tmux';
    h.statSyncMock.mockReturnValue({ isFile: () => true });
    h.accessSyncMock.mockReturnValue(undefined);
    h.execFileSyncMock.mockReturnValue('');
    h.execFileMock.mockReset();
    installExecFileMock((args) => (args.includes('display-message') ? { stdout: '%0\n' } : {}));
  });

  afterEach(() => {
    delete process.env.FF_TMUX_PATH;
  });

  it('构造时解析 FF_TMUX_PATH 为 tmuxBin', () => {
    const gw = new TmuxGateway();
    expect(gw.tmuxBin).toBe('/fake/bin/tmux');
  });

  it('socketName 使用 flowforge- 前缀（本地化自 catcafe-）', () => {
    const gw = new TmuxGateway();
    expect(gw.socketName('wt-1')).toBe('flowforge-wt-1');
  });

  it('ensureServer：list-sessions 成功 → activeServers 缓存（二次调用不再 exec）', async () => {
    const gw = new TmuxGateway();
    const sock = await gw.ensureServer('wt-1');
    expect(sock).toBe('flowforge-wt-1');
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'list-sessions'], expect.any(Function));

    await gw.ensureServer('wt-1');
    expect(h.execFileMock).toHaveBeenCalledTimes(1);
  });

  it('ensureServer：list-sessions 失败 → 静默返回 sock（server 会在首个 createPane 时创建）', async () => {
    installExecFileMock(() => noServerError());
    const gw = new TmuxGateway();
    await expect(gw.ensureServer('wt-1')).resolves.toBe('flowforge-wt-1');
  });

  it('createPane（新 worktree）：new-session 命令序列 + display-message 取 pane id', async () => {
    const gw = new TmuxGateway();
    const paneId = await gw.createPane('wt-1', { cwd: '/work', cols: 120, rows: 40, shell: '/bin/zsh' });
    expect(paneId).toBe('%0');

    const newSessionCall = h.execFileMock.mock.calls.find(([, args]) => args.includes('new-session'));
    expect(newSessionCall).toBeDefined();
    const [, args] = newSessionCall!;
    expect(args).toEqual([
      '-L', 'flowforge-wt-1',
      'new-session', '-d', '-x', '120', '-y', '40', '-c', '/work',
      '/bin/zsh',
    ]);
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'display-message', '-p', '#{pane_id}'], expect.any(Function));
  });

  it('createPane（已有 active server）：new-window 分支，不重复 new-session', async () => {
    const gw = new TmuxGateway();
    await gw.ensureServer('wt-1');
    await gw.createPane('wt-1');
    const calls = h.execFileMock.mock.calls.map(([, args]) => args.join(' '));
    expect(calls.some((c) => c.includes('new-window'))).toBe(true);
    expect(calls.filter((c) => c.includes('new-session'))).toHaveLength(0);
  });

  it('createPane 自愈：new-window 遇 "no server running" → 重建 detached session', async () => {
    const gw = new TmuxGateway();
    await gw.ensureServer('wt-1');
    installExecFileMock((args) => {
      if (args.includes('new-window')) return noServerError();
      if (args.includes('display-message')) return { stdout: '%0\n' };
      return {};
    });
    const paneId = await gw.createPane('wt-1');
    expect(paneId).toBe('%0');
    const newSessionCalls = h.execFileMock.mock.calls.filter(([, args]) => args.includes('new-session'));
    expect(newSessionCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('listPanes 解析 pane_id pid width height 四字段', async () => {
    installExecFileMock(() => ({ stdout: '%0 100 120 40\n%1 101 80 24\n' }));
    const gw = new TmuxGateway();
    const panes = await gw.listPanes('wt-1');
    expect(panes).toEqual([
      { paneId: '%0', panePid: 100, paneWidth: 120, paneHeight: 40 },
      { paneId: '%1', panePid: 101, paneWidth: 80, paneHeight: 24 },
    ]);
  });

  it('listPanes：server 未运行 → 返回空数组', async () => {
    installExecFileMock(() => noServerError());
    const gw = new TmuxGateway();
    await expect(gw.listPanes('wt-1')).resolves.toEqual([]);
  });

  it('sendKeys / execInPane 命令序列（text + Enter）', async () => {
    const gw = new TmuxGateway();
    await gw.sendKeys('wt-1', '%0', 'ls -la');
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'send-keys', '-t', '%0', 'ls -la', 'Enter'], expect.any(Function));
    await gw.execInPane('wt-1', '%0', 'echo hi');
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'send-keys', '-t', '%0', 'echo hi', 'Enter'], expect.any(Function));
  });

  it('capturePane / resizePane / setPaneReadOnly 命令序列', async () => {
    installExecFileMock(() => ({ stdout: 'pane content\n' }));
    const gw = new TmuxGateway();
    const content = await gw.capturePane('wt-1', '%0');
    expect(content).toBe('pane content\n');
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'capture-pane', '-t', '%0', '-p'], expect.any(Function));

    await gw.resizePane('wt-1', '%0', 100, 30);
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'resize-pane', '-t', '%0', '-x', '100', '-y', '30'], expect.any(Function));

    await gw.setPaneReadOnly('wt-1', '%0', true);
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'select-pane', '-t', '%0', '-d'], expect.any(Function));
    await gw.setPaneReadOnly('wt-1', '%0', false);
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'select-pane', '-t', '%0', '-e'], expect.any(Function));
  });

  it('createAgentPane：createPane + remain-on-exit on（不设只读）', async () => {
    const gw = new TmuxGateway();
    const paneId = await gw.createAgentPane('wt-1');
    expect(paneId).toBe('%0');
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'set-option', '-t', '%0', 'remain-on-exit', 'on'], expect.any(Function));
    const readOnlyCalls = h.execFileMock.mock.calls.filter(([, args]) => args.includes('select-pane'));
    expect(readOnlyCalls).toHaveLength(0);
  });

  it('killPane / destroyServer：错误静默 + activeServers 清理', async () => {
    const gw = new TmuxGateway();
    await gw.ensureServer('wt-1');
    installExecFileMock(() => new Error('pane already dead'));
    await expect(gw.killPane('wt-1', '%0')).resolves.toBeUndefined();
    h.execFileSyncMock.mockImplementation(() => {
      throw new Error('server already dead');
    });
    await expect(gw.destroyServer('wt-1')).resolves.toBeUndefined();
    expect(h.execFileSyncMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'kill-server'], { stdio: 'ignore' });
    // destroyServer 后 ensureServer 需重新探测
    installExecFileMock(() => ({}));
    h.execFileSyncMock.mockReturnValue('');
    await gw.ensureServer('wt-1');
    expect(h.execFileMock).toHaveBeenCalledWith('/fake/bin/tmux', ['-L', 'flowforge-wt-1', 'list-sessions'], expect.any(Function));
  });
});
