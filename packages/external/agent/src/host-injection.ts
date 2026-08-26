/**
 * @flowforge/external-agent host-injection — HostInjector（F241 CL-015 host-owned）。
 *
 * TS 重写自 flowforge/core/external_agent/host_injection.py：
 *   - CredentialStore Protocol（DI 注入点）：get(env_var)
 *   - SandboxConfig: cwd / network_allowlist / file_readonly_paths /
 *     file_writable_paths / env_vars / mcp_servers
 *   - HostInjector: injectCredentials（缺失抛错）/ injectSandbox /
 *     injectMcpConfig（${VAR} 形式从 store 解析，保留 env_keys）
 *
 * 核心原则："plugin 只声明不执行"——三方 Agent 不能自己获取 token、
 * 不能自己创建 sandbox，所有敏感操作由 host 注入。
 */

/** 凭据存储协议（host_injection.py CredentialStore）。 */
export interface CredentialStore {
  /** 按环境变量名获取凭据值（不写入日志）。 */
  get(envVar: string): string | undefined;
}

/** sandbox 配置（host_injection.py SandboxConfig）。 */
export interface SandboxConfig {
  /** 工作目录（worktree 路径，由 host 创建）。 */
  readonly cwd: string;
  /** 网络白名单（域名列表）。 */
  readonly network_allowlist: readonly string[];
  /** 只读路径列表。 */
  readonly file_readonly_paths: readonly string[];
  /** 可写路径列表（默认仅 worktree）。 */
  readonly file_writable_paths: readonly string[];
  /** 已脱敏的环境变量（token 已注入）。 */
  readonly env_vars: Readonly<Record<string, string>>;
  /** MCP 服务器配置。 */
  readonly mcp_servers: readonly Record<string, unknown>[];
}

/** MCP 服务器配置项。 */
export interface McpServerSpec {
  /** 服务器名称。 */
  readonly name: string;
  /** 启动命令。 */
  readonly command?: string;
  /** 参数列表。 */
  readonly args?: readonly string[];
  /** 环境变量规格（值可为 ${ENV_VAR} 占位符）。 */
  readonly env?: Readonly<Record<string, string>>;
  [key: string]: unknown;
}

/** host-owned 安全注入器（host_injection.py HostInjector）。 */
export class HostInjector {
  private readonly _credentialStore: CredentialStore;

  constructor(credentialStore: CredentialStore) {
    this._credentialStore = credentialStore;
  }

  /**
   * 注入 token / API key 到环境变量（不暴露给 plugin）。
   *
   * @throws {Error} 必需环境变量在 CredentialStore 中缺失时（ValueError 语义）。
   */
  injectCredentials(
    providerName: string,
    requiredEnvVars: readonly string[],
    extraEnv?: Readonly<Record<string, string>>,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    const missing: string[] = [];
    for (const varName of requiredEnvVars) {
      const value = this._credentialStore.get(varName);
      if (value === undefined) {
        missing.push(varName);
      } else {
        env[varName] = value;
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `HostInjector: provider=${providerName} missing required env vars: ` +
          `${missing.join(', ')}. 请检查 .env / CredentialStore 配置。`,
      );
    }
    if (extraEnv) {
      Object.assign(env, extraEnv);
    }
    return env;
  }

  /**
   * 注入 sandbox 配置（cwd / 网络白名单 / 文件权限）。
   * writable 默认仅 worktree 路径（EX-005 最小权限）。
   */
  injectSandbox(
    _providerName: string,
    worktreePath: string,
    networkAllowlist?: readonly string[],
    writablePaths?: readonly string[],
    readonlyPaths?: readonly string[],
  ): SandboxConfig {
    return {
      cwd: worktreePath,
      network_allowlist: [...(networkAllowlist ?? [])],
      file_readonly_paths: [...(readonlyPaths ?? [])],
      file_writable_paths: [...(writablePaths ?? [worktreePath])],
      env_vars: {},
      mcp_servers: [],
    };
  }

  /**
   * 注入 MCP 服务器配置（host 维护，plugin 只读）。
   * env 值若是 "${ENV_VAR}" 形式则从 CredentialStore 解析真实值，
   * 同时保留 env_keys 键名列表（脱敏）。
   */
  injectMcpConfig(
    providerName: string,
    mcpServers: readonly McpServerSpec[],
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown>[] = [];
    for (const server of mcpServers) {
      const copy: Record<string, unknown> = { ...server };
      const env = server.env;
      if (env !== undefined && typeof env === 'object') {
        copy.env_keys = Object.keys(env);
        copy.env = this._injectMcpEnv(providerName, env);
      }
      sanitized.push(copy);
    }
    return { mcp_servers: sanitized };
  }

  /** 解析 MCP env 规格：${ENV_VAR} → CredentialStore 真实值。 */
  private _injectMcpEnv(
    _providerName: string,
    spec: Readonly<Record<string, string>>,
  ): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(spec)) {
      if (value.startsWith('${') && value.endsWith('}')) {
        const envVar = value.slice(2, -1);
        const real = this._credentialStore.get(envVar);
        if (real !== undefined) {
          resolved[key] = real;
        } else {
          // 缺失时保留占位符原样（调用方决定是否告警）
          resolved[key] = value;
        }
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }
}
