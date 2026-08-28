/**
 * @flowforge/cats-workspace — 绝对路径 / 文档 href 解析（F063）。
 *
 * TS 移植自 clowder-ai `domains/workspace/workspace-path-resolution.ts`：
 * Codex 原生绝对路径 → typed Workspace target（worktreeId + 相对 path + kind），
 * Markdown 文档链接（可选 :line）→ WorkspaceDocumentTarget。
 * 插件化改造：workspace root 枚举依赖 `WorkspaceSecurity` 实例（host 注入）。
 *
 * @module @flowforge/cats-workspace/path-resolution
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { WorkspaceSecurityError } from './security.js';
import type { WorkspaceSecurity, WorktreeEntry } from './security.js';

export interface WorkspaceDocumentTarget {
  worktreeId: string;
  path: string;
  line: number | null;
}

export interface WorkspaceAbsolutePathTarget {
  worktreeId: string;
  path: string;
  kind: 'file' | 'directory';
}

const MARKDOWN_DOCUMENT_HREF_RE = /^(.*\.mdx?)(?::([1-9]\d*))?$/i;

function containsPath(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function selectWorkspaceRoot(
  absoluteCandidate: string,
  entries: WorktreeEntry[],
): Promise<{ entry: WorktreeEntry; relativePath: string }> {
  const withResolvedRoots = entries.map((entry) => ({
    entry,
    resolvedRoot: resolve(entry.root),
  }));
  let matches = withResolvedRoots.filter(({ resolvedRoot }) => containsPath(resolvedRoot, absoluteCandidate));
  let relativeFromMatch = (root: string) => relative(root, absoluteCandidate);

  // root 别名（如 macOS /tmp → /private/tmp）可能无法词法匹配。
  // 仅在无词法匹配时回退 canonical 路径；优先词法匹配以便 resolveWorkspacePath
  // 能检测逃逸所选 root 的 symlink。
  if (matches.length === 0) {
    const canonicalCandidate = await realpath(absoluteCandidate).catch(() => absoluteCandidate);
    const canonicalEntries = await Promise.all(
      entries.map(async (entry) => ({
        entry,
        resolvedRoot: await realpath(entry.root).catch(() => resolve(entry.root)),
      })),
    );
    matches = canonicalEntries.filter(({ resolvedRoot }) => containsPath(resolvedRoot, canonicalCandidate));
    relativeFromMatch = (root: string) => relative(root, canonicalCandidate);
  }

  const selected = matches.sort((a, b) => b.resolvedRoot.length - a.resolvedRoot.length)[0];
  if (!selected) {
    throw new WorkspaceSecurityError('Path is not in a registered workspace', 'NOT_FOUND');
  }
  return {
    entry: selected.entry,
    relativePath: relativeFromMatch(selected.resolvedRoot),
  };
}

/** 解析 Codex 原生绝对本地路径 → typed Workspace target。 */
export async function resolveWorkspaceAbsolutePath(
  security: WorkspaceSecurity,
  absolutePath: string,
  repoRoot?: string,
): Promise<WorkspaceAbsolutePathTarget> {
  if (!isAbsolute(absolutePath)) {
    throw new WorkspaceSecurityError('Workspace path must be absolute', 'NOT_FOUND');
  }
  const selected = await selectWorkspaceRoot(resolve(absolutePath), await security.listWorkspaceRootEntries(repoRoot));
  const resolvedPath = await security.resolveWorkspaceFilesystemPath(selected.entry.root, selected.relativePath);
  const pathStat = await stat(resolvedPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new WorkspaceSecurityError('Workspace path not found', 'NOT_FOUND');
    }
    throw error;
  });
  if (!pathStat.isFile() && !pathStat.isDirectory()) {
    throw new WorkspaceSecurityError('Workspace path not found', 'NOT_FOUND');
  }
  return {
    worktreeId: selected.entry.id,
    path: selected.relativePath ? selected.relativePath.split(sep).join('/') : '.',
    kind: pathStat.isDirectory() ? 'directory' : 'file',
  };
}

/** 解析无 fragment 的原生 Markdown 路径（含可选 `:line`）→ typed target。 */
export async function resolveWorkspaceDocumentHref(
  security: WorkspaceSecurity,
  href: string,
  repoRoot?: string,
): Promise<WorkspaceDocumentTarget> {
  const match = href.match(MARKDOWN_DOCUMENT_HREF_RE);
  const candidate = match?.[1];
  if (!candidate) {
    throw new WorkspaceSecurityError('Document link must be an absolute local Markdown path', 'NOT_FOUND');
  }
  const target = await resolveWorkspaceAbsolutePath(security, candidate, repoRoot);
  if (target.kind !== 'file') {
    throw new WorkspaceSecurityError('Document not found', 'NOT_FOUND');
  }
  return {
    worktreeId: target.worktreeId,
    path: target.path,
    line: match[2] ? Number.parseInt(match[2], 10) : null,
  };
}
