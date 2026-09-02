/**
 * Manifest slashCommands discovery — F142 Phase B
 *
 * 解析 skills 源目录的 manifest.yaml，提取经 schema 校验的 slashCommands 声明。
 * 非法项静默跳过（zod error 可由调用方记录）。
 *
 * 移植自 clowder-ai `infrastructure/commands/manifest-commands.ts`。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  type ManifestSlashCommand,
  ManifestSlashCommandSchema,
} from '@flowforge/cats-shared';

interface ManifestSkillEntry {
  description?: unknown;
  triggers?: unknown;
  slashCommands?: unknown[];
}

/**
 * 解析 manifest.yaml，返回 Map<skillId, validatedCommands[]>。
 * manifest 缺失/不可读 → 返回空 Map。
 */
export async function parseManifestSlashCommands(
  skillsSrcDir: string,
): Promise<Map<string, ManifestSlashCommand[]>> {
  const result = new Map<string, ManifestSlashCommand[]>();
  const manifestPath = join(skillsSrcDir, 'manifest.yaml');
  try {
    const content = await readFile(manifestPath, 'utf-8');
    const parsed = parseYaml(content) as { skills?: Record<string, ManifestSkillEntry> } | null;
    if (!parsed?.skills || typeof parsed.skills !== 'object') return result;

    for (const [skillId, meta] of Object.entries(parsed.skills)) {
      if (!Array.isArray(meta?.slashCommands) || meta.slashCommands.length === 0) {
        continue;
      }
      const validCommands: ManifestSlashCommand[] = [];
      for (const raw of meta.slashCommands) {
        const parsedCmd = ManifestSlashCommandSchema.safeParse(raw);
        if (parsedCmd.success) {
          validCommands.push(parsedCmd.data);
        }
        // 非法项静默跳过（zod error 可由调用方记录）
      }
      if (validCommands.length > 0) {
        result.set(skillId, validCommands);
      }
    }
  } catch {
    // manifest 缺失或不可读 — 返回空
  }
  return result;
}
