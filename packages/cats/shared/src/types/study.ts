/**
 * Signal Study Mode types (F091)
 */

export type ArtifactJobState = 'queued' | 'running' | 'ready' | 'failed';

export type ArtifactKind = 'note' | 'podcast' | 'research-report';

export interface StudyArtifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly state: ArtifactJobState;
  readonly filePath: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface StudyThreadLink {
  readonly threadId: string;
  readonly linkedAt: string;
  readonly linkedBy: string;
  readonly stale?: boolean | undefined;
}

export interface StudyMeta {
  readonly articleId: string;
  readonly threads: readonly StudyThreadLink[];
  readonly artifacts: readonly StudyArtifact[];
  readonly collections: readonly string[];
  readonly lastStudiedAt?: string | undefined;
}
