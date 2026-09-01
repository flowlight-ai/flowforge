/**
 * @flowforge/context-file-reference-local — 本地文件系统实现 `ctx.fileReferences`（D39）。
 *
 * dsh 移植，插件化改造：dsh 依赖 Agent 服务形态（agent.session.header.cwd、
 * agents 生命周期事件、systemPrompt/tools 注入）——flowforge Agent 服务形态
 * 不同，故本包以**注入式 cwd 解析器**适配：宿主提供 per-agent cwd 即可挂载
 * `ctx.fileReferences`，WorkspaceFileSearch 算法完整保留。
 *
 * @module @flowforge/context-file-reference-local
 */

import { Context } from '@flowforge/cordis';

import FileReferenceService, { type FileReferenceCandidate } from '@flowforge/context-file-reference';
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
  type FileSearchConfig,
} from './search.ts';

export {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
} from './search.ts';
export type { FileSearchConfig } from './search.ts';
export { FILE_REFERENCE_PROMPT } from '@flowforge/context-file-reference';
export { activeAtToken, formatFileMention } from '@flowforge/context-file-reference';

/** 本地文件引用发现配置。 */
export interface Config {
  /** 单查询返回的最大排序候选数。 */
  maxResults?: number;
  /** 每 agent 工作区最大索引文件/目录数。 */
  maxEntries?: number;
  /** 永不遍历或提供的目录 basename。 */
  excludedDirectories?: string[];
}

/** 插件配置。 */
export interface LocalFileReferenceConfig extends Config {
  /** 注入式 cwd 解析（per-agent 工作目录；缺省 process.cwd）。 */
  resolveCwd?: (key: string) => string;
}

/** 本地文件系统 owner 的 file-reference 发现服务。 */
export class LocalFileReferenceService extends FileReferenceService {
  private readonly config: FileSearchConfig;
  private readonly searches = new Map<string, WorkspaceFileSearch>();
  private readonly resolveCwd: (key: string) => string;

  constructor(ctx: Context, config: LocalFileReferenceConfig = {}) {
    super(ctx);
    this.config = {
      maxResults: config.maxResults ?? DEFAULT_FILE_SEARCH_MAX_RESULTS,
      maxEntries: config.maxEntries ?? DEFAULT_FILE_SEARCH_MAX_ENTRIES,
      excludedDirectories: config.excludedDirectories ?? [...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES],
    };
    validateConfig(this.config);
    this.resolveCwd = config.resolveCwd ?? (() => process.cwd());

    this.ctx.effect(() => () => {
      for (const search of this.searches.values()) search.dispose();
      this.searches.clear();
    }, 'file-reference-local: search cache');
  }

  override list(key: string, query: string, signal: AbortSignal): Promise<FileReferenceCandidate[]> {
    let search = this.searches.get(key);
    if (search === undefined) {
      search = new WorkspaceFileSearch(this.resolveCwd(key), this.config);
      this.searches.set(key, search);
    }
    return search.list(query, signal);
  }

  /** 使某 key 的索引失效（工具结果后调用）。 */
  invalidate(key: string): void {
    this.searches.get(key)?.invalidate();
  }
}

function validateConfig(config: FileSearchConfig): void {
  if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) {
    throw new Error('file-reference-local: maxResults must be a positive safe integer');
  }
  if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) {
    throw new Error('file-reference-local: maxEntries must be a positive safe integer');
  }
  if (config.excludedDirectories.some((name) => name.length === 0 || name.includes('/') || name.includes('\\'))) {
    throw new Error('file-reference-local: excludedDirectories entries must be non-empty directory basenames');
  }
}

export default LocalFileReferenceService;
