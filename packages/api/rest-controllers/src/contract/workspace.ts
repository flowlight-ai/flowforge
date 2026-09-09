/**
 * Workspace family contracts/types (self-contained, no framework deps).
 *
 * Rebuilds the clowder api-local workspace route types + git parsers + security
 * entry shapes without referencing the original modules.
 */

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export interface WorkspaceSearchResult {
  path: string;
  line: number;
  content: string;
  contextBefore: string;
  contextAfter: string;
}

export interface WorkspaceChangedFile {
  status: string;
  path: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitStatusEntry {
  status: string;
  path: string;
}

export interface GitStatusResult {
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: GitStatusEntry[];
}

export interface GitShowFile {
  path: string;
  summary: string;
}

export interface StaleBranch {
  name: string;
  lastCommitDate: string;
  author: string;
  mergedInto: string;
}

export interface WorktreeHealthEntry {
  path: string;
  branch: string;
  head: string;
  isOrphan: boolean;
}

export interface DriftCommit {
  short: string;
  subject: string;
}

export interface RuntimeDrift {
  available: boolean;
  aheadOfMain: number;
  behindMain: number;
  runtimeHead: string;
  mainHead: string;
  behindCommits: DriftCommit[];
}

export interface WorktreeEntry {
  id: string;
  canonicalId?: string;
  root: string;
  branch: string;
  head: string;
}

export type WorkspaceSecurityErrorCode = 'TRAVERSAL' | 'DENIED' | 'NOT_FOUND';

export class WorkspaceSecurityError extends Error {
  readonly code: WorkspaceSecurityErrorCode;
  constructor(message: string, code: WorkspaceSecurityErrorCode) {
    super(message);
    this.name = 'WorkspaceSecurityError';
    this.code = code;
  }
}

export interface EditTokenPayload {
  worktreeId: string;
  exp: number;
}

export interface FilePreview {
  content: string;
  sha256: string;
  size: number;
  mime: string;
  truncated: boolean;
  binary: boolean;
}