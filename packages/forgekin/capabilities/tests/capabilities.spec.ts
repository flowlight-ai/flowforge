/**
 * capabilities 插件包测试 — C34a（F041 统一能力模型）。
 *
 * 覆盖：安装预览 / 脱敏 / 写守卫（loopback + owner 闸门）/ 安装策略 /
 * 版本锁 / 探测状态 / v1→v2 迁移 / heal 拓扑链（legacy → splits）/
 * MCP install/remove #712 管线（lock → heal → write → CLI regen → audit）/
 * Cordis 插件挂载 + orchestrate 端到端。
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import type { CapabilitiesConfig, CapabilityEntry } from '@flowforge/cats-shared';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeCapabilitiesService, {
  REDACTED_CAPABILITY_SECRET,
  buildInstallPreview,
  buildLockVersion,
  buildProbeState,
  computeToolDiff,
  containsRedactedPlaceholder,
  evaluateInstallPolicy,
  healCatCafeMcpTopology,
  isLocalCapabilityWriteRequest,
  isLoopbackAddress,
  migrateCapabilitiesV1ToV2,
  requireCapabilityWriteOwner,
  requireLocalCapabilityWriteRequest,
  revokeCapability,
  sanitizeCapabilityForAudit,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// 临时目录
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-capabilities-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 纯函数：安装预览
// ---------------------------------------------------------------------------

describe('buildInstallPreview', () => {
  it('构造 MCP 条目预览并列出受影响 CLI 配置', () => {
    const preview = buildInstallPreview({ id: 'fs-mcp', command: 'node', args: ['server.js'] });
    expect(preview.entry.id).toBe('fs-mcp');
    expect(preview.entry.type).toBe('mcp');
    expect(preview.entry.source).toBe('external');
    expect(preview.entry.mcpServer?.command).toBe('node');
    expect(preview.cliConfigsAffected).toContain('.gemini/settings.json');
    expect(preview.willProbe).toBe(true);
    expect(preview.risks).toEqual([]);
  });

  it('重复安装与不可解析给出风险提示', () => {
    const existing: CapabilityEntry[] = [
      { id: 'fs-mcp', type: 'mcp', enabled: true, source: 'external' },
    ];
    const dup = buildInstallPreview({ id: 'fs-mcp', command: 'node' }, existing);
    expect(dup.risks.some((r) => r.includes('already exists'))).toBe(true);

    const unresolvable = buildInstallPreview({ id: 'ghost' });
    expect(unresolvable.risks.some((r) => r.includes('unresolvable'))).toBe(true);
  });

  it('非法输入抛错', () => {
    expect(() => buildInstallPreview({ id: '', command: 'node' })).toThrow(/id/);
    expect(() => buildInstallPreview({ id: 'x', args: 'bad' as unknown as string[] })).toThrow(/args/);
  });
});

// ---------------------------------------------------------------------------
// 纯函数：脱敏 + 写守卫
// ---------------------------------------------------------------------------

describe('redaction + write guards', () => {
  it('脱敏 env/headers 且保留结构', () => {
    const entry: CapabilityEntry = {
      id: 'secret-mcp',
      type: 'mcp',
      enabled: true,
      source: 'external',
      mcpServer: {
        command: 'node',
        args: ['-e', '1'],
        env: { API_KEY: 'sk-live-xxx' },
        headers: { Authorization: 'Bearer t' },
      },
    };
    const sanitized = sanitizeCapabilityForAudit(entry);
    expect(sanitized?.mcpServer?.env?.API_KEY).toBe(REDACTED_CAPABILITY_SECRET);
    expect(sanitized?.mcpServer?.headers?.Authorization).toBe(REDACTED_CAPABILITY_SECRET);
    // 原对象不被修改
    expect(entry.mcpServer?.env?.API_KEY).toBe('sk-live-xxx');
  });

  it('containsRedactedPlaceholder 深度检测', () => {
    expect(containsRedactedPlaceholder(REDACTED_CAPABILITY_SECRET)).toBe(true);
    expect(containsRedactedPlaceholder({ a: { b: [REDACTED_CAPABILITY_SECRET] } })).toBe(true);
    expect(containsRedactedPlaceholder({ a: 'clean' })).toBe(false);
  });

  it('loopback 判定', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
  });

  it('本地回环写请求放行、代理转发头拒绝', () => {
    const local = {
      ip: '127.0.0.1',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    };
    expect(isLocalCapabilityWriteRequest(local)).toBe(true);
    expect(requireLocalCapabilityWriteRequest(local)).toBeNull();

    const proxied = {
      ip: '127.0.0.1',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'x-forwarded-for': '1.2.3.4' },
    };
    expect(requireLocalCapabilityWriteRequest(proxied)?.status).toBe(403);
  });

  it('owner gate：allowMissingOwner 单用户放行，配置后要求匹配', () => {
    const prev = process.env.DEFAULT_OWNER_USER_ID;
    delete process.env.DEFAULT_OWNER_USER_ID;
    try {
      expect(requireCapabilityWriteOwner('anyone', { allowMissingOwner: true })).toBeNull();
      process.env.DEFAULT_OWNER_USER_ID = 'owner-1';
      expect(requireCapabilityWriteOwner('owner-1', { allowMissingOwner: true })).toBeNull();
      expect(requireCapabilityWriteOwner('intruder', { allowMissingOwner: true })?.status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.DEFAULT_OWNER_USER_ID;
      else process.env.DEFAULT_OWNER_USER_ID = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// 纯函数：安装策略 / 版本锁 / 探测状态 / 吊销 / 迁移
// ---------------------------------------------------------------------------

describe('install policy / version lock / probe state / revoke', () => {
  it('evaluateInstallPolicy 门禁组合', () => {
    expect(evaluateInstallPolicy({ trustLevel: 'verified' }).allowed).toBe(true);
    const community = evaluateInstallPolicy({ trustLevel: 'community' });
    expect(community.allowed).toBe(false);
    expect(community.requiredConfirmations).toContain('community_trust');
    const scripts = evaluateInstallPolicy({ trustLevel: 'verified', hasInstallScripts: true });
    expect(scripts.allowed).toBe(false);
    expect(scripts.reason).toBe('install_scripts_denied');
    expect(
      evaluateInstallPolicy({ trustLevel: 'community', userConfirmed: true, hasInstallScripts: true, scriptsApproved: true })
        .allowed,
    ).toBe(true);
  });

  it('buildLockVersion 记录来源与时间', () => {
    const lock = buildLockVersion({ source: 'marketplace', version: '1.2.0', installedBy: 'user-1' });
    expect(lock.version).toBe('1.2.0');
    expect(lock.installedAt).toBeTruthy();
    expect(() => buildLockVersion({ source: 'marketplace', version: '', installedBy: 'u' })).toThrow();
  });

  it('computeToolDiff + buildProbeState 状态机', () => {
    expect(computeToolDiff(['a', 'b'], ['a', 'c'])).toEqual({
      hasMismatch: true,
      missing: ['b'],
      extra: ['c'],
    });
    expect(buildProbeState({ connectionStatus: 'unknown' }).status).toBe('not_probed');
    expect(buildProbeState({ connectionStatus: 'disconnected', error: 'timeout' }).status).toBe('probe_failed');
    expect(
      buildProbeState({ connectionStatus: 'connected', tools: [{ name: 'read' }] }).status,
    ).toBe('ready');
    expect(
      buildProbeState(
        { connectionStatus: 'connected', tools: [] },
        { declaredTools: ['read'] },
      ).status,
    ).toBe('probe_failed');
  });

  it('revokeCapability：外部可吊销，cat-cafe 拒绝', () => {
    const external: CapabilityEntry = { id: 'ext', type: 'mcp', enabled: true, source: 'external' };
    const revoked = revokeCapability(external, 'user-1');
    expect(revoked.entry.enabled).toBe(false);
    expect(revoked.auditAction).toBe('revoke');

    const builtin: CapabilityEntry = { id: 'cat-cafe-skills', type: 'mcp', enabled: true, source: 'cat-cafe' };
    expect(() => revokeCapability(builtin, 'user-1')).toThrow(/cannot revoke/);
  });

  it('migrateCapabilitiesV1ToV2 幂等 + skill mountPaths 回填', async () => {
    const root = makeTempRoot();
    const v1: CapabilitiesConfig = {
      version: 1,
      capabilities: [
        { id: 'demo-skill', type: 'skill', enabled: true, source: 'cat-cafe' },
        { id: 'off-skill', type: 'skill', enabled: false, source: 'cat-cafe' },
      ],
    };
    const v2 = await migrateCapabilitiesV1ToV2(root, v1);
    expect(v2.version).toBe(2);
    expect(v2.capabilities[0]?.mountPaths).toEqual([]);
    expect(v2.capabilities[1]?.mountPaths).toEqual([]);
    // 已是 v2 → 原样返回
    await expect(migrateCapabilitiesV1ToV2(root, v2)).resolves.toBe(v2);
  });
});

// ---------------------------------------------------------------------------
// heal 拓扑链：legacy cat-cafe → split 服务器
// ---------------------------------------------------------------------------

describe('healCatCafeMcpTopology', () => {
  it('legacy 单服务器条目迁移为 split 拓扑', () => {
    const repoRoot = makeTempRoot();
    const config: CapabilitiesConfig = {
      version: 2,
      capabilities: [
        {
          id: 'cat-cafe',
          type: 'mcp',
          enabled: true,
          source: 'cat-cafe',
          mcpServer: { command: 'node', args: ['legacy.js'], transport: 'stdio' },
        },
      ],
    };
    const { migrated, config: healed } = healCatCafeMcpTopology(config, { catCafeRepoRoot: repoRoot });
    expect(migrated).toBe(true);
    expect(healed.capabilities.some((c) => c.id === 'cat-cafe')).toBe(false);
    expect(healed.capabilities.filter((c) => c.source === 'cat-cafe').length).toBeGreaterThanOrEqual(6);
    // 幂等：第二次不再迁移
    const second = healCatCafeMcpTopology(healed, { catCafeRepoRoot: repoRoot });
    expect(second.migrated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cordis 插件 + 端到端管线
// ---------------------------------------------------------------------------

describe('ForgeCapabilitiesService（Cordis 插件）', () => {
  it('orchestrate bootstrap 创建 capabilities.json 与托管 split', async () => {
    const root = makeTempRoot();
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeCapabilitiesService, {
      projectRoot: root,
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    expect(ctx.forgeCapabilities).toBeDefined();
    const config = await ctx.forgeCapabilities.orchestrate();
    expect(config.capabilities.filter((c) => c.source === 'cat-cafe').length).toBeGreaterThanOrEqual(6);

    const filePath = join(root, '.cat-cafe', 'capabilities.json');
    expect(existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8')) as CapabilitiesConfig;
    expect(onDisk.capabilities.length).toBe(config.capabilities.length);
  });

  it('installMcp → removeMcp 管线 + 审计日志', async () => {
    const root = makeTempRoot();
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeCapabilitiesService, {
      projectRoot: root,
      userId: 'tester',
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    const svc = ctx.forgeCapabilities;

    await svc.orchestrate();

    // 安装
    const entry: CapabilityEntry = {
      id: 'ext-mcp',
      type: 'mcp',
      enabled: true,
      source: 'external',
      mcpServer: { command: 'node', args: ['-v'], transport: 'stdio' },
    };
    const installed = await svc.installMcp(entry);
    expect(installed.before).toBeNull();
    expect(installed.after.id).toBe('ext-mcp');

    // 审计：最近一条为 install，actor=tester
    const audit = await svc.auditLog(1);
    expect(audit.length).toBe(1);
    expect(audit[0]?.action).toBe('install');
    expect(audit[0]?.userId).toBe('tester');

    // 软删除 → 禁用保留
    const soft = await svc.removeMcp('ext-mcp');
    expect(soft.before?.id).toBe('ext-mcp');
    const after = await svc.readConfig();
    const disabled = after?.capabilities.find((c) => c.id === 'ext-mcp');
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.globalEnabled).toBe(false);

    // 硬删除 → 条目消失
    const hard = await svc.removeMcp('ext-mcp', { hard: true });
    expect(hard.before).not.toBeNull();
    const final = await svc.readConfig();
    expect(final?.capabilities.some((c) => c.id === 'ext-mcp')).toBe(false);

    const fullAudit = await svc.auditLog();
    expect(fullAudit.map((a) => a.action)).toEqual(['install', 'delete', 'delete']);
  });

  it('preview + resolveServers + heal（服务级）', async () => {
    const root = makeTempRoot();
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeCapabilitiesService, {
      projectRoot: root,
      cats: [{ catId: 'cat-a', provider: 'claude' }],
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    const svc = ctx.forgeCapabilities;

    await svc.orchestrate();

    const preview = await svc.preview({ id: 'another-mcp', command: 'node' });
    expect(preview.entry.id).toBe('another-mcp');
    expect(preview.risks).toEqual([]);

    const servers = await svc.resolveServers('cat-a');
    expect(Array.isArray(servers)).toBe(true);
    expect(servers.length).toBeGreaterThan(0);

    // heal：幂等无迁移
    const config = await svc.readConfig();
    expect(config).not.toBeNull();
    if (config) {
      expect(svc.heal(config).migrated).toBe(false);
    }
  });
});
