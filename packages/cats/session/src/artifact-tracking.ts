/**
 * Artifact tracking — F148 Phase G（批次 6.4 只移植 `extractRecentArtifacts`
 * 及其类型依赖；`mergeLedger` 未被 SessionSealer 消费，不随行）。
 *
 * 移植自 clowder-ai
 * `packages/api/src/domains/cats/services/agents/routing/artifact-tracking.ts`。
 *
 * @module @flowforge/cats-session/artifacts
 */

export interface RecentArtifact {
  type: 'pr' | 'file' | 'plan' | 'feature-doc';
  ref: string;
  label: string;
  updatedAt: number;
  updatedBy: string;
  ops?: string[];
}

const MAX_ARTIFACTS = 5;
const WRITE_OPS = new Set(['edit', 'create', 'delete']);

function classifyPath(path: string): RecentArtifact['type'] {
  if (path.startsWith('docs/features/')) return 'feature-doc';
  if (path.startsWith('docs/plans/')) return 'plan';
  return 'file';
}

function labelFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export interface ArtifactExtractionInput {
  filesTouched: Array<{ path: string; ops: string[] }>;
  prTasks: Array<{
    id: string;
    kind: string;
    subjectKey: string | null;
    title: string;
    ownerCatId: string | null;
    status: string;
    updatedAt: number;
  }>;
  catId: string;
}

export function extractRecentArtifacts(input: ArtifactExtractionInput): RecentArtifact[] {
  const artifacts: RecentArtifact[] = [];

  for (const task of input.prTasks) {
    if (task.kind !== 'pr_tracking' || task.status === 'done' || !task.subjectKey) continue;
    const prRef = task.subjectKey.replace(/^pr:/, '');
    const prNumber = prRef.match(/#(\d+)/)?.[0] ?? prRef;
    artifacts.push({
      type: 'pr',
      ref: prRef,
      label: `PR ${prNumber}`,
      updatedAt: task.updatedAt,
      updatedBy: task.ownerCatId ?? 'unknown',
    });
  }

  for (const file of input.filesTouched) {
    if (!file.ops.some((op) => WRITE_OPS.has(op))) continue;
    artifacts.push({
      type: classifyPath(file.path),
      ref: file.path,
      label: labelFromPath(file.path),
      updatedAt: Date.now(),
      updatedBy: input.catId,
      ops: file.ops.filter((op) => WRITE_OPS.has(op)),
    });
  }

  return sortAndCapArtifacts(artifacts);
}

export function sortAndCapArtifacts(artifacts: RecentArtifact[], max = MAX_ARTIFACTS): RecentArtifact[] {
  return [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max);
}
