/**
 * F070: Governance Registry — dispatch audit trail
 *
 * Tracks which external projects have been bootstrapped,
 * their governance pack versions, and sync timestamps.
 * Stored at `.cat-cafe/governance-registry.json` in the hub root.
 *
 * 移植自 clowder-ai `config/governance/governance-registry.ts`。
 * 改造：pathsEqual 工具内联（原 utils/project-path.ts）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { GovernanceHealthSummary, GovernancePackMeta } from '@flowforge/cats-shared';
import { GOVERNANCE_PACK_VERSION } from './governance-pack.ts';

const REGISTRY_DIR = '.cat-cafe';
const REGISTRY_FILENAME = 'governance-registry.json';

export interface GovernanceRegistryEntry extends GovernancePackMeta {
  /** Absolute path to the external project */
  projectPath: string;
}

interface RegistryData {
  entries: GovernanceRegistryEntry[];
}

/** Win32 大小写不敏感路径比较（原 utils/project-path.ts pathsEqual）。 */
export function pathsEqual(a: string, b: string, platformName = process.platform): boolean {
  if (platformName !== 'win32') return a === b;
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

function safePath(root: string, ...segments: string[]): string {
  const rootResolved = resolve(root);
  const normalized = resolve(rootResolved, ...segments);
  const rel = relative(rootResolved, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

export class GovernanceRegistry {
  constructor(private readonly hubRoot: string) {}

  private get filePath(): string {
    return safePath(this.hubRoot, REGISTRY_DIR, REGISTRY_FILENAME);
  }

  async read(): Promise<RegistryData> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as RegistryData;
      if (!Array.isArray(data.entries)) return { entries: [] };
      return data;
    } catch {
      return { entries: [] };
    }
  }

  private async write(data: RegistryData): Promise<void> {
    const dir = safePath(this.hubRoot, REGISTRY_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }

  async register(projectPath: string, meta: GovernancePackMeta): Promise<void> {
    const data = await this.read();
    const existing = data.entries.findIndex((e) => pathsEqual(e.projectPath, projectPath));
    const entry: GovernanceRegistryEntry = { ...meta, projectPath };
    if (existing >= 0) {
      data.entries[existing] = entry;
    } else {
      data.entries.push(entry);
    }
    await this.write(data);
  }

  async get(projectPath: string): Promise<GovernanceRegistryEntry | undefined> {
    const data = await this.read();
    return data.entries.find((e) => pathsEqual(e.projectPath, projectPath));
  }

  async listAll(): Promise<readonly GovernanceRegistryEntry[]> {
    const data = await this.read();
    return data.entries;
  }

  async checkHealth(projectPath: string, currentVersion?: string): Promise<GovernanceHealthSummary> {
    const version = currentVersion ?? GOVERNANCE_PACK_VERSION;
    const entry = await this.get(projectPath);
    if (!entry) {
      return {
        projectPath,
        status: 'never-synced',
        packVersion: null,
        lastSyncedAt: null,
        findings: [],
      };
    }
    const status = entry.packVersion === version ? 'healthy' : 'stale';
    return {
      projectPath,
      status,
      packVersion: entry.packVersion,
      lastSyncedAt: entry.syncedAt,
      findings: [],
    };
  }
}
