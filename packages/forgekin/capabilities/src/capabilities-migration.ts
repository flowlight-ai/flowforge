/**
 * F228 Task 0B: capabilities.json v1 → v2 自动迁移。
 *
 * 移植自 clowder-ai `config/governance/capabilities-migration.ts`。
 * 迁移内容：
 *   - version: 1 → 2
 *   - 从文件系统 symlink 探测回填每个 skill 的 mountPaths
 *
 * 懒迁移设计：读到 v1 配置时调用，然后写回 v2。幂等：v2 直接透传。
 * 改造：skillsSource 改为可选参数（clowder-ai 通过
 * resolveCatCafeSkillsSource 自动探测；flowforge 由调用方注入）。
 */

import { lstat, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CapabilitiesConfig, MountRuleEntry } from '@flowforge/cats-shared';
import { DEFAULT_MOUNT_RULES, STANDARD_MOUNT_POINT_IDS } from '@flowforge/cats-shared';

/**
 * 检查路径是否为指向 source 中特定 skill 的有效符号链接。
 * F228：校验精确的 skill 目标，而非 skillsSource 下的任意路径 —
 * 防止 `.claude/skills/foo -> cat-cafe-skills/bar` 被 `foo` 接受。
 */
async function isValidSkillSymlink(linkPath: string, skillsSource: string, skillName: string): Promise<boolean> {
  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) return false;
    const target = await readlink(linkPath);
    const resolved = isAbsolute(target) ? target : resolve(dirname(linkPath), target);
    const normalizedResolved = resolve(resolved);
    const expectedTarget = resolve(join(skillsSource, skillName));
    return normalizedResolved === expectedTarget;
  } catch {
    return false;
  }
}

async function skillSourceExists(skillsSource: string, skillName: string): Promise<boolean> {
  try {
    const stat = await lstat(join(skillsSource, skillName));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function isValidDirectoryLevelSkillMount(
  providerSkillsDir: string,
  skillsSource: string,
  skillName: string,
): Promise<boolean> {
  try {
    const stat = await lstat(providerSkillsDir);
    if (!stat.isSymbolicLink()) return false;
    const target = await readlink(providerSkillsDir);
    const resolved = isAbsolute(target) ? target : resolve(dirname(providerSkillsDir), target);
    if (resolve(resolved) !== resolve(skillsSource)) return false;
    return skillSourceExists(skillsSource, skillName);
  } catch {
    return false;
  }
}

async function populateSkillMountPaths(
  projectRoot: string,
  config: CapabilitiesConfig,
  rules: MountRuleEntry[],
  skillsSource: string | undefined,
): Promise<void> {
  for (const cap of config.capabilities) {
    if (cap.type !== 'skill' || cap.source !== 'cat-cafe' || cap.pluginId || cap.mountPaths !== undefined) continue;
    // 禁用的 skill 得到空 mountPaths — 不回填陈旧符号链接（P2 数据不变式）
    if ((cap.globalEnabled ?? cap.enabled) === false) {
      cap.mountPaths = [];
      continue;
    }
    // 无 skillsSource 注入时跳过文件系统探测，只置空数组占位。
    if (!skillsSource) {
      cap.mountPaths = [];
      continue;
    }
    cap.mountPaths = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const providerSkillsDir = join(projectRoot, rule.path);
      if (await isValidDirectoryLevelSkillMount(providerSkillsDir, skillsSource, cap.id)) {
        cap.mountPaths.push(rule.name);
        continue;
      }
      const linkPath = join(projectRoot, rule.path, cap.id);
      if (await isValidSkillSymlink(linkPath, skillsSource, cap.id)) {
        cap.mountPaths.push(rule.name);
      }
    }
  }
}

/**
 * 将 capabilities.json 配置从 v1 迁移到 v2。
 *
 * @param projectRoot - 项目根目录
 * @param config - 当前配置（v1 或 v2）
 * @param skillsSource - skill 源目录路径（可选；缺省跳过 symlink 探测）
 * @returns 迁移后的 v2 配置（若已是 v2 则原样返回）
 */
export async function migrateCapabilitiesV1ToV2(
  projectRoot: string,
  config: CapabilitiesConfig,
  skillsSource?: string,
): Promise<CapabilitiesConfig> {
  if (config.version === 2) return config;

  const migrated: CapabilitiesConfig = { ...config, version: 2 };

  // 从文件系统符号链接回填 skill 条目的 mountPaths
  const rules = migrated.mountRules ?? getDefaultMountRuleEntries();
  await populateSkillMountPaths(projectRoot, migrated, rules, skillsSource);

  return migrated;
}

function getDefaultMountRuleEntries(): MountRuleEntry[] {
  return STANDARD_MOUNT_POINT_IDS.map((id) => ({
    name: id,
    path: DEFAULT_MOUNT_RULES.mountPoints[id].path,
    enabled: DEFAULT_MOUNT_RULES.mountPoints[id].enabled,
  }));
}
