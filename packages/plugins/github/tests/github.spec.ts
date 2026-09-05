/**
 * github 上游参考插件测试 — C35（manifest + config 解析 + schedule 工厂声明 + Service）。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeGithubPluginService, {
  GITHUB_CONFIG_FIELDS,
  GITHUB_PLUGIN_MANIFEST,
  GITHUB_SCHEDULE_FACTORY_TARGETS,
  GITHUB_SCHEDULE_RESOURCES,
  resolveGithubPluginConfig,
  summarizeGithubPluginConfig,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('GITHUB_PLUGIN_MANIFEST', () => {
  it('manifest 结构：id/version/config/7 个 schedule 资源', () => {
    expect(GITHUB_PLUGIN_MANIFEST.id).toBe('github');
    expect(GITHUB_PLUGIN_MANIFEST.name).toBe('GitHub');
    expect(GITHUB_PLUGIN_MANIFEST.config).toHaveLength(3);
    expect(GITHUB_PLUGIN_MANIFEST.resources).toHaveLength(7);
    expect(GITHUB_CONFIG_FIELDS.map((field) => field.envName)).toEqual([
      'GITHUB_TOKEN',
      'GITHUB_SETUP_NOISE_BOT_LOGINS',
      'GITHUB_MCP_PAT',
    ]);
    const factoryIds = GITHUB_SCHEDULE_RESOURCES.map((resource) => resource.factoryId);
    expect(factoryIds).toContain('github.cicd-check');
    expect(factoryIds).toContain('github.repo-scan');
    // 每个 factoryId 都有装配目标元数据
    for (const factoryId of factoryIds) {
      expect(GITHUB_SCHEDULE_FACTORY_TARGETS[factoryId]).toBeTruthy();
    }
  });
});

describe('resolveGithubPluginConfig', () => {
  it('无 env → 未配置 + 无缺省 required 缺失', () => {
    const result = resolveGithubPluginConfig({ env: {} });
    expect(result.configured).toBe(false);
    expect(result.missingRequired).toEqual([]);
    expect(result.values.githubToken).toBeUndefined();
    expect(result.values.noiseBotLogins).toEqual([]);
  });

  it('GITHUB_TOKEN 注入 → configured + 摘要隐藏明文', () => {
    const result = resolveGithubPluginConfig({ env: { GITHUB_TOKEN: 'ghp_secret' } });
    expect(result.configured).toBe(true);
    expect(result.values.githubToken).toBe('ghp_secret');
    const summary = summarizeGithubPluginConfig(result);
    expect(summary.githubTokenConfigured).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('ghp_secret');
  });

  it('噪声机器人列表：逗号/换行分隔 → 数组；空值忽略', () => {
    const result = resolveGithubPluginConfig({
      env: { GITHUB_SETUP_NOISE_BOT_LOGINS: 'bot-a, bot-b\n\nbot-c' },
    });
    expect(result.values.noiseBotLogins).toEqual(['bot-a', 'bot-b', 'bot-c']);
  });

  it('空字符串 token 视为未配置', () => {
    const result = resolveGithubPluginConfig({ env: { GITHUB_TOKEN: '' } });
    expect(result.values.githubToken).toBeUndefined();
  });
});

describe('ForgeGithubPluginService（Cordis 插件）', () => {
  it('挂载 ctx.forgeGithubPlugin + 资源查询 + factory 装配判定', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeGithubPluginService, {
      env: { GITHUB_TOKEN: 'ghp_1', GITHUB_SETUP_NOISE_BOT_LOGINS: 'bot' },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeGithubPlugin;
    expect(svc).toBeDefined();
    expect(svc.manifest.id).toBe('github');
    expect(svc.configValues.githubToken).toBe('ghp_1');
    expect(svc.getScheduleResource('cicd-check')?.factoryId).toBe('github.cicd-check');
    expect(svc.isFactoryWired('github.cicd-check')).toBe(true);
    expect(svc.isFactoryWired('github.repo-scan')).toBe(false);

    const summary = svc.summary();
    expect(summary).not.toContain('ghp_1');
  });
});
