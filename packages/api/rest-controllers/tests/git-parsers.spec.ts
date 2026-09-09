/**
 * Pure git-output parser contract tests.
 */
import { describe, it, expect } from 'vitest';
import {
  parseGitLog,
  parseGitStatus,
  parseGitShow,
  parseStaleBranches,
  parseWorktreeHealth,
  parseDriftCommits,
  parseRuntimeDrift,
  parseWorkspaceChangedFiles,
} from '../src/pure/git-parsers.ts';

describe('parseGitLog', () => {
  it('parses nul-separated log lines into commits', () => {
    const out = 'abc12345\u0000Alice\u00002026-01-01 10:00:00 +0800\u0000feat: add thing\nbbbb0000\u0000Bob\u00002026-01-02 11:00:00 +0800\u0000fix: continue subject';
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({ hash: 'abc12345', short: 'abc12345', author: 'Alice', date: '2026-01-01 10:00:00 +0800', subject: 'feat: add thing' });
    expect(commits[1]?.subject).toBe('fix: continue subject');
  });
  it('returns empty for empty input', () => {
    expect(parseGitLog('')).toEqual([]);
  });
});

describe('parseGitStatus', () => {
  it('classifies staged/unstaged/untracked entries', () => {
    const out = ' M src/a.ts\n?? new.txt\nA  staged/b.ts\nMM both.md';
    const result = parseGitStatus(out);
    expect(result.unstaged.map((e) => `${e.status} ${e.path}`)).toEqual(['M src/a.ts', 'M both.md']);
    expect(result.staged.map((e) => `${e.status} ${e.path}`)).toEqual(['A staged/b.ts', 'M both.md']);
    expect(result.untracked.map((e) => e.path)).toEqual(['new.txt']);
  });
  it('returns empty structures for blank input', () => {
    expect(parseGitStatus(' ')).toEqual({ staged: [], unstaged: [], untracked: [] });
  });
});

describe('parseGitShow', () => {
  it('extracts path|summary lines only', () => {
    const out = ' src/a.ts | 5 +++++-\n src/b.ts | 2 --\n2 files changed';
    const files = parseGitShow(out);
    expect(files).toEqual([
      { path: 'src/a.ts', summary: '5 +++++-' },
      { path: 'src/b.ts', summary: '2 --' },
    ]);
  });
});

describe('parseStaleBranches', () => {
  it('parses refs minus protected branches', () => {
    const out = 'feature/x\u00002026-01-01\u0000Alice\nmain\u00002026-01-02\u0000Bob';
    const branches = parseStaleBranches(out);
    expect(branches.map((b) => b.name)).toEqual(['feature/x']);
  });
});

describe('parseWorktreeHealth', () => {
  it('parses porcelain sections and marks orphans', () => {
    const out = 'worktree /repo/main\nHEAD abcdef01\nbranch refs/heads/main\n\nworktree /repo/feature\nHEAD 12345678\nbranch refs/heads/feature\n';
    const health = parseWorktreeHealth(out, new Set(['feature']));
    expect(health).toHaveLength(2);
    expect(health[0]).toMatchObject({ path: '/repo/main', branch: 'main', head: 'abcdef01', isOrphan: false });
    expect(health[1]).toMatchObject({ path: '/repo/feature', branch: 'feature', isOrphan: true });
  });
});

describe('parseDriftCommits / parseRuntimeDrift', () => {
  it('parses drift commits', () => {
    expect(parseDriftCommits('aaa1 fix one\nbbb2 fix two')).toEqual([
      { short: 'aaa1', subject: 'fix one' },
      { short: 'bbb2', subject: 'fix two' },
    ]);
  });
  it('parses runtime drift counts', () => {
    const drift = parseRuntimeDrift('3\t5', 'mainhead', 'runtimehead');
    expect(drift).toMatchObject({ available: true, behindMain: 3, aheadOfMain: 5, mainHead: 'mainhead', runtimeHead: 'runtimehead' });
  });
});

describe('parseWorkspaceChangedFiles', () => {
  it('parses status + path, resolving renames to the destination', () => {
    const out = 'M  src/a.ts\n R  old.ts -> new.ts\n?? untracked.md';
    const changed = parseWorkspaceChangedFiles(out);
    expect(changed[0]).toEqual({ status: 'M', path: 'src/a.ts' });
    expect(changed[1]).toEqual({ status: 'R', path: 'new.ts' });
    expect(changed[2]).toEqual({ status: '??', path: 'untracked.md' });
  });
});