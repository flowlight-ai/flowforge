/**
 * cats-catalog 文件工具 — 原子写 + 路径逃逸防护 + 测试沙箱写保护。
 *
 * 移植自 clowder-ai `config/cat-catalog-store.ts`（writeFileAtomic/safePath）与
 * `config/test-config-write-guard.ts`（assertSafeTestConfigRoot，env 改名 FF_* 系）。
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve, sep } from 'node:path';

/** 目录名与文件名常量（C38：.cat-cafe 运行态 JSON 体系）。 */
export const CONFIG_SUBDIR = '.cat-cafe';
export const CAT_CATALOG_FILENAME = 'cat-catalog.json';
export const ACCOUNTS_FILENAME = 'accounts.json';
export const USER_PREFERENCES_FILENAME = 'user-preferences.json';

/** 测试沙箱防护 env（原名 CAT_CAFE_TEST_SANDBOX* → FF_TEST_SANDBOX*，R17 改名）。 */
const TEST_SANDBOX_ENV = 'FF_TEST_SANDBOX';
const TEST_SANDBOX_ALLOW_UNSAFE_ROOT_ENV = 'FF_TEST_SANDBOX_ALLOW_UNSAFE_ROOT';

/** 拒绝把配置写入用户 HOME（测试沙箱开启时）。 */
export function assertSafeCatalogWrite(targetRoot: string, source: string): void {
  if (process.env[TEST_SANDBOX_ENV] !== '1') return;
  if (process.env[TEST_SANDBOX_ALLOW_UNSAFE_ROOT_ENV] === '1') return;
  const resolvedTarget = resolve(targetRoot);
  const resolvedHome = resolve(process.env.FF_TEST_REAL_HOME || homedir());
  if (resolvedTarget === resolvedHome) {
    throw new Error(
      `[test sandbox] Refusing ${source} write/migration against HOME (${resolvedHome}). ` +
        'Use a temp project root or explicit FF_GLOBAL_CONFIG_ROOT for isolation.',
    );
  }
}

/** 规范化路径，禁止逃逸 project root。 */
export function safePath(projectRoot: string, ...segments: string[]): string {
  const root = resolve(projectRoot);
  const normalized = resolve(root, ...segments);
  const rel = relative(root, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

/** 原子写（temp + rename），失败时清理 temp。 */
export function writeFileAtomic(filePath: string, content: string, mode?: number): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, content, { encoding: 'utf-8', mode: mode ?? 0o644 });
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures.
    }
    throw error;
  }
}

/** 原子写但可自定义 writer（供 writeAndValidate 先校验 temp 再 rename）。 */
export function writeAtomicVia(
  filePath: string,
  writeTemp: (tempPath: string) => void,
): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeTemp(tempPath);
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures.
    }
    throw error;
  }
}

/** 确保目录存在。 */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

/** JSON 文件读取（不存在返回 null；解析失败抛错由调用方处理）。 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** 判断是否为普通 record。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 解析 .cat-cafe 目录下文件路径（带逃逸防护）。 */
export function resolveCafeFilePath(projectRoot: string, fileName: string): string {
  return safePath(projectRoot, CONFIG_SUBDIR, fileName);
}

/** 解析全局根（FF_GLOBAL_CONFIG_ROOT env 优先，否则 projectRoot，缺省 homedir）。 */
export function resolveGlobalRoot(projectRoot?: string): string {
  const envRoot = process.env.FF_GLOBAL_CONFIG_ROOT;
  if (envRoot) return resolve(envRoot);
  if (projectRoot) return resolve(projectRoot);
  return homedir();
}
