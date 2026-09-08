/**
 * Workspace directory-tree builder (pure; ported from routes/workspace.ts).
 */

import type { WorkspaceFsSeam } from '../ports/workspace-fs.ts';
import type { TreeNode } from '../contract/workspace.ts';
import { isDenylisted } from '../ports/workspace-security.ts';
import { normalize } from '../ports/workspace-fs.ts';

export const MAX_TREE_DEPTH = 5;
export const MAX_SEARCH_RESULTS = 100;
export const MAX_CONTENT_SEARCH_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILE_SIZE = 1024 * 1024;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.turbo', 'coverage', '.claude']);

const CONTENT_SEARCH_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.mdx', '.txt', '.css', '.html',
  '.yaml', '.yml', '.toml', '.sh', '.py',
]);

export function isContentSearchable(relPath: string): boolean {
  return CONTENT_SEARCH_EXTENSIONS.has(extension(relPath));
}

function extension(path: string): string {
  const idx = path.lastIndexOf('.');
  return idx <= 0 ? '' : path.slice(idx).toLowerCase();
}

export interface BuildTreeDeps {
  fs: WorkspaceFsSeam;
  root: string;
  dirPath: string;
  depth: number;
  maxDepth: number;
}

export async function buildTree(deps: BuildTreeDeps): Promise<TreeNode[]> {
  if (deps.depth >= deps.maxDepth) return [];
  const entries = await deps.fs.readDir(deps.dirPath);
  const nodes: TreeNode[] = [];
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of sorted) {
    if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.kimi') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const relPath = normalize(joinRel(normalize(deps.root), joinRel(deps.root, entry.name)));
    if (isDenylisted(relPath)) continue;
    if (entry.isDirectory) {
      if (deps.depth + 1 >= deps.maxDepth) {
        nodes.push({ name: entry.name, path: relPath, type: 'directory' });
      } else {
        const children = await buildTree({
          ...deps,
          dirPath: joinRel(deps.dirPath, entry.name),
          depth: deps.depth + 1,
        });
        nodes.push({ name: entry.name, path: relPath, type: 'directory', children });
      }
    } else {
      nodes.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }
  return nodes;
}

function joinRel(base: string, name: string): string {
  const b = normalize(base);
  const suffix = name.replace(/^\/+/, '');
  return b === '/' ? '/' + suffix : b + '/' + suffix;
}