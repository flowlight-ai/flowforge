/**
 * mcp-drift-detector 测试 — B11 补建（clowder-ai `mcp-drift-detector.ts` TS 重写）。
 *
 * 覆盖：canonicalJson 确定性序列化、computeGlobalMcpHash、extractMcpEntries、
 * checkMcpProject（global-new / project-orphan / config-mismatch 三类 issue +
 * 带 override 标记 + external 豁免）、checkMcpGlobal（注入式项目枚举聚合）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CapabilitiesConfig, CapabilityEntry } from '@flowforge/cats-shared';

import {
  canonicalJson,
  computeGlobalMcpHash,
  extractMcpEntries,
  checkMcpProject,
  checkMcpGlobal,
  type McpDriftDetectorDeps,
} from '../src/mcp-drift-detector.ts';

let tempDirs: string[] = [];
let globalRoot = '';
let projectRoot = '';

function tmpdirs(...paths: string[]) {
  for (const p of paths) tempDirs.push(p);
}

function writeConfig(root: string, config: CapabilitiesConfig) {
  const dir = join(root, '.cat-cafe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'capabilities.json'), JSON.stringify(config));
}

function makeConfig(capabilities: CapabilityEntry[]): CapabilitiesConfig {
  return { version: 2, capabilities };
}

beforeEach(() => {
  globalRoot = mkdtempSync(join(tmpdir(), 'ff-drift-global-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'ff-drift-project-'));
  tmpdirs(globalRoot, projectRoot);
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

// ── canonicalJson / hash / extract ──────────────────────────────────────────

describe('canonicalJson / computeGlobalMcpHash / extractMcpEntries', () => {
  it('canonicalJson sorts object keys recursively for deterministic output', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('computeGlobalMcpHash is stable regardless of entry order', () => {
    const a = makeConfig([
      { id: 'x', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'x', args: [] } },
      { id: 'y', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'y', args: [] } },
    ]);
    const reverse = makeConfig([
      { id: 'y', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'y', args: [] } },
      { id: 'x', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'x', args: [] } },
    ]);
    expect(computeGlobalMcpHash(extractMcpEntries(a))).toBe(computeGlobalMcpHash(extractMcpEntries(reverse)));
  });

  it('extractMcpEntries filters to mcp type only', () => {
    const config = makeConfig([
      { id: 'python', type: 'mcp', enabled: true, source: 'cat-cafe' },
      { id: 'tdd', type: 'skill', enabled: true, source: 'cat-cafe' },
    ]);
    expect(extractMcpEntries(config).map((e) => e.id)).toEqual(['python']);
  });
});

// ── checkMcpProject ──────────────────────────────────────────────────────────

describe('checkMcpProject', () => {
  it('detects global-new / project-orphan / config-mismatch in one pass', async () => {
    writeConfig(globalRoot, makeConfig([
      { id: 'new-mcp', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'new', args: [] } },
      { id: 'common', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'v2', args: [] } },
    ]));
    writeConfig(projectRoot, makeConfig([
      { id: 'common', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'v1', args: [] } },
      { id: 'orphan', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'x', args: [] } },
    ]));

    const result = await checkMcpProject(projectRoot, globalRoot);
    const byId = (type: string) => result.issues.filter((i) => i.type === type).map((i) => i.mcpId);

    expect(byId('global-new')).toEqual(['new-mcp']);
    expect(byId('project-orphan')).toEqual(['orphan']);
    expect(byId('config-mismatch')).toEqual(['common']);
    expect(result.summary).toEqual({ new: 1, orphan: 1, mismatch: 1 });
  });

  it('flags config-mismatch with hasOverride when project has override', async () => {
    writeConfig(globalRoot, makeConfig([
      { id: 'm', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'v2', args: [] } },
    ]));
    writeConfig(projectRoot, makeConfig([
      { id: 'm', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'v2', args: [] }, mcpServerOverride: { command: 'local', args: [] } },
    ]));

    // 同一 mcp/hash，但 override 使项目快照不同源 → 报 mismatch 且带上 override 标记
    const result = await checkMcpProject(projectRoot, globalRoot);
    const mismatch = result.issues.find((i) => i.type === 'config-mismatch');
    expect(mismatch?.mcpId).toBe('m');
    expect(mismatch?.hasOverride).toBe(true);
  });

  it('exempts external-source orphans from project-orphan', async () => {
    writeConfig(globalRoot, makeConfig([]));
    writeConfig(projectRoot, makeConfig([
      { id: 'user-mcp', type: 'mcp', enabled: true, source: 'external', mcpServer: { command: 'user', args: [] } },
    ]));

    const result = await checkMcpProject(projectRoot, globalRoot);
    expect(result.issues).toEqual([]);
    expect(result.summary.orphan).toBe(0);
  });
});

// ── checkMcpGlobal ───────────────────────────────────────────────────────────

describe('checkMcpGlobal', () => {
  it('aggregates drift across injected project paths', async () => {
    const p2 = mkdtempSync(join(tmpdir(), 'ff-drift-p2-'));
    tmpdirs(p2);

    writeConfig(globalRoot, makeConfig([
      { id: 'g', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'v1', args: [] } },
    ]));
    writeConfig(projectRoot, makeConfig([]));
    writeConfig(p2, makeConfig([
      { id: 'g', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'stale', args: [] } },
      { id: 'orphan2', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'x', args: [] } },
    ]));

    const deps: McpDriftDetectorDeps = { listProjectPaths: async () => [projectRoot, p2] };
    const result = await checkMcpGlobal(globalRoot, deps);

    expect(result.perProject).toHaveLength(2);
    expect(result.totalSummary).toMatchObject({ new: 1, orphan: 1, mismatch: 1, projectsWithDrift: 2 });
  });

  it('defaults to scanning only the hub root when no port injected', async () => {
    writeConfig(globalRoot, makeConfig([
      { id: 'in-project', type: 'mcp', enabled: true, source: 'cat-cafe', mcpServer: { command: 'x', args: [] } },
    ]));
    const result = await checkMcpGlobal(globalRoot);
    expect(result.perProject).toHaveLength(0); // global == hub → 无 drift
  });
});