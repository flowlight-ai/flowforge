/**
 * HookRegistry — C41（F237 Phase 2）。
 *
 * 扫描 `assets/prompt-hooks/` 中的 hook.yaml 清单，解析、校验并注册。
 * 模式同 clowder-ai PluginRegistry（F202）：
 *   - 目录前缀必须匹配 manifest.id 小写（b1-* ↔ B1）
 *   - 同一 stage 内 order 唯一
 *   - 模板先查 hook 子目录，再查集中模板目录
 */

import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { HookManifest, HookStage, RegisteredHook } from './types.js';
import { parseHookManifest } from './hook-manifest-parser.js';

export class HookRegistry {
  private hooks = new Map<string, RegisteredHook>();
  private readonly hooksDir: string;
  private readonly templatesDir: string | null;

  /**
   * @param hooksDir - 包含 hook 子目录（每个含 hook.yaml）的目录
   * @param templatesDir - 可选的集中模板回退目录
   *   （模板先查 hook 子目录，再查此回退目录）
   */
  constructor(hooksDir: string, templatesDir?: string) {
    this.hooksDir = hooksDir;
    this.templatesDir = templatesDir ?? null;
  }

  /** 扫描 hook 目录，解析清单，校验并注册。 */
  scan(): HookManifest[] {
    this.hooks.clear();

    if (!existsSync(this.hooksDir)) return [];

    let entries: string[];
    try {
      entries = readdirSync(this.hooksDir).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }

    const ordersByStage = new Map<HookStage, Map<number, string>>();
    const results: HookManifest[] = [];

    for (const entry of entries) {
      const hookDir = join(this.hooksDir, entry);
      try {
        if (!lstatSync(hookDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const yamlPath = join(hookDir, 'hook.yaml');
      if (!existsSync(yamlPath)) continue;

      const result = parseHookManifest(yamlPath);
      if (!result.ok || !result.manifest) {
        // 跳过并记录（不中断扫描）
        this.warn(`Skipping ${entry}: ${result.errors.join('; ')}`);
        continue;
      }

      const manifest = result.manifest;

      // 校验目录前缀与 ID 小写匹配（b1-* ↔ B1）
      const expectedDirPrefix = manifest.id.toLowerCase();
      if (!entry.toLowerCase().startsWith(expectedDirPrefix)) {
        this.warn(`Skipping ${entry}: directory must start with '${expectedDirPrefix}'`);
        continue;
      }

      // 校验同一 stage 内 order 唯一
      if (!ordersByStage.has(manifest.stage)) {
        ordersByStage.set(manifest.stage, new Map());
      }
      const stageOrders = ordersByStage.get(manifest.stage)!;
      const existing = stageOrders.get(manifest.order);
      if (existing) {
        this.warn(
          `Skipping ${entry}: order ${manifest.order} in stage '${manifest.stage}' already used by ${existing}`,
        );
        continue;
      }
      stageOrders.set(manifest.order, manifest.id);

      // 解析模板路径：先 hook 子目录，再集中模板目录
      let templatePath = join(hookDir, manifest.template);
      if (!existsSync(templatePath) && this.templatesDir) {
        templatePath = join(this.templatesDir, manifest.template);
      }
      if (!existsSync(templatePath)) {
        this.warn(`Skipping ${entry}: template '${manifest.template}' not found`);
        continue;
      }

      this.hooks.set(manifest.id, { manifest, dirPath: hookDir, templatePath });
      results.push(manifest);
    }

    return results;
  }

  /** 按 ID 取已注册 hook（未注册返回 undefined）。 */
  getHook(hookId: string): RegisteredHook | undefined {
    return this.hooks.get(hookId);
  }

  /** 取指定 stage 的全部 hooks，按 manifest order 升序。 */
  getStageHooks(stage: HookStage): RegisteredHook[] {
    return [...this.hooks.values()]
      .filter((hook) => hook.manifest.stage === stage)
      .sort((a, b) => a.manifest.order - b.manifest.order);
  }

  /** 全部已注册 hooks（按 ID 排序）。 */
  list(): RegisteredHook[] {
    return [...this.hooks.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }

  /** 已注册数量。 */
  size(): number {
    return this.hooks.size;
  }

  private warn(message: string): void {
    // eslint-disable-next-line no-console
    console.warn(`[HookRegistry] ${message}`);
  }
}
