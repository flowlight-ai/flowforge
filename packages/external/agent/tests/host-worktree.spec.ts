/**
 * host-injection + worktree — host-owned 注入与工作区隔离测试（EX-005 / F241 CL-015）。
 *
 * 语义对照 flowforge/core/external_agent/test_host_injection.py + test_worktree.py：
 *   - HostInjector.injectCredentials：注入成功 / 缺失抛错 / extraEnv
 *   - injectSandbox：cwd / network_allowlist / writable 默认仅 worktree
 *   - injectMcpConfig：${ENV_VAR} 解析 + env_keys 保留（脱敏）
 *   - ExternalAgentWorktree.create：唯一目录名 / 复制源（跳过 .git 等）/
 *     audit / rollback / cleanup
 *
 * @module @flowforge/external-agent/tests
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CredentialStore,
  HostInjector,
  type McpServerSpec,
} from '../src/host-injection.js';
import { ExternalAgentWorktree } from '../src/worktree.js';

/** 内存 CredentialStore。 */
class MemCredentialStore implements CredentialStore {
  values = new Map<string, string>();

  get(envVar: string): string | undefined {
    return this.values.get(envVar);
  }
}

describe('HostInjector.injectCredentials（host_injection.py）', () => {
  it('全部存在时注入成功', () => {
    const store = new MemCredentialStore();
    store.values.set('TOKEN_A', 'secret-a');
    store.values.set('TOKEN_B', 'secret-b');
    const injector = new HostInjector(store);
    const env = injector.injectCredentials('a.b', ['TOKEN_A', 'TOKEN_B']);
    expect(env).toEqual({ TOKEN_A: 'secret-a', TOKEN_B: 'secret-b' });
  });

  it('缺失必需变量抛错（ValueError 语义）', () => {
    const injector = new HostInjector(new MemCredentialStore());
    expect(() =>
      injector.injectCredentials('a.b', ['TOKEN_A', 'TOKEN_B']),
    ).toThrow(/missing required env vars: TOKEN_A, TOKEN_B/);
  });

  it('extraEnv 合并覆盖', () => {
    const store = new MemCredentialStore();
    store.values.set('TOKEN_A', 'secret-a');
    const injector = new HostInjector(store);
    const env = injector.injectCredentials('a.b', ['TOKEN_A'], {
      EXTRA: 'x',
      TOKEN_A: 'override',
    });
    expect(env.TOKEN_A).toBe('override');
    expect(env.EXTRA).toBe('x');
  });
});

describe('HostInjector.injectSandbox（EX-005 最小权限）', () => {
  it('writable 默认仅 worktree 路径', () => {
    const injector = new HostInjector(new MemCredentialStore());
    const sandbox = injector.injectSandbox('a.b', '/tmp/wt-1');
    expect(sandbox.cwd).toBe('/tmp/wt-1');
    expect(sandbox.file_writable_paths).toEqual(['/tmp/wt-1']);
    expect(sandbox.file_readonly_paths).toEqual([]);
    expect(sandbox.network_allowlist).toEqual([]);
  });

  it('自定义网络白名单与权限路径', () => {
    const injector = new HostInjector(new MemCredentialStore());
    const sandbox = injector.injectSandbox(
      'a.b',
      '/tmp/wt-1',
      ['api.github.com'],
      ['/tmp/wt-1', '/tmp/shared'],
      ['/etc/config'],
    );
    expect(sandbox.network_allowlist).toEqual(['api.github.com']);
    expect(sandbox.file_writable_paths).toEqual(['/tmp/wt-1', '/tmp/shared']);
    expect(sandbox.file_readonly_paths).toEqual(['/etc/config']);
  });
});

describe('HostInjector.injectMcpConfig（host 维护，plugin 只读）', () => {
  it('${ENV_VAR} 占位符解析为真实值', () => {
    const store = new MemCredentialStore();
    store.values.set('GITHUB_TOKEN', 'real-token');
    const injector = new HostInjector(store);
    const servers: McpServerSpec[] = [
      {
        name: 'github',
        command: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
      },
    ];
    const result = injector.injectMcpConfig('a.b', servers);
    const server = (result['mcp_servers'] as Record<string, unknown>[])[0];
    expect(server!['env']).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'real-token' });
    // env_keys 保留键名（脱敏不泄露值）
    expect(server!['env_keys']).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);
  });

  it('缺失凭据时保留占位符原样', () => {
    const injector = new HostInjector(new MemCredentialStore());
    const servers: McpServerSpec[] = [
      { name: 'x', env: { KEY: '${MISSING_VAR}' } },
    ];
    const result = injector.injectMcpConfig('a.b', servers);
    const server = (result['mcp_servers'] as Record<string, unknown>[])[0];
    expect(server!['env']).toEqual({ KEY: '${MISSING_VAR}' });
  });

  it('无 env 的服务器不注入 env_keys', () => {
    const injector = new HostInjector(new MemCredentialStore());
    const result = injector.injectMcpConfig('a.b', [{ name: 'plain' }]);
    const server = (result['mcp_servers'] as Record<string, unknown>[])[0];
    expect(server!['env_keys']).toBeUndefined();
    expect(server!['name']).toBe('plain');
  });
});

describe('ExternalAgentWorktree（worktree.py）', () => {
  it('create 生成唯一目录名（provider 点转下划线 + forgekin + ts + uuid）', () => {
    const root = mkdtempSync(join(tmpdir(), 'ex-wt-'));
    try {
      const wt = ExternalAgentWorktree.create('a.b', 'fk-1', undefined, {
        worktree_root: root,
      });
      const dirName = wt.worktreePath.split(/[\\/]/).pop() ?? '';
      expect(dirName).toMatch(/^a_b-fk-1-\d{13}-[0-9a-f]{8}$/);
      expect(existsSync(wt.worktreePath)).toBe(true);
      wt.cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('复制源目录并跳过 .git / node_modules / __pycache__ / .venv', () => {
    const root = mkdtempSync(join(tmpdir(), 'ex-wt-src-'));
    try {
      const src = join(root, 'src-repo');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'main.ts'), '// main');
      writeFileSync(join(src, '.gitkeep'), '');
      // 跳过目录
      for (const skip of ['.git', 'node_modules', '__pycache__', '.venv']) {
        mkdirSync(join(src, skip), { recursive: true });
        writeFileSync(join(src, skip, 'x'), 'x');
      }
      const wt = ExternalAgentWorktree.create('a.b', 'fk-1', undefined, {
        worktree_root: root,
        source_repo: src,
      });
      expect(existsSync(join(wt.worktreePath, 'main.ts'))).toBe(true);
      expect(existsSync(join(wt.worktreePath, '.gitkeep'))).toBe(true);
      expect(existsSync(join(wt.worktreePath, '.git', 'x'))).toBe(false);
      expect(existsSync(join(wt.worktreePath, 'node_modules', 'x'))).toBe(false);
      expect(existsSync(join(wt.worktreePath, '__pycache__', 'x'))).toBe(false);
      expect(existsSync(join(wt.worktreePath, '.venv', 'x'))).toBe(false);
      wt.cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('audit / exportAuditLog 记录操作', () => {
    const root = mkdtempSync(join(tmpdir(), 'ex-wt-audit-'));
    try {
      const wt = ExternalAgentWorktree.create('a.b', 'fk-1', undefined, {
        worktree_root: root,
      });
      wt.audit('test', 'ran tests');
      const log = wt.exportAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
      expect(log[0]!.action).toBe('create');
      expect(log[1]).toMatchObject({ action: 'test', detail: 'ran tests' });
      expect(log[1]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      wt.cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rollback 删除新增文件（快照恢复）', () => {
    const root = mkdtempSync(join(tmpdir(), 'ex-wt-rollback-'));
    try {
      const wt = ExternalAgentWorktree.create('a.b', 'fk-1', undefined, {
        worktree_root: root,
        enable_rollback: true,
      });
      writeFileSync(join(wt.worktreePath, 'new-file.txt'), 'new');
      expect(existsSync(join(wt.worktreePath, 'new-file.txt'))).toBe(true);
      wt.rollback();
      expect(existsSync(join(wt.worktreePath, 'new-file.txt'))).toBe(false);
      expect(existsSync(wt.worktreePath)).toBe(true);
      wt.cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleanup 删除整个 worktree 目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'ex-wt-clean-'));
    try {
      const wt = ExternalAgentWorktree.create('a.b', 'fk-1', undefined, {
        worktree_root: root,
      });
      const path = wt.worktreePath;
      expect(existsSync(path)).toBe(true);
      wt.cleanup();
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
