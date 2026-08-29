/**
 * F070: Governance Bootstrap Service
 *
 * Core engine that writes governance pack to external projects.
 * Handles managed blocks, skills symlinks, methodology skeleton,
 * and bootstrap reporting.
 *
 * 移植自 clowder-ai `config/governance/governance-bootstrap.ts`。
 * 插件化改造：
 *   - capabilities.json 读写来自 `@flowforge/forgekin-capabilities`
 *   - readMountRules（原 mount-rules-store）→ 注入式 MountRulesReader
 *     （缺省 = 项目 capabilities.json#defaultMountRules → DEFAULT_MOUNT_RULES）
 *   - MCP drift seed 同步（原 mcp-drift-detector/resolver）→ 可选注入钩子
 *   - skillsSync 状态 / mountPaths 更新内联实现
 */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, readlink, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type {
  BootstrapAction,
  BootstrapReport,
  CapabilitiesConfig,
  MountRuleEntry,
  MountRules,
  SkillsSyncState,
  StandardMountPointId,
} from '@flowforge/cats-shared';
import { DEFAULT_MOUNT_RULES, STANDARD_MOUNT_POINT_IDS } from '@flowforge/cats-shared';
import {
  readCapabilitiesConfig as defaultReadCapabilitiesConfig,
  writeCapabilitiesConfig as defaultWriteCapabilitiesConfig,
} from '@flowforge/forgekin-capabilities';
import type { Provider } from './governance-pack.ts';
import {
  computePackChecksum,
  GOVERNANCE_PACK_VERSION,
  getGovernanceManagedBlock,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
} from './governance-pack.ts';
import { GovernanceRegistry, pathsEqual } from './governance-registry.ts';
import { getMethodologyTemplates } from './methodology-templates.ts';

const IS_WIN32 = process.platform === 'win32';

/** Provider instruction file mapping */
const PROVIDER_FILES: Record<Provider, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
  kimi: 'KIMI.md',
};

/** Provider skills directory mapping */
const PROVIDER_SKILLS_DIRS: Record<Provider, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  gemini: '.gemini/skills',
  kimi: '.kimi/skills',
};

/** Provider hooks directory mapping (F070 Phase 2) */
const PROVIDER_HOOKS_DIRS: Record<Provider, string> = {
  claude: '.claude/hooks',
  codex: '.codex/hooks',
  gemini: '.gemini/hooks',
  kimi: '.kimi/hooks',
};

// ────────── 注入契约 ──────────

/**
 * 可注入依赖（替代 clowder-ai 模块级导入）：
 *   - readMountRules：原 `config/mount/mount-rules-store.ts`
 *   - syncMcpSeed：原 mcp-drift-detector/resolver 的 global-new seed 同步
 *   - skillsDirName：原硬编码 'cat-cafe-skills'
 */
export interface GovernanceBootstrapDeps {
  readCapabilitiesConfig?: (root: string) => Promise<CapabilitiesConfig | null>;
  writeCapabilitiesConfig?: (root: string, config: CapabilitiesConfig) => Promise<void>;
  readMountRules?: (projectRoot: string, hubRoot: string) => Promise<MountRules>;
  syncMcpSeed?: (targetProject: string, hubRoot: string, globalConfig: CapabilitiesConfig) => Promise<void>;
  skillsDirName?: string;
}

// ────────── mount 规则 / skillsSync 内联工具 ──────────

function enabledSkillMountTargets(targetProject: string, rules: MountRules): Array<{ id: string; dir: string }> {
  const standardTargets = STANDARD_MOUNT_POINT_IDS.flatMap((id) =>
    rules.mountPoints[id].enabled ? [{ id, dir: resolve(targetProject, rules.mountPoints[id].path) }] : [],
  );
  const customTargets = (rules.customPaths ?? []).map((cp) => ({
    id: cp.alias,
    dir: resolve(targetProject, cp.path),
  }));
  return [...standardTargets, ...customTargets];
}

function enabledSkillMountTargetIds(rules: MountRules): string[] {
  return [
    ...STANDARD_MOUNT_POINT_IDS.filter((id) => rules.mountPoints[id].enabled),
    ...(rules.customPaths ?? []).map((cp) => cp.alias),
  ];
}

/**
 * F228 v2 条目（capabilities.json#defaultMountRules）→ MountRules 视图。
 * 标准 mount point 覆盖对应 mountPoints 槽位；其余归入 customPaths。
 */
function mountRulesFromEntries(entries: readonly MountRuleEntry[]): MountRules {
  const mountPoints: MountRules['mountPoints'] = { ...DEFAULT_MOUNT_RULES.mountPoints };
  const customPaths: MountRules['customPaths'] = [];
  const standardIds = new Set<string>(STANDARD_MOUNT_POINT_IDS);
  for (const entry of entries) {
    if (standardIds.has(entry.name)) {
      mountPoints[entry.name as StandardMountPointId] = { enabled: entry.enabled, path: entry.path };
    } else {
      customPaths.push({ alias: entry.name, path: entry.path });
    }
  }
  return { version: 1, mountPoints, customPaths };
}

/** 缺省 mount 规则读取：项目 capabilities.json#defaultMountRules → DEFAULT_MOUNT_RULES。 */
async function defaultReadMountRules(
  projectRoot: string,
  _hubRoot: string,
  readConfig: (root: string) => Promise<CapabilitiesConfig | null>,
): Promise<MountRules> {
  const config = await readConfig(projectRoot);
  return config?.defaultMountRules ? mountRulesFromEntries(config.defaultMountRules) : DEFAULT_MOUNT_RULES;
}

/** skills 源目录清单哈希（原 utils/skill-source.ts computeSourceManifestHash）。 */
export async function computeSourceManifestHash(sourceRoot: string): Promise<string> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const skillNames: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const skillMd = join(sourceRoot, entry.name, 'SKILL.md');
      const s = await stat(skillMd);
      if (s.isFile()) skillNames.push(entry.name);
    } catch {
      // No SKILL.md — not a skill directory
    }
  }

  skillNames.sort();
  const digest = createHash('sha256')
    .update(skillNames.join('\n') + '\n')
    .digest('hex')
    .slice(0, 16);
  return `sha256:${digest}`;
}

/** 写 capabilities.json#skillsSync（原 skills/skill-sync-config.ts writeSkillsSyncState）。 */
async function writeSkillsSyncState(
  projectRoot: string,
  syncState: SkillsSyncState,
  readConfig: (root: string) => Promise<CapabilitiesConfig | null>,
  writeConfig: (root: string, config: CapabilitiesConfig) => Promise<void>,
): Promise<void> {
  let config = await readConfig(projectRoot);
  if (!config) config = { version: 2, capabilities: [] };
  if (config.version === 1) config.version = 2;
  config.skillsSync = syncState;
  await writeConfig(projectRoot, config);
}

/** 更新指定 skill 条目的 mountPaths（原 updateSkillMountPaths 简化：仅覆盖挂载清单）。 */
async function updateSkillMountPaths(
  projectRoot: string,
  skillNames: string[],
  mountPointIds: string[],
  readConfig: (root: string) => Promise<CapabilitiesConfig | null>,
  writeConfig: (root: string, config: CapabilitiesConfig) => Promise<void>,
): Promise<void> {
  if (skillNames.length === 0) return;
  let config = await readConfig(projectRoot);
  if (!config) config = { version: 2, capabilities: [] };
  if (config.version === 1) config.version = 2;

  let dirty = false;
  for (const skillName of skillNames) {
    const cap = config.capabilities.find(
      (c) => c.type === 'skill' && c.id === skillName && c.source === 'cat-cafe' && !c.skillsSource,
    );
    if (cap) {
      const current = Array.isArray(cap.mountPaths) ? cap.mountPaths : undefined;
      const same =
        current !== undefined &&
        current.length === mountPointIds.length &&
        current.every((id) => mountPointIds.includes(id));
      if (!same) {
        cap.mountPaths = [...mountPointIds];
        dirty = true;
      }
    } else {
      config.capabilities.push({
        id: skillName,
        type: 'skill',
        source: 'cat-cafe',
        enabled: true,
        mountPaths: [...mountPointIds],
      });
      dirty = true;
    }
  }

  if (dirty) await writeConfig(projectRoot, config);
}

// ────────── 全局禁用策略 ──────────

function findCatCafeSkillCapability(config: CapabilitiesConfig | null | undefined, skillName: string) {
  return config?.capabilities.find(
    (cap) => cap.type === 'skill' && cap.id === skillName && cap.source === 'cat-cafe' && !cap.skillsSource,
  );
}

function globalSkillMountPolicy(
  config: CapabilitiesConfig | null | undefined,
  skillName: string,
  rules: MountRules,
): Set<string> | null {
  const cap = findCatCafeSkillCapability(config, skillName);
  if (!cap) return null;
  if (Array.isArray(cap.mountPaths)) return new Set(cap.mountPaths);
  return (cap.globalEnabled ?? cap.enabled) ? new Set(enabledSkillMountTargetIds(rules)) : new Set();
}

async function readDisabledCatCafeSkillNames(
  projectRoot: string,
  readConfig: (root: string) => Promise<CapabilitiesConfig | null>,
): Promise<Set<string>> {
  const config = await readConfig(projectRoot);
  return new Set(
    config?.capabilities
      .filter(
        (cap) =>
          cap.type === 'skill' &&
          cap.source === 'cat-cafe' &&
          !cap.skillsSource &&
          (cap.globalEnabled ?? cap.enabled) === false,
      )
      .map((cap) => cap.id) ?? [],
  );
}

function ensureDisabledSkillPolicy(config: CapabilitiesConfig, skillName: string): boolean {
  const existing = config.capabilities.find(
    (cap) => cap.type === 'skill' && cap.id === skillName && cap.source === 'cat-cafe' && !cap.skillsSource,
  );
  if (!existing) {
    config.capabilities.push({
      id: skillName,
      type: 'skill',
      source: 'cat-cafe',
      enabled: false,
      globalEnabled: false,
      mountPaths: [],
    });
    return true;
  }

  const dirty =
    (existing.globalEnabled ?? existing.enabled) !== false ||
    !Array.isArray(existing.mountPaths) ||
    existing.mountPaths.length > 0;
  existing.source = 'cat-cafe';
  existing.enabled = false;
  existing.globalEnabled = false;
  existing.mountPaths = [];
  return dirty;
}

async function writeDisabledSkillPolicies(
  projectRoot: string,
  skillNames: readonly string[],
  readConfig: (root: string) => Promise<CapabilitiesConfig | null>,
  writeConfig: (root: string, config: CapabilitiesConfig) => Promise<void>,
): Promise<void> {
  if (skillNames.length === 0) return;
  let config: CapabilitiesConfig | null = await readConfig(projectRoot);
  if (!config) config = { version: 2, capabilities: [] };
  if (config.version === 1) config.version = 2;

  let dirty = false;
  for (const skillName of skillNames) {
    dirty = ensureDisabledSkillPolicy(config, skillName) || dirty;
  }

  if (dirty) await writeConfig(projectRoot, config);
}

// ────────── Service ──────────

export interface BootstrapOptions {
  dryRun: boolean;
}

export class GovernanceBootstrapService {
  private readonly registry: GovernanceRegistry;
  private readonly readConfig: (root: string) => Promise<CapabilitiesConfig | null>;
  private readonly writeConfig: (root: string, config: CapabilitiesConfig) => Promise<void>;
  private readonly deps: GovernanceBootstrapDeps;
  private readonly skillsDirName: string;

  constructor(private readonly hubRoot: string, deps: GovernanceBootstrapDeps = {}) {
    this.registry = new GovernanceRegistry(hubRoot);
    this.deps = deps;
    this.readConfig = deps.readCapabilitiesConfig ?? defaultReadCapabilitiesConfig;
    this.writeConfig = deps.writeCapabilitiesConfig ?? defaultWriteCapabilitiesConfig;
    this.skillsDirName = deps.skillsDirName ?? 'cat-cafe-skills';
  }

  getRegistry(): GovernanceRegistry {
    return this.registry;
  }

  private readMountRules(projectRoot: string): Promise<MountRules> {
    return this.deps.readMountRules
      ? this.deps.readMountRules(projectRoot, this.hubRoot)
      : defaultReadMountRules(projectRoot, this.hubRoot, this.readConfig);
  }

  async bootstrap(targetProject: string, opts: BootstrapOptions): Promise<BootstrapReport> {
    const actions: BootstrapAction[] = [];
    const packVersion = GOVERNANCE_PACK_VERSION;
    const checksum = computePackChecksum('external');

    // 1. Managed blocks in provider instruction files
    for (const [provider, filename] of Object.entries(PROVIDER_FILES) as [Provider, string][]) {
      const action = await this.writeManagedBlock(targetProject, provider, filename, opts.dryRun);
      actions.push(action);
    }

    // 2. Per-skill symlinks for effective mount targets (ADR-025 + F228)
    const discoveredSkillNames = await this.discoverSkillNames();
    const globallyDisabledSkillNames = await readDisabledCatCafeSkillNames(this.hubRoot, this.readConfig);
    const skillNames = discoveredSkillNames.filter((name) => !globallyDisabledSkillNames.has(name));
    const disabledSkillNames = discoveredSkillNames.filter((name) => globallyDisabledSkillNames.has(name));
    const globalConfig = await this.readConfig(this.hubRoot);
    const globalMountRules = await this.readMountRules(this.hubRoot);
    const mountRules = await this.readMountRules(targetProject);
    const skillMountTargets = enabledSkillMountTargets(targetProject, mountRules);
    const targetIdsBySkill = new Map<string, string[]>();
    const mountTargetIds = skillMountTargets.map((target) => target.id);
    for (const skillName of skillNames) {
      const policy = globalSkillMountPolicy(globalConfig, skillName, globalMountRules);
      targetIdsBySkill.set(
        skillName,
        policy ? mountTargetIds.filter((targetId) => policy.has(targetId)) : mountTargetIds,
      );
    }
    for (const target of skillMountTargets) {
      const displayDir = relative(targetProject, target.dir);
      const skillNamesForTarget = skillNames.filter((skillName) =>
        targetIdsBySkill.get(skillName)?.includes(target.id),
      );
      const skillActions = await this.symlinkSkillsPerSkill(target.dir, displayDir, skillNamesForTarget, opts.dryRun);
      actions.push(...skillActions);
    }

    // 2a. Write capabilities.json#skillsSync (v2, ADR-025 Phase 1)
    if (!opts.dryRun && discoveredSkillNames.length > 0) {
      const sourceRoot = resolve(this.hubRoot, this.skillsDirName);
      const hash = await computeSourceManifestHash(sourceRoot);
      const sourceRootRelative = relative(targetProject, sourceRoot);
      const lastSyncedAt = new Date().toISOString();
      await writeSkillsSyncState(targetProject, { sourceRoot: sourceRootRelative, sourceManifestHash: hash, lastSyncedAt }, this.readConfig, this.writeConfig);
      for (const skillName of skillNames) {
        await updateSkillMountPaths(
          targetProject,
          [skillName],
          targetIdsBySkill.get(skillName) ?? [],
          this.readConfig,
          this.writeConfig,
        );
      }
      await writeDisabledSkillPolicies(targetProject, disabledSkillNames, this.readConfig, this.writeConfig);
    }

    // 2b. MCP entries from global config (#1049 Step 2) — 可选注入钩子。
    // New projects start with skill-only capabilities; seed MCP entries
    // from the root config so MCP management works from first use.
    if (!opts.dryRun && globalConfig && this.deps.syncMcpSeed) {
      try {
        await this.deps.syncMcpSeed(targetProject, this.hubRoot, globalConfig);
      } catch {
        /* MCP sync failure should not block bootstrap */
      }
    }

    // 2c. Hooks symlinks for providers that have source hooks
    for (const [provider, hooksDir] of Object.entries(PROVIDER_HOOKS_DIRS) as [Provider, string][]) {
      const action = await this.symlinkHooks(targetProject, provider, hooksDir, opts.dryRun);
      if (action) actions.push(action);
    }

    // 3. Methodology skeleton (only create missing files)
    const templates = getMethodologyTemplates();
    for (const template of templates) {
      const action = await this.writeTemplate(targetProject, template.relativePath, template.content, opts.dryRun);
      actions.push(action);
    }

    // 4. Save bootstrap report
    const report: BootstrapReport = {
      projectPath: targetProject,
      timestamp: Date.now(),
      packVersion,
      actions,
      dryRun: opts.dryRun,
    };

    if (!opts.dryRun) {
      await this.saveReport(targetProject, report);
      await this.registry.register(targetProject, {
        packVersion,
        checksum,
        syncedAt: Date.now(),
        confirmedByUser: true,
      });
    }

    return report;
  }

  private async writeManagedBlock(
    targetProject: string,
    provider: Provider,
    filename: string,
    dryRun: boolean,
  ): Promise<BootstrapAction> {
    const filePath = resolve(targetProject, filename);
    const block = getGovernanceManagedBlock(provider, 'external');
    let existingContent = '';

    try {
      existingContent = await readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist — will create
    }

    // Check if managed block already exists
    const startIdx = existingContent.indexOf(MANAGED_BLOCK_START);
    const endIdx = existingContent.indexOf(MANAGED_BLOCK_END);

    if (startIdx >= 0 && endIdx >= 0) {
      // Replace existing managed block
      const before = existingContent.slice(0, startIdx);
      const after = existingContent.slice(endIdx + MANAGED_BLOCK_END.length);
      const newContent = before + block + after;

      if (newContent === existingContent) {
        return { file: filename, action: 'skipped', reason: 'managed block already up to date' };
      }

      if (!dryRun) {
        await writeFile(filePath, newContent, 'utf-8');
      }
      return { file: filename, action: 'updated', reason: 'managed block replaced with new version' };
    }

    // Append managed block to existing file, or create new file
    const newContent = existingContent ? `${existingContent}\n\n${block}\n` : `${block}\n`;

    if (!dryRun) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, newContent, 'utf-8');
    }

    return {
      file: filename,
      action: existingContent ? 'updated' : 'created',
      reason: existingContent ? 'managed block appended to existing file' : 'file created with managed block',
    };
  }

  /** Scan skills source dir for subdirs containing SKILL.md. */
  private async discoverSkillNames(): Promise<string[]> {
    const sourceRoot = resolve(this.hubRoot, this.skillsDirName);
    try {
      const entries = await readdir(sourceRoot, { withFileTypes: true });
      const names: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const s = await stat(join(sourceRoot, entry.name, 'SKILL.md'));
          if (s.isFile()) names.push(entry.name);
        } catch {
          /* no SKILL.md — not a skill */
        }
      }
      return names.sort();
    } catch {
      return [];
    }
  }

  /** ADR-025: Create per-skill symlinks instead of directory-level. */
  private async symlinkSkillsPerSkill(
    targetDir: string,
    displayDir: string,
    skillNames: string[],
    dryRun: boolean,
  ): Promise<BootstrapAction[]> {
    const sourceRoot = resolve(this.hubRoot, this.skillsDirName);
    const actions: BootstrapAction[] = [];

    if (!dryRun) {
      // Guard: reject symlinked target dirs to prevent writing outside project
      try {
        const dirStat = await lstat(targetDir);
        if (dirStat.isSymbolicLink()) {
          return [{ file: displayDir, action: 'skipped', reason: 'target directory is a symlink' }];
        }
        if (!dirStat.isDirectory()) {
          return [{ file: displayDir, action: 'skipped', reason: 'target path exists but is not a directory' }];
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          return [
            { file: displayDir, action: 'skipped', reason: `target path check failed: ${(err as Error).message}` },
          ];
        }
      }
      await mkdir(targetDir, { recursive: true });
    }

    for (const name of skillNames) {
      const linkPath = join(targetDir, name);
      const sourceSkill = join(sourceRoot, name);

      try {
        const s = await lstat(linkPath);
        if (s.isSymbolicLink()) {
          const current = await readlink(linkPath);
          const resolved = resolve(dirname(linkPath), current);
          if (pathsEqual(resolved, sourceSkill)) {
            actions.push({ file: `${displayDir}/${name}`, action: 'skipped', reason: 'symlink already correct' });
            continue;
          }
          // Wrong target — remove and recreate
          if (!dryRun) {
            await unlink(linkPath);
          }
        } else {
          // Exists but not a symlink — skip to avoid damage
          actions.push({
            file: `${displayDir}/${name}`,
            action: 'skipped',
            reason: 'path exists but is not a symlink',
          });
          continue;
        }
      } catch {
        /* doesn't exist — create */
      }

      if (!dryRun) {
        const relPath = IS_WIN32 ? sourceSkill : relative(dirname(linkPath), sourceSkill);
        await symlink(relPath, linkPath, IS_WIN32 ? 'junction' : undefined);
      }
      actions.push({ file: `${displayDir}/${name}`, action: 'symlinked', reason: `linked to ${sourceSkill}` });
    }

    return actions;
  }

  private async symlinkHooks(
    targetProject: string,
    _provider: Provider,
    hooksDir: string,
    dryRun: boolean,
  ): Promise<BootstrapAction | null> {
    // Source hooks dir must exist in hubRoot
    const sourceHooksPath = resolve(this.hubRoot, hooksDir);
    try {
      const statResult = await lstat(sourceHooksPath);
      if (!statResult.isDirectory() && !statResult.isSymbolicLink()) return null;
    } catch {
      // Source hooks dir doesn't exist — silently skip
      return null;
    }

    const targetPath = resolve(targetProject, hooksDir);

    // Check if symlink already exists and points to the right place
    try {
      const statResult = await lstat(targetPath);
      if (statResult.isSymbolicLink()) {
        const currentTarget = await readlink(targetPath);
        const resolvedCurrent = resolve(dirname(targetPath), currentTarget);
        if (pathsEqual(resolvedCurrent, sourceHooksPath)) {
          return { file: hooksDir, action: 'skipped', reason: 'hooks symlink already correct' };
        }
      }
      return { file: hooksDir, action: 'skipped', reason: 'hooks path exists but is not a symlink to hub hooks' };
    } catch {
      // Doesn't exist — create
    }

    if (!dryRun) {
      await mkdir(dirname(targetPath), { recursive: true });
      if (IS_WIN32) {
        await symlink(sourceHooksPath, targetPath, 'junction');
      } else {
        const relPath = relative(dirname(targetPath), sourceHooksPath);
        await symlink(relPath, targetPath);
      }
    }

    return { file: hooksDir, action: 'symlinked', reason: `hooks linked to ${sourceHooksPath}` };
  }

  private async writeTemplate(
    targetProject: string,
    relativePath: string,
    content: string,
    dryRun: boolean,
  ): Promise<BootstrapAction> {
    const filePath = resolve(targetProject, relativePath);

    // Check path doesn't escape target project
    const rel = relative(targetProject, filePath);
    if (rel.startsWith(`..${sep}`) || rel === '..') {
      return { file: relativePath, action: 'skipped', reason: 'path escapes project root' };
    }

    // Never overwrite existing files
    try {
      await lstat(filePath);
      return { file: relativePath, action: 'skipped', reason: 'file already exists' };
    } catch {
      // Doesn't exist — create
    }

    if (!dryRun) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }

    return { file: relativePath, action: 'created', reason: 'template generated' };
  }

  private async saveReport(targetProject: string, report: BootstrapReport): Promise<void> {
    const dir = resolve(targetProject, '.cat-cafe');
    await mkdir(dir, { recursive: true });
    const filePath = resolve(dir, 'governance-bootstrap-report.json');
    await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  }
}

// 防止 PROVIDER_SKILLS_DIRS 未使用告警（保留原映射作公共常量）。
export { PROVIDER_SKILLS_DIRS };
