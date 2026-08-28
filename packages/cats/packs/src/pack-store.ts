/**
 * @flowforge/cats-packs — C30 PackStore（F129 本地 Pack 存储）
 *
 * TS 移植：clowder-ai `domains/packs/PackStore.ts`。
 * 管理已安装 pack（.cat-cafe/packs/<name>/），baseDir 构造注入
 * （插件化：不持有全局路径常量，宿主显式传入）。
 */

import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackManifest, PackOnDisk } from '@flowforge/cats-shared';
import { PackManifestSchema } from '@flowforge/cats-shared';
import { parse } from 'yaml';

export class PackStore {
  constructor(private readonly baseDir: string) {}

  /** Ensure base directory exists */
  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private packDir(name: string): string {
    return join(this.baseDir, name);
  }

  /** Install a validated pack from source directory */
  async install(name: string, sourceDir: string): Promise<void> {
    await this.ensureDir();
    const dest = this.packDir(name);
    // Remove existing (upgrade path)
    await rm(dest, { recursive: true, force: true });
    await cp(sourceDir, dest, { recursive: true });
  }

  /** Remove an installed pack */
  async remove(name: string): Promise<boolean> {
    const dir = this.packDir(name);
    try {
      await stat(dir);
      await rm(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  /** List all installed pack manifests */
  async list(): Promise<PackManifest[]> {
    await this.ensureDir();
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const manifests: PackManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pack = await this.get(entry.name);
      if (pack) manifests.push(pack.manifest);
    }
    return manifests;
  }

  /** Get a single pack by name */
  async get(name: string): Promise<PackOnDisk | null> {
    const dir = this.packDir(name);
    const manifestPath = join(dir, 'pack.yaml');
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const parsed = parse(raw) as unknown;
      const result = PackManifestSchema.safeParse(parsed);
      if (!result.success) return null;
      // Schema 与 PackManifest 结构同构；zod output 含显式 undefined，断言对齐 exactOptionalPropertyTypes
      return { manifest: result.data as PackManifest, rootDir: dir };
    } catch {
      return null;
    }
  }

  /** Check if a pack is installed */
  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== null;
  }
}
