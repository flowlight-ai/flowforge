/**
 * Workspace read controller — tree / file / raw / search / diff /
 * linked-roots / reveal / resolve-document-link.
 *
 * Rebuilds clowder routes/workspace.ts behind the injected workspace-fs / git /
 * security / reveal seams. All path resolution passes through the
 * workspace-security guard; pure logic lives in `pure/workspace-tree.ts` and
 * `pure/git-parsers.ts`.
 */

import { RestControllerBase } from '../ports/http.ts';
import type { WorkspaceFsSeam } from '../ports/workspace-fs.ts';
import { guessMime, isTextPreview, sha256Hex } from '../ports/workspace-fs.ts';
import { WorkspaceSecurity } from '../ports/workspace-security.ts';
import { isDenylisted } from '../ports/workspace-security.ts';
import type { GitSeam } from '../ports/git.ts';
import type { LinkedRootsStore } from '../ports/workspace-security.ts';
import type { RevealBranch, RevealSeam } from '../ports/workspace-fs.ts';
import {
  buildTree,
  isContentSearchable,
  MAX_TREE_DEPTH,
  MAX_SEARCH_RESULTS,
} from '../pure/workspace-tree.ts';
import { parseWorkspaceChangedFiles } from '../pure/git-parsers.ts';
import { MESSAGES } from '../contract/messages.ts';
import type { WorkspaceSearchResult, TreeNode } from '../contract/workspace.ts';
import type { FilePreview } from '../contract/workspace.ts';

type RevealSeamName = RevealBranch;

export interface WorkspaceControllerOptions {
  security: WorkspaceSecurity;
  fs: WorkspaceFsSeam;
  git: GitSeam;
  linkedRoots: LinkedRootsStore;
  reveal?: RevealSeam;
  /** Resolve a document href into a filesystem path (host wires doc graph in EP2). */
  resolveDocumentHref?: (href: string) => string | null;
}

export class WorkspaceController extends RestControllerBase {
  constructor(private readonly opts: WorkspaceControllerOptions) {
    super();
    this.registerRoutes();
  }

  private async resolveRoot(worktreeId: string): Promise<string | null> {
    try {
      return await this.opts.security.getWorktreeRoot(worktreeId);
    } catch {
      return null;
    }
  }

  private revealCommandFor(platform: RevealSeamName, path: string, isDir: boolean): { program: string; args: string[] } | null {
    const seam = this.opts.reveal as { revealCommand?: (p: RevealBranch, r: string, d: boolean) => { program: string; args: string[] } | null } | undefined;
    if (!seam?.revealCommand) return null;
    return seam.revealCommand(platform, path, isDir);
  }

  private registerRoutes(): void {
    // GET /api/workspace/tree
    this.get('/api/workspace/tree', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      const dirPath = req.query?.path ?? '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, dirPath || '.');
      if (isDenylisted(dirPath)) return { status: 403, body: { error: 'Path denied' } };
      const tree: TreeNode[] = await buildTree({ fs: this.opts.fs, root, dirPath: resolved, depth: 0, maxDepth: MAX_TREE_DEPTH });
      return { status: 200, body: { worktreeId, path: resolved, tree } };
    });

    // GET /api/workspace/file
    this.get('/api/workspace/file', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      const filePath = req.query?.path ?? '';
      if (!worktreeId || !filePath) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, filePath);
      if (isDenylisted(filePath)) return { status: 403, body: { error: 'Path denied' } };
      const stat = await this.opts.fs.stat(resolved);
      if (!stat || stat.type !== 'file') return { status: 404, body: { error: 'File not found' } };
      const content = (await this.opts.fs.readFileText(resolved)) ?? '';
      const preview: FilePreview = {
        content: content.slice(0, 50000),
        sha256: sha256Hex(content),
        size: content.length,
        mime: guessMime(filePath),
        truncated: content.length > 50000,
        binary: !isTextPreview(filePath, content),
      };
      return { status: 200, body: { worktreeId, path: resolved, ...preview } };
    });

    // GET /api/workspace/raw
    this.get('/api/workspace/raw', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      const filePath = req.query?.path ?? '';
      if (!worktreeId || !filePath) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, filePath);
      const content = (await this.opts.fs.readFileText(resolved)) ?? '';
      return { status: 200, headers: { 'content-type': guessMime(filePath) }, body: content };
    });

    // GET /api/workspace/search
    this.get('/api/workspace/search', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      const q = req.query?.q ?? '';
      if (!worktreeId || !q) return { status: 400, body: { error: 'worktreeId and q are required' } };
      if (q.length > 200) return { status: 400, body: { error: MESSAGES.queryTooLong } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const needle = q.toLowerCase();
      const files = await this.opts.fs.listFiles(root);
      const results: WorkspaceSearchResult[] = [];
      for (const rel of files) {
        if (results.length >= MAX_SEARCH_RESULTS) break;
        if (!isContentSearchable(rel) || isDenylisted(rel)) continue;
        const content = (await this.opts.fs.readFileText(rel)) ?? '';
        const relLower = content.toLowerCase();
        const idx = relLower.indexOf(needle);
        if (idx === -1) continue;
        const line = content.slice(0, idx).split('\n').length;
        const start = content.lastIndexOf('\n', idx) + 1;
        const end = content.indexOf('\n', start + 200) === -1 ? content.length : content.indexOf('\n', start + 200);
        results.push({
          path: rel,
          line,
          content: content.slice(start, end),
          contextBefore: content.slice(Math.max(0, start - 80), start),
          contextAfter: content.slice(end, Math.min(content.length, end + 80)),
        });
      }
      return { status: 200, body: { results, totalMatches: results.length, truncated: results.length >= MAX_SEARCH_RESULTS } };
    });

    // GET /api/workspace/diff
    this.get('/api/workspace/diff', async (req) => {
      const worktreeId = req.query?.worktreeId ?? '';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const { stdout } = await this.opts.git.exec(root, ['status', '--porcelain'], { timeoutMs: 5000 });
      const changedFiles = parseWorkspaceChangedFiles(stdout);
      return { status: 200, body: { worktreeId, changedFiles } };
    });

    // GET /api/workspace/linked-roots
    this.get('/api/workspace/linked-roots', async () => {
      const roots = await this.opts.linkedRoots.list();
      return { status: 200, body: { linkedRoots: roots } };
    });

    // POST /api/workspace/linked-roots
    this.post('/api/workspace/linked-roots', async (req) => {
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!name || !path) return { status: 400, body: { error: 'name and path are required' } };
      const entry = await this.opts.linkedRoots.add(name, path);
      return { status: 201, body: { linkedRoot: entry } };
    });

    // DELETE /api/workspace/linked-roots/:linkedId
    this.delete('/api/workspace/linked-roots/:linkedId', async (req) => {
      const linkedId = req.params?.linkedId ?? '';
      const removed = await this.opts.linkedRoots.remove(linkedId);
      if (!removed) return { status: 404, body: { error: 'Linked root not found' } };
      return { status: 200, body: { ok: true } };
    });

    // POST /api/workspace/reveal
    this.post('/api/workspace/reveal', async (req) => {
      const worktreeId = typeof req.body?.worktreeId === 'string' ? req.body.worktreeId : '';
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      const rawPlatform = typeof req.body?.platform === 'string' ? req.body.platform : 'linux';
      const platform: RevealBranch = rawPlatform === 'darwin' || rawPlatform === 'win32' ? rawPlatform : 'linux';
      if (!worktreeId || !path) return { status: 400, body: { error: MESSAGES.treeAuthRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const resolved = await this.opts.security.resolveFilesystemPath(root, path);
      const command = this.revealCommandFor(platform, resolved, false);
      if (!command) return { status: 503, body: { error: 'Reveal seam unavailable' } };
      return { status: 200, body: { ok: true, command } };
    });

    // POST /api/workspace/reveal-project
    this.post('/api/workspace/reveal-project', async (req) => {
      const worktreeId = typeof req.body?.worktreeId === 'string' ? req.body.worktreeId : '';
      const rawPlatform = typeof req.body?.platform === 'string' ? req.body.platform : 'linux';
      const platform: RevealBranch = rawPlatform === 'darwin' || rawPlatform === 'win32' ? rawPlatform : 'linux';
      if (!worktreeId) return { status: 400, body: { error: MESSAGES.worktreeIdRequired } };
      const root = await this.resolveRoot(worktreeId);
      if (!root) return { status: 404, body: { error: `Worktree not found: ${worktreeId}` } };
      const command = this.revealCommandFor(platform, root, true);
      if (!command) return { status: 503, body: { error: 'Reveal seam unavailable' } };
      return { status: 200, body: { ok: true, command } };
    });

    // POST /api/workspace/resolve-document-link
    this.post('/api/workspace/resolve-document-link', async (req) => {
      const href = typeof req.body?.href === 'string' ? req.body.href : '';
      if (!href) return { status: 400, body: { error: MESSAGES.hrefRequired } };
      if (!this.opts.resolveDocumentHref) return { status: 503, body: { error: 'Document link resolver unavailable' } };
      const resolved = this.opts.resolveDocumentHref(href);
      if (resolved === null) return { status: 404, body: { error: 'Unresolvable document link' } };
      return { status: 200, body: { href, path: resolved } };
    });
  }
}