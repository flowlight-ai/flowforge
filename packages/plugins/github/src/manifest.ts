/**
 * GitHub 上游参考插件 manifest（C35，装配声明移植）。
 *
 * clowder `plugins/github/plugin.yaml` → TS 强类型 manifest：id/name/version/
 * description/setupSteps + config 三环境变量（GITHUB_TOKEN /
 * GITHUB_SETUP_NOISE_BOT_LOGINS / GITHUB_MCP_PAT）+ 7 个 schedule 资源声明
 * （factoryId 与 packages/infrastructure/email 等已移植实现对应）。
 */

/** 与 clowder plugin.yaml config 条目对应的字段。 */
export interface GithubConfigField {
  envName: string;
  label: string;
  sensitive: boolean;
  required: boolean;
  type?: 'string' | 'select' | 'boolean';
  options?: Array<{ value: string; label: string; hint?: string; docsUrl?: string }>;
  docsUrl?: string;
}

export interface GithubScheduleResource {
  type: 'schedule';
  name: string;
  factoryId: string;
  optional?: boolean;
}

export interface GithubPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  docsUrl: string;
  setupSteps: string[];
  config: readonly GithubConfigField[];
  resources: readonly GithubScheduleResource[];
}

export const GITHUB_CONFIG_FIELDS: readonly GithubConfigField[] = [
  {
    envName: 'GITHUB_TOKEN',
    label: 'Personal Access Token',
    sensitive: true,
    required: false,
  },
  {
    envName: 'GITHUB_SETUP_NOISE_BOT_LOGINS',
    label: 'Noise Bot Login List',
    sensitive: false,
    required: false,
  },
  {
    envName: 'GITHUB_MCP_PAT',
    label: 'MCP Token',
    sensitive: true,
    required: false,
  },
];

/** 7 个 schedule 工厂声明（与 clowder plugin.yaml resources 一致）。 */
export const GITHUB_SCHEDULE_RESOURCES: readonly GithubScheduleResource[] = [
  { type: 'schedule', name: 'cicd-check', factoryId: 'github.cicd-check' },
  { type: 'schedule', name: 'conflict-check', factoryId: 'github.conflict-check' },
  { type: 'schedule', name: 'review-feedback', factoryId: 'github.review-feedback' },
  { type: 'schedule', name: 'repo-scan', factoryId: 'github.repo-scan', optional: true },
  { type: 'schedule', name: 'issue-tracking', factoryId: 'github.issue-tracking' },
  { type: 'schedule', name: 'repo-comment-poll', factoryId: 'github.repo-comment-poll', optional: true },
  { type: 'schedule', name: 'community-reconciler', factoryId: 'github.community-reconciler', optional: true },
];

export const GITHUB_PLUGIN_MANIFEST: GithubPluginManifest = {
  id: 'github',
  name: 'GitHub',
  version: '1.0.0',
  description: 'GitHub PR tracking, CI/CD monitoring, conflict detection, and repository scanning',
  icon: 'github',
  docsUrl: 'https://cli.github.com/manual/gh_auth_login',
  setupSteps: [
    'Log in with the GitHub CLI (`gh auth login`) on the machine running FlowForge',
    'Optional: configure a token only for plugin-managed child processes that explicitly consume it',
    'Optional: configure Noise Bot list to reduce setup-only comment noise',
  ],
  config: GITHUB_CONFIG_FIELDS,
  resources: GITHUB_SCHEDULE_RESOURCES,
};
