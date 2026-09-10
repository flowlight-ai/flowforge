/**
 * @flowforge/cats-frustration — 本地内联共享类型（源 clowder-ai `@cat-cafe/shared` 子集，
 * 避免引入未注册的跨包依赖）。F222 Frustration Auto-Issue 域。
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** CatId（轻量品牌字符串，仅非空校验）。 */
export type CatId = Brand<string, 'CatId'>;

export function createCatId(id: string): CatId {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid cat ID: must be non-empty string');
  }
  return id as CatId;
}

export type FrustrationSignalType =
  | 'cli_error'
  | 'cancel_burst'
  | 'text_frustration'
  | 'a2a_timeout'
  | 'retry_burst'
  | 'user_report';

export interface CliDiagnostics {
  reasonCode?: string;
  publicSummary?: string;
  publicHint?: string;
  safeExcerpt?: string;
}

export interface FrustrationContextMessage {
  role: 'user' | 'cat' | 'system';
  content: string;
  timestamp: number;
}

export interface FrustrationIssueContext {
  recentMessages: FrustrationContextMessage[];
  errorLogs?: string;
}

export type FrustrationIssueStatus = 'draft' | 'confirmed' | 'skipped' | 'false_positive';

export interface FrustrationIssue {
  issueId: string;
  status: FrustrationIssueStatus;
  threadId: string;
  userId: string;
  catId: CatId;
  invocationId?: string;
  signalType: FrustrationSignalType;
  signalDetail: Record<string, unknown>;
  context: FrustrationIssueContext;
  userDescription?: string;
  cardMessageId?: string;
  createdAt: number;
}

export interface CreateFrustrationIssueInput {
  threadId: string;
  userId: string;
  catId: CatId;
  invocationId?: string;
  signalType: FrustrationSignalType;
  signalDetail: Record<string, unknown>;
  context: FrustrationIssueContext;
}

export interface RichCardBlock {
  id: string;
  kind: 'card';
  v: number;
  title: string;
  bodyMarkdown: string;
  tone: string;
  fields: Array<{ label: string; value: string }>;
  meta: Record<string, unknown>;
}

export interface RichInteractiveOption {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  customInput?: boolean;
  customInputPlaceholder?: string;
  action?: { type: 'callback'; endpoint: string; payload: Record<string, unknown> };
}

export interface RichInteractiveBlock {
  id: string;
  kind: 'interactive';
  v: number;
  interactiveType: 'confirm' | 'card-grid';
  title: string;
  description: string;
  options: RichInteractiveOption[];
}

export type RichBlock = RichCardBlock | RichInteractiveBlock;