/**
 * @flowforge/plugins-github — GitHub 上游参考插件（C35）。
 *
 * TS 移植自 clowder-ai `plugins/github/plugin.yaml`：manifest 装配声明 +
 * config 三环境变量 + 7 个 schedule 工厂声明。实现侧对应 flowforge 已移植的
 * infrastructure 域：github.cicd-check / conflict-check / review-feedback /
 * issue-tracking → @flowforge/infrastructure-email 的 create*TaskSpec；
 * repo-scan / repo-comment-poll / community-reconciler 为可选声明（对端
 * 尚未移植时跳过）。
 *
 * @module @flowforge/plugins-github
 */

import { Context, Service } from '@flowforge/cordis';

import { resolveGithubPluginConfig, summarizeGithubPluginConfig } from './config.ts';
import type { GithubPluginConfigResult, GithubPluginConfigValues } from './config.ts';
import { GITHUB_PLUGIN_MANIFEST, GITHUB_SCHEDULE_RESOURCES } from './manifest.ts';
import type { GithubPluginManifest, GithubScheduleResource } from './manifest.ts';

export {
  resolveGithubPluginConfig,
  summarizeGithubPluginConfig,
  type GithubPluginConfigResult,
  type GithubPluginConfigValues,
} from './config.ts';
export {
  GITHUB_CONFIG_FIELDS,
  GITHUB_PLUGIN_MANIFEST,
  GITHUB_SCHEDULE_RESOURCES,
  type GithubConfigField,
  type GithubPluginManifest,
  type GithubScheduleResource,
} from './manifest.ts';

export interface GithubPluginConfig {
  env?: NodeJS.ProcessEnv;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** GitHub 上游参考插件（C35）：manifest + config + schedule 工厂声明。 */
    forgeGithubPlugin: ForgeGithubPluginService;
  }
}

/** factoryId → 对应 flowforge infrastructure 实现说明（装配接线元数据）。 */
export const GITHUB_SCHEDULE_FACTORY_TARGETS: Readonly<Record<string, string>> = {
  'github.cicd-check': '@flowforge/infrastructure-email createCiCdCheckTaskSpec',
  'github.conflict-check': '@flowforge/infrastructure-email createConflictCheckTaskSpec',
  'github.review-feedback': '@flowforge/infrastructure-email createReviewFeedbackTaskSpec',
  'github.issue-tracking': '@flowforge/infrastructure-email createIssueCommentTaskSpec',
  'github.repo-scan': 'upstream connectors/RepoScanTaskSpec (not yet ported)',
  'github.repo-comment-poll': 'upstream connectors/RepoCommentPollTaskSpec (not yet ported)',
  'github.community-reconciler': 'upstream community/CommunityReconcilerTaskSpec (not yet ported)',
};

export class ForgeGithubPluginService extends Service {
  readonly manifest: GithubPluginManifest;
  readonly config: GithubPluginConfigResult;
  readonly configValues: GithubPluginConfigValues;
  readonly scheduleResources: readonly GithubScheduleResource[];

  constructor(ctx: Context, config: GithubPluginConfig = {}) {
    super(ctx, 'forgeGithubPlugin');
    this.manifest = GITHUB_PLUGIN_MANIFEST;
    this.config = resolveGithubPluginConfig(config.env ? { env: config.env } : {});
    this.configValues = this.config.values;
    this.scheduleResources = GITHUB_SCHEDULE_RESOURCES;
  }

  /** 摘要视图（sensitive 字段只输出 configured 布尔）。 */
  summary(): Record<string, unknown> {
    return summarizeGithubPluginConfig(this.config);
  }

  /** 按 name 查 schedule 资源。 */
  getScheduleResource(name: string): GithubScheduleResource | undefined {
    return this.scheduleResources.find((resource) => resource.name === name);
  }

  /** factoryId 是否指向已移植实现（可装配）；未移植的可选声明返回 false。 */
  isFactoryWired(factoryId: string): boolean {
    const target = GITHUB_SCHEDULE_FACTORY_TARGETS[factoryId];
    return target !== undefined && !target.includes('not yet ported');
  }
}

export default ForgeGithubPluginService;
