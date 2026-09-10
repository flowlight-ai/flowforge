/**
 * Skill Query — read-only query functions for skill config + metadata.
 *
 * TS 重写自 clowder-ai `api/src/skills/skill-query.ts`（B8 缺口补建）。
 * 纯配置读取——不做文件系统变更。需要挂载状态的消费者应自行按挂载点
 * 调用 classifyMountPath / symlink 检查。
 *
 * 插件化改造决策（相对 clowder-ai）：
 *   - capabilities.json 读取 → `@flowforge/forgekin-capabilities` `readCapabilitiesConfig`
 *   - skills 源目录 → `skillsSource` 显式参数（不硬编码 cat-cafe 根）
 *   - enabled 判定采用 F228 语义（globalEnabled ?? enabled）
 */

import { join } from 'node:path';
import { readCapabilitiesConfig } from '@flowforge/forgekin-capabilities';

import { parseManifestSkillMeta, readSkillMeta } from './skill-meta.ts';

// ────────── Types ──────────

export interface SkillInfo {
  /** Capability entry ID (e.g. 'tdd' or 'plugin:foo:my-skill'). */
  id: string;
  enabled: boolean;
  pluginId?: string;
  mountPaths?: readonly string[];
}

export interface SkillDetail extends SkillInfo {
  description?: string;
  triggers?: string[];
  category?: string;
}

/** F228: cat-cafe 源技能（无 skillsSource/pluginId）的有效挂载状态。 */
function isEnabled(capEnabled: boolean | undefined, globalEnabled: boolean | undefined, mountPaths?: readonly string[]): boolean {
  const active = globalEnabled ?? capEnabled ?? false;
  if (!active) return false;
  return mountPaths === undefined || mountPaths.length === 0 ? true : mountPaths.length > 0;
}

// ────────── Public API ──────────

/**
 * List all cat-cafe managed skills configured for a project.
 * 纯配置读取——不检查文件系统。需要挂载状态的消费者应自行按挂载点判断。
 */
export async function listSkills(projectRoot: string): Promise<SkillInfo[]> {
  const config = await readCapabilitiesConfig(projectRoot);
  if (!config) return [];

  return config.capabilities
    .filter((c) => c.type === 'skill' && c.source === 'cat-cafe')
    .map((c) => ({
      id: c.id,
      enabled: isEnabled(c.enabled, c.globalEnabled, c.mountPaths),
      ...(c.pluginId ? { pluginId: c.pluginId } : {}),
      ...(Array.isArray(c.mountPaths) && c.mountPaths.length > 0 ? { mountPaths: c.mountPaths } : {}),
    }));
}

/**
 * Query detailed information about a single skill.
 * 结合配置状态（enabled/mountPaths）与 SKILL.md frontmatter / manifest.yaml 元数据。
 */
export async function querySkill(
  projectRoot: string,
  skillName: string,
  skillsSource: string,
): Promise<SkillDetail | null> {
  const skills = await listSkills(projectRoot);
  const info = skills.find((s) => s.id === skillName || s.id.endsWith(`:${skillName}`));

  const skillDir = join(skillsSource, skillName);
  const [skillMeta, manifestMeta] = await Promise.all([readSkillMeta(skillDir), parseManifestSkillMeta(skillsSource)]);
  const manifest = manifestMeta.get(skillName);

  // Skill not in config AND not in source → doesn't exist
  if (!info && !manifest && skillMeta.description === undefined) return null;

  const description = manifest?.description ?? skillMeta.description;
  const triggers = manifest?.triggers ?? skillMeta.triggers;
  const category = manifest?.category;

  return {
    id: info?.id ?? skillName,
    enabled: info?.enabled ?? false,
    ...(info?.pluginId ? { pluginId: info.pluginId } : {}),
    ...(info?.mountPaths ? { mountPaths: info.mountPaths } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(triggers !== undefined && triggers.length > 0 ? { triggers } : {}),
    ...(category !== undefined && category.length > 0 ? { category } : {}),
  };
}