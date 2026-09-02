/**
 * Cat 配置加载器（C40，clowder config/cat-config-loader.ts 移植）。
 *
 * - `loadResolvedCatConfig`：cat-template.json 为 base，`.cat-cafe/cat-catalog.json`
 *   为 delta overlay（深合并 + 模板 breed 过滤），catalog 缺失时只读模板
 * - `loadCatConfig(filePath)`：显式文件直读
 * - 读写与目录探测全部注入式（测试确定性）；模板路径取
 *   CAT_TEMPLATE_PATH / FF_CAT_TEMPLATE_PATH env 或显式 defaultTemplatePath。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deepMergeConfig, parseCatConfig, type CatCafeConfig } from './schema.ts';

export interface CatConfigLoaderDeps {
  /** 读取文本文件；缺省用 node:fs readFileSync。 */
  readFile?: (filePath: string) => string;
  /** 读取 .cat-cafe/cat-catalog.json；返回 null 表示目录不存在/无 catalog。 */
  readCatalogRaw?: (projectRoot: string) => string | null;
  /** 默认 cat-template.json 路径（优先于 env）。 */
  defaultTemplatePath?: string;
  env?: NodeJS.ProcessEnv;
}

const defaultReadFile = (filePath: string): string => readFileSync(filePath, 'utf-8');

const defaultReadCatalogRaw = (projectRoot: string): string | null => {
  try {
    return readFileSync(resolve(projectRoot, '.cat-cafe', 'cat-catalog.json'), 'utf-8');
  } catch {
    return null;
  }
};

/** 解析模板路径：显式 → env CAT_TEMPLATE_PATH → FF_CAT_TEMPLATE_PATH。 */
export function resolveTemplatePath(deps: Pick<CatConfigLoaderDeps, 'defaultTemplatePath' | 'env'>): string {
  const env = deps.env ?? process.env;
  const fromEnv = env.CAT_TEMPLATE_PATH?.trim() ?? env.FF_CAT_TEMPLATE_PATH?.trim();
  if (deps.defaultTemplatePath) return deps.defaultTemplatePath;
  if (fromEnv) return fromEnv;
  throw new Error(
    'Cat template path is not configured: set CAT_TEMPLATE_PATH / FF_CAT_TEMPLATE_PATH or pass defaultTemplatePath',
  );
}

/**
 * 合并模板与 catalog，应用 #772 模板-only breed 过滤：
 * catalog 存在时只有 catalog breeds 是运行态成员；其余从合并结果剔除。
 */
export function mergeTemplateWithCatalog(
  templatePath: string,
  deps: Pick<CatConfigLoaderDeps, 'readFile' | 'readCatalogRaw'>,
): string | null {
  const projectRoot = resolve(templatePath, '..');
  const catalogRaw = (deps.readCatalogRaw ?? defaultReadCatalogRaw)(projectRoot);
  if (catalogRaw === null) return null;

  const readFile = deps.readFile ?? defaultReadFile;
  const baseRaw = readFile(templatePath);
  const baseJson = JSON.parse(baseRaw) as Record<string, unknown>;
  const catalogJson = JSON.parse(catalogRaw) as Record<string, unknown>;
  const merged = deepMergeConfig(baseJson, catalogJson);

  const catalogBreeds = Array.isArray(catalogJson.breeds) ? (catalogJson.breeds as HasBreed[]) : [];
  const catalogBreedIds = new Set(catalogBreeds.map((breed) => breed.id));
  if (Array.isArray(merged.breeds)) {
    merged.breeds = (merged.breeds as HasBreed[]).filter((breed) => catalogBreedIds.has(breed.id));
  }

  return JSON.stringify(merged);
}

type HasBreed = { id: string };

/**
 * 读取并解析解析后的 cat 配置源（模板 + catalog overlay）。
 */
export function loadResolvedCatConfig(deps: CatConfigLoaderDeps = {}): CatCafeConfig {
  const templatePath = resolveTemplatePath(deps);
  const readFile = deps.readFile ?? defaultReadFile;
  const raw = mergeTemplateWithCatalog(templatePath, deps) ?? readFile(templatePath);
  return parseCatConfig(raw);
}

/** 显式文件路径直接读取解析。 */
export function loadCatConfig(
  filePath: string,
  deps: Pick<CatConfigLoaderDeps, 'readFile'> = {},
): CatCafeConfig {
  const readFile = deps.readFile ?? defaultReadFile;
  let raw: string;
  try {
    raw = readFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(`Failed to read cat config at ${filePath}: ${code ?? 'unknown error'}`);
  }
  return parseCatConfig(raw);
}
