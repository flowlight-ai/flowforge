/**
 * @flowforge/infrastructure-github — C33 github 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/github/*`：
 *   - gh-cli-env：gh 子进程 token 解析（GITHUB_TOKEN → GH_TOKEN 回退）+
 *     每次调用环境构建（避免 ambient token 干扰 gh 自身 auth store）+
 *     Windows 隐藏控制台窗口
 *   - fetch-paginated：#798 逐页拉取（100 项/页 + 2MB maxBuffer），
 *     结构性杜绝单缓冲区溢出
 *   - comment-cursors：issue 评论游标（maxGithubId / fetchLatestIssueCommentCursor）
 *   - self-login-resolver：token 指纹缓存 + in-flight 去重的自登录解析器
 *
 * 插件化改造：execFile 注入式（缺省 node:child_process），测试桩友好。
 *
 * @module @flowforge/infrastructure-github
 */

import { Context, Service } from '@flowforge/cordis';

// ── gh-cli-env ──────────────────────────────────────────────

export interface GhCliEnvOptions {
  readonly token?: string | null;
  readonly baseEnv?: NodeJS.ProcessEnv;
}

export interface ResolveGhCliTokenOptions {
  readonly pluginEnv?: Record<string, string | undefined>;
  readonly baseEnv?: NodeJS.ProcessEnv;
}

function cleanToken(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  return token ? token : undefined;
}

/** 解析 gh token：pluginEnv.GITHUB_TOKEN 显式优先 → GH_TOKEN → GITHUB_TOKEN。 */
export function resolveGhCliToken(options: ResolveGhCliTokenOptions = {}): string | undefined {
  const pluginEnv = options.pluginEnv ?? {};
  if (Object.hasOwn(pluginEnv, 'GITHUB_TOKEN')) {
    return cleanToken(pluginEnv.GITHUB_TOKEN);
  }
  const env = options.baseEnv ?? process.env;
  return cleanToken(env.GH_TOKEN) ?? cleanToken(env.GITHUB_TOKEN);
}

/**
 * 构建 gh 子进程的每次调用环境。
 * ambient GITHUB_TOKEN/GH_TOKEN 会让 gh 忽略自身 auth store——
 * 仅在调用方显式解析到非空 token 时传递。
 */
export function buildGhCliEnv(options: GhCliEnvOptions = {}): NodeJS.ProcessEnv {
  const env = { ...(options.baseEnv ?? process.env) };
  const token = typeof options.token === 'string' ? options.token.trim() : '';
  delete env.GH_TOKEN;
  if (token) {
    env.GITHUB_TOKEN = token;
  } else {
    delete env.GITHUB_TOKEN;
  }
  return env;
}

/** 阻止 gh 子进程在 Windows 上产生瞬态控制台窗口。 */
export function withHiddenGhCliWindow<T extends object>(options: T): T & { readonly windowsHide: true } {
  return { ...options, windowsHide: true };
}

// ── fetch-paginated ─────────────────────────────────────────

export interface FetchPaginatedOptions {
  /** Items with id > sinceId are collected. 0 or omitted = collect all. */
  sinceId?: number;
  /** Optional token resolved by the caller; when absent, gh uses its own auth store. */
  ghToken?: string;
  /** Override for testing — replaces real execFile */
  execFileAsync?: (
    file: string,
    args: string[],
    opts: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv; windowsHide: boolean },
  ) => Promise<{ stdout: string }>;
}

/**
 * 逐页拉取 GitHub API endpoint 全部条目（#798）。
 * 100 项/页 + 2MB maxBuffer —— 单缓冲区溢出结构性不可能。
 * 返回未类型化数组，调用方自行 cast。
 */
// oxlint-disable-next-line no-explicit-any: GitHub API JSON responses are untyped; callers cast inline
export async function fetchPaginated(endpoint: string, options: FetchPaginatedOptions = {}): Promise<any[]> {
  const { sinceId, ghToken, execFileAsync: execOverride } = options;
  const execFn =
    execOverride ??
    (async (
      file: string,
      args: string[],
      opts: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv; windowsHide: boolean },
    ) => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)(file, args, opts);
    });

  const cursor = sinceId ?? 0;
  // oxlint-disable-next-line no-explicit-any: GitHub API JSON parse results
  const allItems: any[] = [];
  let page = 1;

  while (true) {
    const { stdout } = await execFn(
      'gh',
      ['api', `${endpoint}?per_page=100&page=${page}`, '--jq', '.[]'],
      withHiddenGhCliWindow({
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        env: buildGhCliEnv({ token: ghToken ?? null }),
      }),
    );
    if (!stdout.trim()) break; // empty page = no more data

    const items = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (items.length === 0) break;

    const newItems = cursor > 0 ? items.filter((item: { id?: number }) => (item.id ?? 0) > cursor) : items;
    allItems.push(...newItems);

    // GitHub API max per_page is 100; fewer items = last page
    if (items.length < 100) break;
    page++;
  }
  return allItems;
}

// ── comment-cursors ─────────────────────────────────────────

export interface GithubItemWithId {
  id?: unknown;
}

export interface FetchLatestIssueCommentCursorOptions {
  ghToken?: string;
  fetcher?: (endpoint: string, options: { ghToken?: string }) => Promise<readonly GithubItemWithId[]>;
}

/** 取条目列表中的最大数值 id（游标语义）。 */
export function maxGithubId(items: readonly GithubItemWithId[]): number {
  let cursor = 0;
  for (const item of items) {
    if (typeof item.id === 'number' && Number.isFinite(item.id) && item.id > cursor) {
      cursor = item.id;
    }
  }
  return cursor;
}

/** 拉取 issue 评论的最新游标（最大评论 id）。 */
export async function fetchLatestIssueCommentCursor(
  repoFullName: string,
  issueNumber: number,
  opts: FetchLatestIssueCommentCursorOptions = {},
): Promise<number> {
  const fetcher = opts.fetcher ?? fetchPaginated;
  const comments = await fetcher(`/repos/${repoFullName}/issues/${issueNumber}/comments`, {
    ...(opts.ghToken !== undefined ? { ghToken: opts.ghToken } : {}),
  });
  return maxGithubId(comments);
}

// ── self-login-resolver ─────────────────────────────────────

export interface GitHubSelfLoginResolverOptions {
  readonly getConfiguredLogin?: () => string | undefined;
  readonly getTokenFingerprint: () => string | undefined;
  readonly resolveLogin: () => Promise<string | undefined>;
}

export interface GitHubSelfLoginResolver {
  readonly getCurrent: () => string | undefined;
  readonly refreshIfNeeded: () => Promise<string | undefined>;
}

function cleanLogin(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const login = value.trim();
  return login ? login : undefined;
}

function cleanFingerprint(value: string | undefined | null): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * 自登录解析器：配置 login 显式优先；否则按 token 指纹缓存解析结果，
 * in-flight 去重（同指纹并发只发起一次解析）。
 */
export function createGitHubSelfLoginResolver(opts: GitHubSelfLoginResolverOptions): GitHubSelfLoginResolver {
  let cachedLogin: string | undefined;
  let cachedTokenFingerprint: string | undefined;
  let hasCachedTokenFingerprint = false;
  let inFlightTokenFingerprint: string | undefined;
  let inFlight: Promise<string | undefined> | undefined;

  const getConfiguredLogin = (): string | undefined => cleanLogin(opts.getConfiguredLogin?.());
  const getCurrent = (): string | undefined => getConfiguredLogin() ?? cachedLogin;

  const refreshIfNeeded = async (): Promise<string | undefined> => {
    const configuredLogin = getConfiguredLogin();
    if (configuredLogin) {
      cachedLogin = configuredLogin;
      cachedTokenFingerprint = undefined;
      hasCachedTokenFingerprint = false;
      return cachedLogin;
    }

    const tokenFingerprint = cleanFingerprint(opts.getTokenFingerprint());
    if (hasCachedTokenFingerprint && cachedTokenFingerprint === tokenFingerprint) {
      return cachedLogin;
    }
    if (inFlight && inFlightTokenFingerprint === tokenFingerprint) {
      return inFlight;
    }

    const resolvingTokenFingerprint = tokenFingerprint;
    inFlightTokenFingerprint = resolvingTokenFingerprint;
    inFlight = (async () => {
      try {
        const resolvedLogin = cleanLogin(await opts.resolveLogin());
        const configuredNow = getConfiguredLogin();
        if (configuredNow) {
          cachedLogin = configuredNow;
          cachedTokenFingerprint = undefined;
          hasCachedTokenFingerprint = false;
          return cachedLogin;
        }
        if (cleanFingerprint(opts.getTokenFingerprint()) !== resolvingTokenFingerprint) {
          return getCurrent();
        }
        cachedLogin = resolvedLogin;
        if (resolvedLogin) {
          cachedTokenFingerprint = resolvingTokenFingerprint;
          hasCachedTokenFingerprint = true;
        } else {
          cachedTokenFingerprint = undefined;
          hasCachedTokenFingerprint = false;
        }
        return cachedLogin;
      } catch {
        cachedLogin = undefined;
        cachedTokenFingerprint = undefined;
        hasCachedTokenFingerprint = false;
        return undefined;
      }
    })();

    try {
      return await inFlight;
    } finally {
      if (inFlightTokenFingerprint === resolvingTokenFingerprint) {
        inFlight = undefined;
        inFlightTokenFingerprint = undefined;
      }
    }
  };

  return { getCurrent, refreshIfNeeded };
}

// ── Cordis 插件 ─────────────────────────────────────────────

export interface GithubToolsConfig {
  /** pluginEnv（token 解析注入缝，缺省 {}）。 */
  pluginEnv?: Record<string, string | undefined>;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** github 域（C33）：gh CLI 环境 + 逐页拉取 + 评论游标 + 自登录解析 */
    forgeGithubTools: ForgeGithubToolsService;
  }
}

/**
 * github 域服务 — 挂载 `ctx.forgeGithubTools`。
 * 纯工具聚合（token 解析 / env 构建 / 逐页拉取 / 游标 / 登录解析）。
 */
export class ForgeGithubToolsService extends Service {
  private readonly cfg: GithubToolsConfig;

  constructor(ctx: Context, config: GithubToolsConfig = {}) {
    super(ctx, 'forgeGithubTools');
    this.cfg = config;
  }

  /** 解析 gh token（pluginEnv 显式优先）。 */
  resolveToken(): string | undefined {
    return resolveGhCliToken({ pluginEnv: this.cfg.pluginEnv ?? {} });
  }

  buildEnv(token?: string | null): NodeJS.ProcessEnv {
    return buildGhCliEnv({ token: token ?? null });
  }

  fetchPaginated(endpoint: string, options: Omit<FetchPaginatedOptions, 'ghToken'> = {}) {
    const token = this.resolveToken();
    return fetchPaginated(endpoint, {
      ...options,
      ...(token !== undefined ? { ghToken: token } : {}),
    });
  }

  fetchLatestIssueCommentCursor(repoFullName: string, issueNumber: number) {
    const token = this.resolveToken();
    return fetchLatestIssueCommentCursor(repoFullName, issueNumber, {
      ...(token !== undefined ? { ghToken: token } : {}),
    });
  }

  createSelfLoginResolver(opts: GitHubSelfLoginResolverOptions): GitHubSelfLoginResolver {
    return createGitHubSelfLoginResolver(opts);
  }
}

export default ForgeGithubToolsService;
