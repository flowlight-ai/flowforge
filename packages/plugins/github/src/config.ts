/**
 * GitHub 上游参考插件 config 解析与校验（C35）。
 *
 * 环境变量 → 类型化 config；按 envName 查 manifest 字段定义做 presence
 * 校验（required），sensitive 字段不进摘要输出。`resolveConfig` 同时支持
 * 注入 env 覆盖（测试/宿主接线）。
 */

import { GITHUB_CONFIG_FIELDS } from './manifest.ts';

export interface GithubPluginConfigValues {
  githubToken: string | undefined;
  noiseBotLogins: readonly string[];
  mcpPat: string | undefined;
}

export interface GithubPluginConfigResult {
  values: GithubPluginConfigValues;
  missingRequired: readonly string[];
  configured: boolean;
}

export interface GithubPluginConfigOptions {
  env?: NodeJS.ProcessEnv;
}

function readString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value === '') return undefined;
  return value;
}

/** 逗号/换行分隔的登录名列表 → 去空数组。 */
function readLoginList(env: NodeJS.ProcessEnv, name: string): readonly string[] {
  const raw = readString(env, name);
  if (!raw) return [];
  return raw
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function resolveGithubPluginConfig(options: GithubPluginConfigOptions = {}): GithubPluginConfigResult {
  const env = options.env ?? process.env;
  const values: GithubPluginConfigValues = {
    githubToken: readString(env, 'GITHUB_TOKEN'),
    noiseBotLogins: readLoginList(env, 'GITHUB_SETUP_NOISE_BOT_LOGINS'),
    mcpPat: readString(env, 'GITHUB_MCP_PAT'),
  };

  const requiredByName = new Map(
    GITHUB_CONFIG_FIELDS.filter((field) => field.required).map((field) => [field.envName, field]),
  );
  const missingRequired: string[] = [];
  if (requiredByName.has('GITHUB_TOKEN') && values.githubToken === undefined) missingRequired.push('GITHUB_TOKEN');
  if (requiredByName.has('GITHUB_MCP_PAT') && values.mcpPat === undefined) missingRequired.push('GITHUB_MCP_PAT');

  return {
    values,
    missingRequired,
    configured: values.githubToken !== undefined || values.mcpPat !== undefined,
  };
}

/** 隐藏敏感字段的摘要视图（用于状态面板，不落盘 token）。 */
export function summarizeGithubPluginConfig(result: GithubPluginConfigResult): Record<string, unknown> {
  return {
    githubTokenConfigured: result.values.githubToken !== undefined,
    noiseBotLogins: result.values.noiseBotLogins,
    mcpPatConfigured: result.values.mcpPat !== undefined,
    configured: result.configured,
    missingRequired: result.missingRequired,
  };
}
