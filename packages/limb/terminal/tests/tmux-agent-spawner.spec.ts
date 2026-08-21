/**
 * TmuxAgentSpawner 单元测试 — T6.5 tmux-agent-spawner.ts
 * Windows 环境无 tmux：mock node:child_process / node:fs / node:fs/promises +
 * mock TerminalGatewayLike，验证：
 * - FIFO NDJSON 事件流透传（__tmuxPaneCreated 先发 + 逐事件 yield）
 * - 异常退出 → __cliError + cliDiagnostics（stderr/非 JSON 噪声分类）
 * - F212 Phase H finalSemanticDone 四格（turn.completed 抑制 / completed→failed 暴露）
 * - plainText 模式 → __cliPlainText 聚合输出
 * - env 注入 export 命令 + stdin 重定向 + 超时路径（fake timers）
 */

import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalGatewayLike } from '../src/types.js';
import { spawnCliInTmux } from '../src/tmux-agent-spawner.js';

const h = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  createReadStreamMock: vi.fn(),
  openSyncMock: vi.fn(),
  closeSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  mkdtempMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: h.execFileMock,
  execFileSync: h.execFileSyncMock,
}));

vi.mock('node:fs', () => ({
  closeSync: h.closeSyncMock,
  constants: { O_WRONLY: 1, O_NONBLOCK: 4 },
  createReadStream: h.createReadStreamMock,
  openSync: h.openSyncMock,
  statSync: h.statSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: h.mkdtempMock,
  readFile: h.readFileMock,
  rm: h.rmMock,
  writeFile: h.writeFileMock,
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

const BASE_OPTS = { command: 'codex', args: [], worktreeId: 'wt-1', invocationId: 'inv-1' };

/** Windows 路径分隔符：mock mkdtemp 返回真实 join(tmpdir) 结果，断言同步构造 */
const TMP = join(tmpdir(), 'ff-agent-test');

function stubFiles(exitCode: string, stderr = ''): void {
  h.readFileMock.mockImplementation(async (p: string) => {
    if (String(p).endsWith('exit-code')) return exitCode;
    if (String(p).endsWith('stderr.log')) return stderr;
    return '';
  });
}

describe('spawnCliInTmux', () => {
  let gateway: TerminalGatewayLike;

  beforeEach(() => {
    gateway = makeGateway();
    installExecFileMock(() => ({}));
    h.execFileSyncMock.mockReset().mockReturnValue('');
    h.openSyncMock.mockReset().mockReturnValue(3);
    h.closeSyncMock.mockReset();
    h.statSyncMock.mockReset().mockReturnValue({ size: 0, mtimeMs: 0 });
    h.mkdtempMock.mockReset().mockResolvedValue(TMP);
    h.rmMock.mockReset().mockResolvedValue(undefined);
    h.writeFileMock.mockReset().mockResolvedValue(undefined);
    h.createReadStreamMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('NDJSON 正常流：__tmuxPaneCreated 先发 → 事件逐条 yield → return paneId', async () => {
    h.createReadStreamMock.mockReturnValue(
      Readable.from(['{"type":"message","content":"hi"}\n', '{"type":"turn.completed"}\n']),
    );
    stubFiles('EXIT:0');

    const gen = spawnCliInTmux(BASE_OPTS, { tmuxGateway: gateway });
    const first = await gen.next();
    expect(first.value).toEqual({ __tmuxPaneCreated: true, paneId: '%0', worktreeId: 'wt-1' });

    const second = await gen.next();
    expect(second.value).toEqual({ type: 'message', content: 'hi' });
    const third = await gen.next();
    expect(third.value).toEqual({ type: 'turn.completed' });

    const done = await gen.next();
    expect(done.done).toBe(true);
    expect(done.value).toEqual({ paneId: '%0' });
    // 正常路径无 __cliError / __cliTimeout
    const values = [first.value, second.value, third.value];
    expect(values.some((v) => (v as { __cliError?: boolean }).__cliError)).toBe(false);
  });

  it('命令序列：mkfifo → createAgentPane → buildPaneCommand（pipefail + tee）→ setPaneReadOnly', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from([]));
    stubFiles('EXIT:0');

    const gen = spawnCliInTmux(BASE_OPTS, { tmuxGateway: gateway });
    await gen.next();
    await gen.next();

    expect(h.execFileMock).toHaveBeenCalledWith('mkfifo', [join(TMP, 'output.fifo')], expect.any(Function));
    expect(gateway.createAgentPane).toHaveBeenCalledWith('wt-1', {});
    const commands = (gateway.execInPane as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2] as string);
    expect(commands[0]).toContain('set -o pipefail');
    expect(commands[0]).toContain('2>&1 | tee');
    expect(commands[0]).toContain("echo \"EXIT:$?\" >");
    expect(gateway.setPaneReadOnly).toHaveBeenCalledWith('wt-1', '%0', true);
  });

  it('env 注入：export 命令先于 pane 命令执行', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from([]));
    stubFiles('EXIT:0');

    const gen = spawnCliInTmux({ ...BASE_OPTS, env: { API_KEY: 'secret', NULL_KEY: null } }, { tmuxGateway: gateway });
    await gen.next();
    await gen.next();

    const calls = (gateway.execInPane as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[2]).toBe("export API_KEY='secret'");
    // null 值 env 不注入
    expect(calls.some((c) => String(c[2]).includes('NULL_KEY'))).toBe(false);
  });

  it('stdinInput 写入 0600 临时文件并重定向到 pane 命令', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from([]));
    stubFiles('EXIT:0');

    const gen = spawnCliInTmux({ ...BASE_OPTS, stdinInput: 'prompt content' }, { tmuxGateway: gateway });
    await gen.next();
    await gen.next();

    expect(h.writeFileMock).toHaveBeenCalledWith(join(TMP, 'stdin'), 'prompt content', { mode: 0o600 });
    const commands = (gateway.execInPane as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2] as string);
    expect(commands[0]).toContain(join(TMP, 'stdin'));
  });

  it('异常退出（exit 1 + stderr 401）→ __cliError + cliDiagnostics 分类 auth_failed', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from([]));
    stubFiles('EXIT:1', '401 Unauthorized');

    const gen = spawnCliInTmux(BASE_OPTS, { tmuxGateway: gateway });
    await gen.next(); // __tmuxPaneCreated
    const errEvt = await gen.next();
    expect((errEvt.value as Record<string, unknown>).__cliError).toBe(true);
    const evt = errEvt.value as {
      exitCode: number;
      message: string;
      cliDiagnostics: { reasonCode: string; publicSummary: string };
    };
    expect(evt.exitCode).toBe(1);
    expect(evt.message).toContain('CLI 异常退出');
    expect(evt.cliDiagnostics.reasonCode).toBe('auth_failed');
    expect(evt.cliDiagnostics.publicSummary).toContain('API 认证失败');

    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it('finalSemanticDone 抑制：turn.completed 后 exit 1 不再报 __cliError', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from(['{"type":"turn.completed"}\n']));
    stubFiles('EXIT:1');

    const gen = spawnCliInTmux(BASE_OPTS, { tmuxGateway: gateway });
    await gen.next(); // __tmuxPaneCreated
    await gen.next(); // turn.completed
    const done = await gen.next();
    expect(done.done).toBe(true);
    expect(done.value).toEqual({ paneId: '%0' });
  });

  it('finalSemanticDone 失败路径：completed 后 failed → 仍报 __cliError（本地时序胜出）', async () => {
    h.createReadStreamMock.mockReturnValue(
      Readable.from(['{"type":"turn.completed"}\n', '{"type":"turn.failed"}\n']),
    );
    stubFiles('EXIT:1');

    const gen = spawnCliInTmux(BASE_OPTS, { tmuxGateway: gateway });
    await gen.next(); // __tmuxPaneCreated
    await gen.next(); // turn.completed
    await gen.next(); // turn.failed
    const errEvt = await gen.next();
    expect((errEvt.value as Record<string, unknown>).__cliError).toBe(true);
  });

  it('plainText 模式：__cliPlainText 聚合 stdout/stderr/exitCode，命令含独立 stderr 重定向', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from(['hello ', 'world\n']));
    stubFiles('EXIT:3', 'boom stderr');

    const gen = spawnCliInTmux({ ...BASE_OPTS, outputMode: 'plainText' }, { tmuxGateway: gateway });
    await gen.next(); // __tmuxPaneCreated
    const pt = await gen.next();
    const evt = pt.value as { __cliPlainText: boolean; stdout: string; stderr: string; exitCode: number };
    expect(evt.__cliPlainText).toBe(true);
    expect(evt.stdout).toBe('hello world\n');
    expect(evt.stderr).toBe('boom stderr');
    expect(evt.exitCode).toBe(3);

    const commands = (gateway.execInPane as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2] as string);
    expect(commands[0]).toContain('2>');
    expect(commands[0]).toContain('stderr.log');
    expect(commands[0]).toContain('>&2');
    expect(commands[0]).not.toContain('2>&1');
  });

  it('plainText 模式异常退出：exit 非 0 → __cliError（stderr 文件内容入 rawText 分类）', async () => {
    h.createReadStreamMock.mockReturnValue(Readable.from(['output text']));
    stubFiles('EXIT:2', 'rate limit exceeded (429)');

    const gen = spawnCliInTmux({ ...BASE_OPTS, outputMode: 'plainText' }, { tmuxGateway: gateway });
    await gen.next(); // __tmuxPaneCreated
    await gen.next(); // __cliPlainText
    const errEvt = await gen.next();
    const evt = errEvt.value as { __cliError: boolean; cliDiagnostics: { reasonCode: string } };
    expect(evt.__cliError).toBe(true);
    expect(evt.cliDiagnostics.reasonCode).toBe('quota_exceeded');
  });

  it('firstEventTimeout：流无事件 → __cliTimeout（timeoutMs = firstEventTimeoutMs）', async () => {
    vi.useFakeTimers();
    h.createReadStreamMock.mockReturnValue(new Readable({ read() {} })); // 永不结束
    stubFiles('EXIT:0');

    const gen = spawnCliInTmux({ ...BASE_OPTS, firstEventTimeoutMs: 1000 }, { tmuxGateway: gateway });
    const first = await gen.next();
    expect(first.value).toMatchObject({ __tmuxPaneCreated: true });

    // 第二次 next() 推进 generator：startFirstEventTimeout 注册 timer → for await 挂起
    const second = gen.next();
    // firstEventTimer 触发 → killAgent：rl.close() → send-keys C-c → 3000ms grace → kill-pane
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3100);

    const t = await second;
    const evt = t.value as { __cliTimeout: boolean; timeoutMs: number; message: string };
    expect(evt.__cliTimeout).toBe(true);
    expect(evt.timeoutMs).toBe(1000);
    expect(evt.message).toContain('启动超时');
    expect(h.execFileSyncMock).toHaveBeenCalledWith(
      '/fake/bin/tmux',
      ['-L', 'flowforge-wt-1', 'send-keys', '-t', '%0', 'C-c', ''],
      { stdio: 'ignore' },
    );

    const done = await gen.next();
    expect(done.done).toBe(true);
    expect(done.value).toEqual({ paneId: '%0' });
  });

  it('setup 失败（mkfifo 抛错）→ tmpDir 清理后传播', async () => {
    installExecFileMock(() => new Error('mkfifo: not found'));
    h.createReadStreamMock.mockReturnValue(Readable.from([]));

    const gen = spawnCliInTmux(BASE_OPTS, { tmuxGateway: gateway });
    await expect(gen.next()).rejects.toThrow('mkfifo: not found');
    expect(h.rmMock).toHaveBeenCalledWith(TMP, { recursive: true, force: true });
  });
});
