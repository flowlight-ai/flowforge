/**
 * MCP Drift Resolver 契约测试 — F249（B11）。
 *
 * 端到端 round-trip：写全局/项目 capabilities.json → `checkMcpProject` 产出
 * drift → `syncMcpDrift` 修复 → 复检确认零 drift，并核对 added/removed/
 * updated/skipped、`mcpSync` 状态与 override 清除语义。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CapabilitiesConfig } from '@flowforge/cats-shared';
import { afterEach, describe, expect, it } from 'vitest';

import { checkMcpProject, syncMcpDrift } from '../src/index.ts';

// ---------------------------------------------------------------------------
// 临时目录
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempRoot(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ff-mcpdrift-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function writeCapabilitiesDir(root: string, config: CapabilitiesConfig): void {
  const dir = join(root, '.cat-cafe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'capabilities.json'), JSON.stringify(config), 'utf-8');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function globalConfig(): CapabilitiesConfig {
  return {
    version: 2,
    capabilities: [
      {
        id: 'global-only',
        type: 'mcp',
        enabled: true,
        globalEnabled: true,
        source: 'cat-cafe',
        mcpServer: { command: 'node', args: ['a.js'] },
      },
      {
        id: 'common',
        type: 'mcp',
        enabled: true,
        globalEnabled: true,
        source: 'cat-cafe',
        mcpServer: { command: 'node', args: ['shared.js'] },
      },
    ],
  };
}

function projectConfig(): CapabilitiesConfig {
  return {
    version: 2,
    capabilities: [
      {
        id: 'common',
        type: 'mcp',
        enabled: true,
        globalEnabled: true,
        source: 'cat-cafe',
        mcpServer: { command: 'node', args: ['shared-old.js'] },
        mcpServerOverride: { command: 'node', args: ['project-own.js'] },
      },
      {
        id: 'orphan',
        type: 'mcp',
        enabled: true,
        globalEnabled: true,
        source: 'cat-cafe',
        mcpServer: { command: 'node', args: ['gone.js'] },
      },
    ],
    mcpSync: {
      sourceConfigHash: 'stale',
      lastSyncedAt: '2020-01-01T00:00:00.000Z',
      cascadeDisabledMcps: ['cascade-mcp'],
    },
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('syncMcpDrift', () => {
  it('use-global: adds global-new, removes orphan, updates mismatch and clears override', async () => {
    const catCafe = makeTempRoot('global');
    const project = makeTempRoot('proj');
    writeCapabilitiesDir(catCafe, globalConfig());
    writeCapabilitiesDir(project, projectConfig());

    const drift = await checkMcpProject(project, catCafe);
    expect(drift.summary).toEqual({ new: 1, orphan: 1, mismatch: 1 });

    const report = await syncMcpDrift(project, catCafe, drift, undefined, 'use-global');
    expect(report.added).toEqual(['global-only']);
    expect(report.removed).toEqual(['orphan']);
    expect(report.updated).toEqual(['common']);
    expect(report.skipped).toEqual([]);
    expect(report.syncedHash).toMatch(/^[0-9a-f]{16}$/);

    // 复检应无 drift
    const recheck = await checkMcpProject(project, catCafe);
    expect(recheck.issues).toEqual([]);

    // mcpSync 已回写并保留 cascadeDisabledMcps
    const { readFileSync } = await import('node:fs');
    const persisted = JSON.parse(readFileSync(join(project, '.cat-cafe', 'capabilities.json'), 'utf-8')) as CapabilitiesConfig;
    expect(persisted.mcpSync?.sourceConfigHash).toBe(report.syncedHash);
    expect(persisted.mcpSync?.cascadeDisabledMcps).toEqual(['cascade-mcp']);
  });

  it('keep-project: skips the config-mismatch and retains the override', async () => {
    const catCafe = makeTempRoot('global-keep');
    const project = makeTempRoot('proj-keep');
    writeCapabilitiesDir(catCafe, globalConfig());
    writeCapabilitiesDir(project, projectConfig());

    const drift = await checkMcpProject(project, catCafe);
    const report = await syncMcpDrift(project, catCafe, drift, [{ mcpId: 'common', decision: 'keep-project' }]);

    // global-new / orphan 仍被修复；common 被跳过后保留 override
    expect(report.added).toEqual(['global-only']);
    expect(report.removed).toEqual(['orphan']);
    expect(report.updated).toEqual([]);
    expect(report.skipped).toEqual(['common']);

    const { readFileSync } = await import('node:fs');
    const persisted = JSON.parse(readFileSync(join(project, '.cat-cafe', 'capabilities.json'), 'utf-8')) as CapabilitiesConfig;
    const common = persisted.capabilities.find((cap) => cap.id === 'common');
    expect(common?.mcpServerOverride).toBeDefined();

    // 只剩 common 一处 mismatch
    const recheck = await checkMcpProject(project, catCafe);
    expect(recheck.summary).toEqual({ new: 0, orphan: 0, mismatch: 1 });
  });

  it('creates a project config on demand when none exists', async () => {
    const catCafe = makeTempRoot('global-newproj');
    const project = makeTempRoot('newproj');
    writeCapabilitiesDir(catCafe, globalConfig());
    mkdirSync(join(project, '.cat-cafe'), { recursive: true });

    const drift = await checkMcpProject(project, catCafe);
    const report = await syncMcpDrift(project, catCafe, drift);
    expect(report.added).toEqual(['global-only', 'common']);
    expect(report.removed).toEqual([]);
    expect(report.updated).toEqual([]);
  });
});