/**
 * C28 Workspace 包测试 — @flowforge/cats-workspace。
 *
 * 覆盖：
 *  - ctx.plugin(CatsWorkspace) → ctx.catsWorkspace 挂载 + 工厂
 *  - WorkspaceSecurity：traversal/denylist 防护 + worktree 列表（GitRunner mock）
 *    + linked roots（env + config 注入）+ 注册表
 *  - path-resolution：绝对路径 / Markdown href → typed target
 *  - EditSession：HMAC token（固定 secret + 时钟）+ sha256 冲突检测原子写
 *  - file-read：MIME 猜测 / 二进制分类 / 有界预览 / sha256 签名
 *  - watcher：mock socket server → watch-file 立即 sha mismatch 通知 + unwatch 清理
 *  - navigation-delivery：回执聚合优先级 + emit 无 ack 降级
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Context } from '@flowforge/cordis';
import CatsWorkspace, {
  EditSession,
  WorkspaceSecurity,
  WorkspaceSecurityError,
  aggregateWorkspaceNavigationReceipts,
  computeWorkspaceFileSha256,
  emitWorkspaceNavigate,
  guessMime,
  isKnownBinaryPath,
  readWorkspaceFilePreview,
  resolveWorkspaceAbsolutePath,
  resolveWorkspaceDocumentHref,
  setupWorkspaceFileWatcher,
  type GitResult,
  type GitRunner,
  type WorkspaceSocketServer,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withWorkspace(): Promise<Context> {
  const ctx = new Context();
  const fiber = await ctx.plugin(CatsWorkspace) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

/** GitRunner mock：单 worktree 输出。 */
function worktreeRunner(stdout: string | null, opts: { isGit?: boolean } = {}): GitRunner {
  const isGit = opts.isGit ?? true;
  return {
    exec: vi.fn(async (args: string[]): Promise<GitResult> => {
      if (!isGit && (args.includes('--is-inside-work-tree') || args.includes('--is-bare-repository'))) {
        return { ok: false, err: { code: '128' } };
      }
      if (args[0] === 'worktree') return stdout === null ? { ok: false, err: new Error('no git') } : { ok: true, stdout };
      return { ok: true, stdout: 'true' };
    }),
  };
}

const PORCELAIN = [
  'worktree /repo/main',
  'HEAD abcdef12',
  'branch refs/heads/main',
  '',
  'worktree /repo/wt-1',
  'HEAD 12345678',
  'branch refs/heads/feature-1',
  '',
].join('\n');

describe('C28 WorkspaceService — Cordis 服务生命周期', () => {
  it('mounts at ctx.catsWorkspace after ctx.plugin(CatsWorkspace)', async () => {
    const ctx = await withWorkspace();
    expect(ctx.catsWorkspace).toBeInstanceOf(CatsWorkspace);
  });

  it('工厂：createSecurity / createEditSession / setupFileWatcher / resolve*', async () => {
    const ctx = await withWorkspace();
    const svc = ctx.catsWorkspace;
    const security = svc.createSecurity({ cwd: tmpdir() });
    expect(security).toBeInstanceOf(WorkspaceSecurity);
    expect(svc.createEditSession()).toBeInstanceOf(EditSession);
    expect(typeof svc.setupFileWatcher).toBe('function');
    expect(typeof svc.resolveAbsolutePath).toBe('function');
    expect(typeof svc.resolveDocumentHref).toBe('function');
  });
});

describe('C28 WorkspaceSecurity — 路径防护', () => {
  it('resolveWorkspaceFilesystemPath 拒绝 traversal（..）与绝对路径逃逸', async () => {
    const security = new WorkspaceSecurity({ cwd: tmpdir() });
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', '../secret.txt'))
      .rejects.toThrow(WorkspaceSecurityError);
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', '/etc/passwd'))
      .rejects.toThrow(WorkspaceSecurityError);
    // 正常路径通过（文件不存在时仅做词法检查）；Windows 下 resolve 挂当前盘符
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', 'src/main.ts'))
      .resolves.toBe(resolve('/repo/app', 'src/main.ts'));
  });

  it('resolveWorkspacePath 解码 URI 转义；denylist 目录/模式拒绝', async () => {
    const security = new WorkspaceSecurity({ cwd: tmpdir() });
    // %2F 解码为路径分隔符，不逃逸时合法通过
    await expect(security.resolveWorkspacePath('/repo/app', 'a%2Fb'))
      .resolves.toBe(resolve('/repo/app', 'a/b'));
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', '.env.local')).rejects.toThrow(WorkspaceSecurityError);
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', 'id_rsa.pub')).rejects.toThrow(WorkspaceSecurityError);
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', 'secrets/x.txt')).rejects.toThrow(WorkspaceSecurityError);
    await expect(security.resolveWorkspaceFilesystemPath('/repo/app', '.git/config')).rejects.toThrow(WorkspaceSecurityError);
  });

  it('isDenylisted：相对路径命中 denylist', () => {
    const security = new WorkspaceSecurity({ cwd: tmpdir() });
    expect(security.isDenylisted('src/main.ts')).toBe(false);
    expect(security.isDenylisted('.env')).toBe(true);
    expect(security.isDenylisted('a/secret.pem')).toBe(true);
    expect(security.isDenylisted('a/.git/b')).toBe(true);
  });
});

describe('C28 WorkspaceSecurity — worktree + linked roots', () => {
  it('listWorktrees 解析 porcelain 输出 + 去重 id', async () => {
    const security = new WorkspaceSecurity({ cwd: '/repo', gitRunner: worktreeRunner(PORCELAIN) });
    const entries = await security.listWorktrees('/repo');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.root).toBe('/repo/main');
    expect(entries[0]?.branch).toBe('main');
    expect(entries[0]?.head).toBe('abcdef12');
    expect(entries[1]?.branch).toBe('feature-1');
  });

  it('非 git 仓库 → fallback startup-root 条目；git 不可用 → null 上游回退', async () => {
    const security = new WorkspaceSecurity({
      cwd: '/repo',
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    const entries = await security.listWorktrees('/repo');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.head).toBe('nogit');
    expect(entries[0]?.branch).toBe('exported');
  });

  it('linked roots：env var + 注入 config 合并去重（env 优先）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    const configPath = join(dir, 'linked-roots.json');
    await writeFile(configPath, JSON.stringify([{ name: 'cfg-root', path: dir }]));
    const security = new WorkspaceSecurity({
      cwd: dir,
      env: { WORKSPACE_LINKED_ROOTS: `env-root:${dir}` },
      linkedRootsConfigPath: configPath,
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    const roots = await security.getLinkedRootsAsync();
    expect(roots.map((r) => r.id).sort()).toEqual(['linked_cfg-root', 'linked_env-root']);
    // config 中同名条目被 env 覆盖
    const envRoot = roots.find((r) => r.id === 'linked_env-root')!;
    expect(envRoot.branch).toBe('env-root');
  });

  it('addLinkedRoot 校验目录并持久化；removeLinkedRoot 返回是否移除', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    const configPath = join(dir, 'linked-roots.json');
    const security = new WorkspaceSecurity({
      cwd: dir,
      linkedRootsConfigPath: configPath,
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    const entry = await security.addLinkedRoot('my-root', dir);
    expect(entry.id).toBe('linked_my-root');
    expect(JSON.parse(await readFile(configPath, 'utf-8'))).toHaveLength(1);
    await expect(security.addLinkedRoot('bad', join(dir, 'nope'))).rejects.toThrow(WorkspaceSecurityError);
    expect(await security.removeLinkedRoot('linked_my-root')).toBe(true);
    expect(await security.removeLinkedRoot('linked_my-root')).toBe(false);
  });

  it('registerWorktrees + getWorktreeRoot + resolveWorktreeIdByPath', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    // cwd 独立于 dir，避免 fallback worktree 条目（root=cwd）抢先匹配
    const security = new WorkspaceSecurity({
      cwd: tmpdir(),
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    security.registerWorktrees([{ id: 'foreign-1', root: dir, branch: 'x', head: 'y' }]);
    expect(await security.getWorktreeRoot('foreign-1')).toBe(dir);
    await expect(security.getWorktreeRoot('missing')).rejects.toThrow(WorkspaceSecurityError);
    expect(await security.resolveWorktreeIdByPath(dir)).toBe('foreign-1');
  });
});

describe('C28 path-resolution — 绝对路径 / href', () => {
  it('resolveWorkspaceAbsolutePath：目录/文件 + 相对路径归一', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'a.md'), '# hi');
    // cwd 独立于 dir，避免 fallback worktree 条目（root=cwd）抢先匹配
    const security = new WorkspaceSecurity({
      cwd: tmpdir(),
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    security.registerWorktrees([{ id: 'ws-1', root: dir, branch: 'x', head: 'y' }]);

    const fileTarget = await resolveWorkspaceAbsolutePath(security, join(dir, 'a.md'));
    expect(fileTarget.worktreeId).toBe('ws-1');
    expect(fileTarget.path).toBe('a.md');
    expect(fileTarget.kind).toBe('file');

    const dirTarget = await resolveWorkspaceAbsolutePath(security, join(dir, 'sub'));
    expect(dirTarget.kind).toBe('directory');
    expect(dirTarget.path).toBe('sub');

    await expect(resolveWorkspaceAbsolutePath(security, 'relative/path')).rejects.toThrow(WorkspaceSecurityError);
    await expect(resolveWorkspaceAbsolutePath(security, join(dir, 'missing.md'))).rejects.toThrow(WorkspaceSecurityError);
  });

  it('resolveWorkspaceDocumentHref：md 文件 + :line；非文件拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    await writeFile(join(dir, 'doc.md'), '# doc');
    await mkdir(join(dir, 'sub'));
    const security = new WorkspaceSecurity({
      cwd: tmpdir(),
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    security.registerWorktrees([{ id: 'ws-1', root: dir, branch: 'x', head: 'y' }]);

    const target = await resolveWorkspaceDocumentHref(security, `${join(dir, 'doc.md')}:12`);
    expect(target.path).toBe('doc.md');
    expect(target.line).toBe(12);
    expect((await resolveWorkspaceDocumentHref(security, join(dir, 'doc.md'))).line).toBeNull();
    await expect(resolveWorkspaceDocumentHref(security, join(dir, 'sub'))).rejects.toThrow(WorkspaceSecurityError);
    await expect(resolveWorkspaceDocumentHref(security, 'not-an-abs-path.md')).rejects.toThrow(WorkspaceSecurityError);
  });
});

describe('C28 EditSession — token + 冲突写', () => {
  const FIXED_SECRET = new Uint8Array(32).fill(3);
  let now = 1_000_000;

  function session(): EditSession {
    return new EditSession({ secret: FIXED_SECRET, ttlMs: 30_000, now: () => now });
  }

  it('sign/verify：有效 token 返回 payload；篡改/过期/worktreeId 不匹配拒绝', () => {
    const s = session();
    const token = s.signEditToken('wt-1');
    expect(s.verifyEditToken(token, 'wt-1')?.worktreeId).toBe('wt-1');

    // 篡改签名
    const tampered = `${token.slice(0, -2)}xx`;
    expect(s.verifyEditToken(tampered, 'wt-1')).toBeNull();
    // 无签名分隔
    expect(s.verifyEditToken('no-dot-here', 'wt-1')).toBeNull();
    // worktreeId 不匹配
    expect(s.verifyEditToken(token, 'wt-2')).toBeNull();

    // 过期（时钟前移 31s）
    now += 31_000;
    expect(s.verifyEditToken(token, 'wt-1')).toBeNull();
  });

  it('writeWorkspaceFile：base 一致写入返回新 sha；不一致返回 CONFLICT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    const file = join(dir, 'x.txt');
    await writeFile(file, 'v1');
    const s = session();
    const base = createHash('sha256').update('v1').digest('hex');

    const ok = await s.writeWorkspaceFile(file, 'v2', base);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.size).toBe(2);
      expect(ok.newSha256).toBe(createHash('sha256').update('v2').digest('hex'));
      expect(await readFile(file, 'utf-8')).toBe('v2');
    }

    const conflict = await s.writeWorkspaceFile(file, 'v3', base);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe('CONFLICT');
      expect(conflict.currentSha256).toBe(ok.ok ? ok.newSha256 : '');
    }
  });
});

describe('C28 file-read — 预览 + 签名', () => {
  it('guessMime / isKnownBinaryPath：扩展名分类', () => {
    expect(guessMime('a.ts')).toBe('text/typescript');
    expect(guessMime('a.unknown')).toBe('text/plain');
    expect(isKnownBinaryPath('a.png')).toBe(true);
    expect(isKnownBinaryPath('a.mp4')).toBe(true);
    expect(isKnownBinaryPath('a.ts')).toBe(false);
  });

  it('readWorkspaceFilePreview：文本有界读 + sha；二进制（NUL）返回空 content/sha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    const textFile = join(dir, 'a.txt');
    await writeFile(textFile, 'hello world');
    const preview = await readWorkspaceFilePreview(textFile);
    expect(preview.content).toBe('hello world');
    expect(preview.binary).toBe(false);
    expect(preview.truncated).toBe(false);
    expect(preview.sha256).toBe(createHash('sha256').update('hello world').digest('hex'));

    const binFile = join(dir, 'a.bin');
    await writeFile(binFile, Buffer.from([0, 1, 2, 3]));
    const binPreview = await readWorkspaceFilePreview(binFile);
    expect(binPreview.binary).toBe(true);
    expect(binPreview.content).toBe('');
    expect(binPreview.sha256).toBe('');

    // 超限 → truncated + 空 sha
    await writeFile(textFile, 'x'.repeat(100));
    const big = await readWorkspaceFilePreview(textFile, { maxBytes: 10 });
    expect(big.truncated).toBe(true);
    expect(big.sha256).toBe('');
  });

  it('computeWorkspaceFileSha256：媒体/二进制/超限返回空串；读错误返回 null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    const textFile = join(dir, 'a.txt');
    await writeFile(textFile, 'abc');
    expect(await computeWorkspaceFileSha256(textFile)).toBe(createHash('sha256').update('abc').digest('hex'));
    const pngFile = join(dir, 'a.png');
    await writeFile(pngFile, 'not-really-png');
    expect(await computeWorkspaceFileSha256(pngFile)).toBe('');
    expect(await computeWorkspaceFileSha256(join(dir, 'missing.txt'))).toBeNull();
  });
});

describe('C28 watcher — socket 端口注入', () => {
  interface MockSocket {
    id: string;
    handlers: Map<string, (data: unknown) => void>;
    emitted: Array<{ event: string; data: unknown }>;
    on: (event: string, listener: (data: unknown) => void) => void;
    emit: (event: string, data: unknown) => void;
  }

  function mockServer(): { server: WorkspaceSocketServer; sockets: MockSocket[]; connections: MockSocket[] } {
    const connections: MockSocket[] = [];
    const sockets: MockSocket[] = [];
    const server: WorkspaceSocketServer = {
      on(event, listener) {
        expect(event).toBe('connection');
        const socket: MockSocket = {
          id: `sock-${sockets.length}`,
          handlers: new Map(),
          emitted: [],
          on: (ev: string, l: (data: unknown) => void) => {
            socket.handlers.set(ev, l);
          },
          emit: (ev: string, data: unknown) => {
            socket.emitted.push({ event: ev, data });
          },
        };
        sockets.push(socket);
        connections.push(socket);
        listener(socket);
      },
    };
    return { server, sockets, connections };
  }

  it('watch-file：立即 sha mismatch 通知 + unwatch 清理', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cats-ws-'));
    const file = join(dir, 'w.txt');
    await writeFile(file, 'content-v1');
    const security = new WorkspaceSecurity({
      cwd: dir,
      gitRunner: worktreeRunner(null, { isGit: false }),
    });
    security.registerWorktrees([{ id: 'ws-1', root: dir, branch: 'x', head: 'y' }]);
    const { server, sockets } = mockServer();
    const logger = { debug: vi.fn(), warn: vi.fn() };
    setupWorkspaceFileWatcher(server, security, logger);

    expect(sockets).toHaveLength(1);
    const socket = sockets[0]!;
    const watchHandler = socket.handlers.get('workspace:watch-file')!;
    await watchHandler({ worktreeId: 'ws-1', path: 'w.txt', sha256: 'stale-sha' });

    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0]?.event).toBe('workspace:file-changed');
    expect((socket.emitted[0]?.data as { sha256: string } | undefined)?.sha256).toBe(
      createHash('sha256').update('content-v1').digest('hex'),
    );

    // 二次 watch 前清理旧 watcher（无异常即通过）
    const unwatch = socket.handlers.get('workspace:unwatch-file')!;
    unwatch({});
    await watchHandler({ worktreeId: 'ws-1', path: 'w.txt', sha256: 'stale-sha' });
  });

  it('watch-file：缺 worktreeId/path 静默忽略', async () => {
    const security = new WorkspaceSecurity({ cwd: tmpdir() });
    const { server, sockets } = mockServer();
    setupWorkspaceFileWatcher(server, security);
    const socket = sockets[0]!;
    const watchHandler = socket.handlers.get('workspace:watch-file')!;
    await watchHandler({});
    expect(socket.emitted).toHaveLength(0);
  });
});

describe('C28 navigation-delivery — 回执聚合', () => {
  it('aggregate：status 优先级 applied > blocked > queued；同 status 按 reason 优先级', () => {
    const eventId = 'ev-1';
    const receipts = [
      { eventId, status: 'queued', reason: 'narrow_viewport' },
      { eventId, status: 'blocked', reason: 'thread_inactive' },
      { eventId: 'other', status: 'applied' }, // 不匹配 eventId，过滤
    ];
    expect(aggregateWorkspaceNavigationReceipts(eventId, receipts)).toEqual({
      deliveryStatus: 'blocked',
      deliveryReason: 'thread_inactive',
    });
    expect(aggregateWorkspaceNavigationReceipts(eventId, [])).toEqual({
      deliveryStatus: 'unconfirmed',
      deliveryReason: 'no_client_ack',
    });
  });

  it('emitWorkspaceNavigate：无 ack emitter 降级 unconfirmed；有 ack 聚合回执', async () => {
    const legacy: string[] = [];
    const emitter = {
      socketEmit: vi.fn(),
      socketEmitWithAck: vi.fn(async () => [
        { eventId: 'ev-1', status: 'applied' },
        { eventId: 'ev-1', status: 'queued', reason: 'narrow_viewport' },
      ]),
    };
    const result = await emitWorkspaceNavigate(emitter, { eventId: 'ev-1' }, legacy);
    expect(result).toEqual({ deliveryStatus: 'applied' });
    expect(emitter.socketEmit).not.toHaveBeenCalled();

    const noAck = await emitWorkspaceNavigate({ socketEmit: vi.fn() }, { eventId: 'ev-1' }, ['room-1']);
    expect(noAck).toEqual({ deliveryStatus: 'unconfirmed', deliveryReason: 'no_client_ack' });
  });
});
