/**
 * Bootcamp 工作区根解析（C8，clowder cats/services/bootcamp/workspace-root.ts 移植）。
 *
 * CAT_CAFE_WORKSPACE_ROOT / FF_BOOTCAMP_WORKSPACE_ROOT 显式配置优先；运行态
 * worktree 模式（CAT_CAFE_RUNTIME_ROOT 存在）下拒绝回落 cwd，防止把 bootcamp
 * 开发绑定到运行时目录；项目路径校验注入式。
 */

import { resolve } from 'node:path';

export type BootcampWorkspaceRootResolution = { ok: true; projectPath: string } | { ok: false; error: string };

/** 项目路径校验器（真实校验由宿主注入，如 fs realpath + git root 检查）。 */
export type ProjectPathValidator = (candidate: string) => Promise<string | null>;

export function resolveDefaultBootcampWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  const workspaceRoot = env.CAT_CAFE_WORKSPACE_ROOT?.trim() ?? env.FF_BOOTCAMP_WORKSPACE_ROOT?.trim();
  if (workspaceRoot) return workspaceRoot;

  // Runtime worktree mode must export a workspace root. Falling back to
  // process.cwd() here would bind bootcamp development to the runtime dir.
  if (env.CAT_CAFE_RUNTIME_ROOT?.trim()) {
    return null;
  }

  return cwd;
}

export interface ResolveBootcampWorkspaceRootOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** 缺省返回 null 的直通校验（测试/宿主接线注入真实校验器）。 */
  validateProjectPath?: ProjectPathValidator;
}

export async function resolveBootcampWorkspaceRoot(
  options: ResolveBootcampWorkspaceRootOptions = {},
): Promise<BootcampWorkspaceRootResolution> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const validateProjectPath = options.validateProjectPath ?? (async () => null);

  const bootcampWorkspaceRoot = resolveDefaultBootcampWorkspaceRoot(env, cwd);
  if (!bootcampWorkspaceRoot) {
    return {
      ok: false,
      error: 'Bootcamp workspace root is not configured; refusing to use runtime cwd',
    };
  }

  const validated = await validateProjectPath(bootcampWorkspaceRoot);
  if (!validated) {
    return {
      ok: false,
      error: `Bootcamp workspace root is invalid: ${resolve(bootcampWorkspaceRoot)}`,
    };
  }

  return { ok: true, projectPath: validated };
}
