/**
 * Git output parsers (pure; ported from clowder routes/workspace-git.ts +
 * routes/workspace-diff.ts).
 */

import type {
  DriftCommit,
  GitCommit,
  GitShowFile,
  GitStatusResult,
  RuntimeDrift,
  StaleBranch,
  WorkspaceChangedFile,
  WorktreeHealthEntry,
} from '../contract/workspace.ts';

export function parseGitLog(stdout: string): GitCommit[] {
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [hash = '', author = '', date = '', ...subjectParts] = line.split('\0');
      return { hash, short: hash.slice(0, 8), author, date, subject: subjectParts.join('\0') };
    });
}

export function parseGitStatus(stdout: string): GitStatusResult {
  const result: GitStatusResult = { staged: [], unstaged: [], untracked: [] };
  if (!stdout.trim()) return result;
  // Split on newlines WITHOUT trimming the whole buffer: a leading space is the
  // worktree-status flag of the first porcelain line (e.g. " M file.ts"), and
  // trimming the buffer would silently erase it. Blank/short lines are skipped
  // inside classifyStatusLine.
  for (const line of stdout.split('\n')) {
    for (const entry of classifyStatusLine(line)) {
      result[entry.category].push({ status: entry.status, path: entry.path });
    }
  }
  return result;
}

function classifyStatusLine(
  line: string,
): Array<{ category: 'staged' | 'unstaged' | 'untracked'; status: string; path: string }> {
  if (line.length < 4) return [];
  const x = line[0] ?? ' ';
  const y = line[1] ?? ' ';
  const filePath = line.slice(3);
  if (x === '?' && y === '?') return [{ category: 'untracked', status: '??', path: filePath }];
  const entries: Array<{ category: 'staged' | 'unstaged'; status: string; path: string }> = [];
  if (x !== ' ' && x !== '?') entries.push({ category: 'staged', status: x, path: filePath });
  if (y !== ' ' && y !== '?') entries.push({ category: 'unstaged', status: y, path: filePath });
  return entries;
}

export function parseGitShow(statOutput: string): GitShowFile[] {
  return statOutput
    .trim()
    .split('\n')
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [pathPart, ...rest] = l.split('|');
      return { path: (pathPart ?? '').trim(), summary: rest.join('|').trim() };
    });
}

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop']);

export function parseStaleBranches(stdout: string): StaleBranch[] {
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const clean = line.replace(/^\*\s*/, '').trim();
      const [name = '', lastCommitDate = '', author = ''] = clean.split('\0');
      return { name: name.trim(), lastCommitDate, author, mergedInto: 'main' };
    })
    .filter((b) => b.name && !PROTECTED_BRANCHES.has(b.name));
}

export function parseWorktreeHealth(porcelainOutput: string, mergedBranches: Set<string>): WorktreeHealthEntry[] {
  const entries: WorktreeHealthEntry[] = [];
  let current: Partial<WorktreeHealthEntry> = {};
  for (const line of porcelainOutput.split('\n')) {
    if (line === '' && current.path) {
      entries.push({
        path: current.path,
        branch: current.branch ?? '(unknown)',
        head: current.head ?? '',
        isOrphan: current.branch ? mergedBranches.has(current.branch) : false,
      });
      current = {};
    } else {
      applyWorktreeLine(line, current);
    }
  }
  return entries;
}

function applyWorktreeLine(line: string, current: Partial<WorktreeHealthEntry>): void {
  if (line.startsWith('worktree ')) current.path = line.slice(9);
  else if (line.startsWith('HEAD ')) current.head = line.slice(5, 13);
  else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '');
  else if (line === 'detached') current.branch = '(detached)';
}

export function parseDriftCommits(logOutput: string): DriftCommit[] {
  if (!logOutput.trim()) return [];
  return logOutput
    .trim()
    .split('\n')
    .map((line) => {
      const [short = '', ...rest] = line.split(' ');
      return { short, subject: rest.join(' ') };
    });
}

export function parseRuntimeDrift(
  revListOutput: string,
  mainHead: string,
  runtimeHead: string,
  behindCommits: DriftCommit[] = [],
): RuntimeDrift {
  const [left = '0', right = '0'] = revListOutput.trim().split('\t');
  return {
    available: true,
    behindMain: Number(left) || 0,
    aheadOfMain: Number(right) || 0,
    mainHead,
    runtimeHead,
    behindCommits,
  };
}

export function parseWorkspaceChangedFiles(stdout: string): WorkspaceChangedFile[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      let path = line.slice(3);
      if ((status.startsWith('R') || status.startsWith('C')) && path.includes(' -> ')) {
        path = path.slice(path.indexOf(' -> ') + 4);
      }
      return { status, path };
    });
}