/**
 * Skill Meta — reads description/triggers/category from SKILL.md frontmatter
 * and cat-cafe-skills/manifest.yaml, plus resolves MCP dependency statuses.
 *
 * TS 重写自 clowder-ai `api/src/skills/skill-meta.ts`（B8 缺口补建）。
 * 单点来源：skill-query 与会话技能看板的元数据读取。
 *
 * 插件化改造决策（相对 clowder-ai）：
 *   - capabilities.json 读取 → `@flowforge/forgekin-capabilities` `readCapabilitiesConfig`
 *   - MCP 依赖状态解析 → `@flowforge/forgekin-capabilities` `resolveRequiredMcpStatus`
 *   - manifest/SKILL.md 解析保持自包含（无跨域导入）
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  readCapabilitiesConfig,
  resolveRequiredMcpStatus,
  type RequiredMcpStatus,
} from '@flowforge/forgekin-capabilities';

export interface SkillMeta {
  category?: string;
  description?: string;
  triggers?: string[];
  requiresMcp?: string[];
}

export interface SkillMcpDependency {
  id: string;
  status: 'ready' | 'missing' | 'unresolved';
}

/**
 * Extract description + triggers from a SKILL.md frontmatter.
 * Triggers may be embedded in descriptions:
 *   'Triggers on "X", "Y", "Z"' / '触发词："X"、"Y"'
 */
export async function readSkillMeta(skillDir: string): Promise<SkillMeta> {
  const skillMdPath = join(skillDir, 'SKILL.md');
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = parseYaml(match[1]!) as { description?: unknown; triggers?: unknown } | null;
    const desc = typeof fm?.description === 'string' ? fm.description.trim() : '';
    if (!desc) return {};

    const triggers: string[] = Array.isArray(fm?.triggers)
      ? fm.triggers
          .filter((v): v is string => typeof v === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // Backward compatibility: extract triggers from description text for legacy skills.
    if (triggers.length === 0) {
      const enMatch = desc.match(/[Tt]riggers?\s+on\s+"([^"]+)"(,\s*"([^"]+)")*/);
      if (enMatch) {
        const allQuoted = desc.match(/[Tt]riggers?\s+on\s+(.*)/);
        const quotedSection = allQuoted?.[1];
        if (quotedSection) {
          for (const m of quotedSection.matchAll(/"([^"]+)"/g)) {
            triggers.push(m[1]!);
          }
        }
      }
      const cnMatch = desc.match(/触发词[：:]\s*(.*)/);
      if (cnMatch) {
        const raw = cnMatch[1]!;
        for (const m of raw.matchAll(/["“]([^"”]+)["”]/g)) {
          triggers.push(m[1]!);
        }
        if (triggers.length === 0) {
          triggers.push(
            ...raw
              .split(/[、,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }
      }
    }

    // Clean description: strip trigger suffix for display
    let cleanDesc = desc
      .replace(/\s*[Tt]riggers?\s+on\s+.*$/, '')
      .replace(/\s*触发词[：:].*$/, '')
      .replace(/\.\s*$/, '')
      .trim();
    if (!cleanDesc) cleanDesc = desc;

    const result: SkillMeta = { description: cleanDesc };
    if (triggers.length > 0) result.triggers = triggers;
    return result;
  } catch {
    return {};
  }
}

/**
 * Parse manifest.yaml and extract skill category/description/triggers.
 * F042: manifest is the routing source-of-truth.
 * F228: category moved from BOOTSTRAP.md to manifest.yaml.
 */
export async function parseManifestSkillMeta(skillsSrcDir: string): Promise<Map<string, SkillMeta>> {
  const result = new Map<string, SkillMeta>();
  const manifestPath = join(skillsSrcDir, 'manifest.yaml');
  try {
    const content = await readFile(manifestPath, 'utf-8');
    const parsed = parseYaml(content) as {
      skills?: Record<
        string,
        { category?: unknown; description?: unknown; triggers?: unknown; requires_mcp?: unknown }
      >;
    } | null;
    if (!parsed?.skills || typeof parsed.skills !== 'object') return result;
    for (const [name, meta] of Object.entries(parsed.skills)) {
      const category = typeof meta?.category === 'string' ? meta.category.trim() : undefined;
      const description = typeof meta?.description === 'string' ? meta.description.trim() : undefined;
      const triggers = Array.isArray(meta?.triggers)
        ? meta.triggers
            .filter((v): v is string => typeof v === 'string')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const requiresMcp = Array.isArray(meta?.requires_mcp)
        ? meta.requires_mcp
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined;
      const hasData =
        Boolean(category) ||
        Boolean(description) ||
        (triggers !== undefined && triggers.length > 0) ||
        (requiresMcp !== undefined && requiresMcp.length > 0);
      if (hasData) {
        result.set(name, {
          ...(category !== undefined ? { category } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(triggers !== undefined && triggers.length > 0 ? { triggers } : {}),
          ...(requiresMcp !== undefined && requiresMcp.length > 0 ? { requiresMcp } : {}),
        });
      }
    }
  } catch {
    // manifest missing or invalid — fallback to SKILL.md metadata
  }
  return result;
}

/** 把 capabilities 域解析结果归一化为 SkillMcpDependency。 */
function toSkillMcpDependency(result: RequiredMcpStatus): SkillMcpDependency {
  return { id: result.id, status: result.status };
}

/**
 * Resolve MCP dependency statuses for all skills that declare requires_mcp.
 */
export async function resolveSkillMcpStatuses(
  projectRoot: string,
  manifestMeta: Map<string, SkillMeta>,
): Promise<Map<string, SkillMcpDependency>> {
  const capabilities = await readCapabilitiesConfig(projectRoot);
  const requiredIds = new Set<string>();
  for (const meta of manifestMeta.values()) {
    for (const id of meta.requiresMcp ?? []) requiredIds.add(id);
  }

  const statuses = new Map<string, SkillMcpDependency>();
  for (const id of requiredIds) {
    const resolved = await resolveRequiredMcpStatus(id, { capabilities, env: process.env });
    statuses.set(id, toSkillMcpDependency(resolved));
  }

  return statuses;
}