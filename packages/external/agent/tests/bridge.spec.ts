/**
 * bridge — ExternalAgentBridge 五步调用链测试（EX-003）。
 *
 * 语义对照 flowforge/core/external_agent/test_bridge.py：
 *   ① 选 Provider（preferred → discover → 默认链）
 *   ② 注入 shared_state_history 到 context
 *   ③ fallback 链调用（adapterFactory 优先）
 *   ④ 成功写 shared_state + 能力融合
 *   ⑤ 聚合成本（EX-006）
 *
 * @module @flowforge/external-agent/tests
 */

import { describe, expect, it } from 'vitest';
import { ACPTransport, InMemoryTransportBackend } from '../src/acp-transport.js';
import {
  type ExternalAgentResult,
  type ExternalAgentAdapter,
} from '../src/adapter.js';
import { ExternalAgentBridge, type AdapterFactory } from '../src/bridge.js';
import { ExternalAgentCapabilityFusion } from '../src/capability-fusion.js';
import { ExternalAgentFallback } from '../src/fallback.js';
import { EnvCredentialStore, InMemorySharedStateStore } from '../src/index.js';
import { HostInjector } from '../src/host-injection.js';
import { type AgentProviderManifest, normalizeManifest } from '../src/manifest.js';
import { ProviderTransportRegistry } from '../src/registry.js';
import { ExternalAgentSharedState } from '../src/shared-state.js';

/** 可编程 Adapter：按 provider 行为表返回结果。 */
class FakeAdapter implements ExternalAgentAdapter {
  readonly providerName: string;
  readonly manifest: AgentProviderManifest;
  readonly hostInjector: HostInjector;
  behavior: Record<string, ExternalAgentResult> = {};
  lastSandbox: unknown = null;

  constructor(manifest: AgentProviderManifest, hostInjector: HostInjector) {
    this.manifest = manifest;
    this.hostInjector = hostInjector;
    this.providerName = manifest.provider_name;
    this.behavior[manifest.provider_name] = {
      provider_name: manifest.provider_name,
      success: true,
      output: `output-of-${manifest.provider_name}`,
      cost: { total_tokens: 10, total_calls: 1, total_cost: 0.001 },
    };
  }

  async invoke(
    _task: string,
    _context: Record<string, unknown>,
    sandbox?: Parameters<ExternalAgentAdapter['invoke']>[2],
  ): Promise<ExternalAgentResult> {
    this.lastSandbox = sandbox;
    return this.behavior[this.providerName] ?? { provider_name: this.providerName, success: false, output: null, error: 'no behavior' };
  }

  async *stream(): AsyncIterable<string> {
    yield 'fake-stream';
  }

  getCapabilityProfile() {
    return {
      provider_name: this.providerName,
      display_name: this.manifest.display_name,
      capabilities: [...this.manifest.capabilities],
      blind_spots: [...this.manifest.blind_spots],
    };
  }

  prepareSandbox(worktreePath: string) {
    return this.hostInjector.injectSandbox(this.providerName, worktreePath);
  }

  prepareCredentials() {
    return this.hostInjector.injectCredentials(
      this.providerName,
      [...(this.manifest.required_env_vars ?? [])],
    );
  }
}

/** 组装完整 Bridge（可注入 registry / adapterFactory）。 */
function makeBridge(options: {
  manifests?: AgentProviderManifest[];
  adapterFactory?: AdapterFactory;
  retryMaxAttempts?: number;
} = {}) {
  const registry = new ProviderTransportRegistry();
  for (const manifest of options.manifests ?? []) {
    registry.register(manifest);
  }
  const hostInjector = new HostInjector(new EnvCredentialStore());
  const transport = new ACPTransport(new InMemoryTransportBackend());
  const fallback = new ExternalAgentFallback(options.retryMaxAttempts ?? 1, 0.001);
  const fusion = new ExternalAgentCapabilityFusion({
    min_invocations: 1,
    min_success_rate: 0.0,
  });
  const sharedState = new ExternalAgentSharedState(new InMemorySharedStateStore());
  const bridge = new ExternalAgentBridge({
    registry,
    hostInjector,
    transport,
    fallback,
    fusion,
    sharedState,
    ...(options.adapterFactory !== undefined
      ? { adapterFactory: options.adapterFactory }
      : {}),
  });
  return { bridge, registry, sharedState, hostInjector };
}

function makeManifest(providerName: string, capabilities: string[] = ['code-gen']): AgentProviderManifest {
  return normalizeManifest({
    provider_name: providerName,
    display_name: providerName,
    capabilities,
  });
}

describe('ExternalAgentBridge.invoke（bridge.py 五步调用链）', () => {
  it('首选 Provider 成功：winning_provider 正确 + 结果透传', async () => {
    const adapterFactory: AdapterFactory = (manifest) => new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b'), makeManifest('c.d')],
      adapterFactory,
    });
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 'do something',
      preferred_providers: ['c.d'],
    });
    expect(response.success).toBe(true);
    expect(response.winning_provider).toBe('c.d');
    expect(response.result).toEqual({
      success: true,
      result: 'output-of-c.d',
      cost: { total_tokens: 10, total_calls: 1, total_cost: 0.001 },
      provider: 'c.d',
      error: undefined,
    });
    expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('② context 注入 shared_state_history', async () => {
    let seenContext: Record<string, unknown> | undefined;
    const adapterFactory: AdapterFactory = (manifest) => {
      const adapter = new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
      const original = adapter.invoke.bind(adapter);
      adapter.invoke = async (task, context, sandbox) => {
        seenContext = context;
        return original(task, context, sandbox);
      };
      return adapter;
    };
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b')],
      adapterFactory,
    });
    await bridge.invoke({ forgekin_id: 'fk-1', task: 't', preferred_providers: ['a.b'] });
    expect(Array.isArray(seenContext?.['shared_state_history'])).toBe(true);
  });

  it('首选失败 → fallback 到下一个 Provider（③ fallback 链）', async () => {
    const adapterFactory: AdapterFactory = (manifest) => {
      const adapter = new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
      if (manifest.provider_name === 'a.b') {
        adapter.behavior['a.b'] = { provider_name: 'a.b', success: false, output: null, error: 'boom' };
      }
      return adapter;
    };
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b'), makeManifest('c.d')],
      adapterFactory,
      retryMaxAttempts: 1,
    });
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: ['a.b', 'c.d'],
    });
    expect(response.success).toBe(true);
    expect(response.winning_provider).toBe('c.d');
    expect(response.fallback_attempts).toHaveLength(2);
  });

  it('全部失败 → success=false（attempts 记录全部尝试）', async () => {
    const adapterFactory: AdapterFactory = (manifest) => {
      const adapter = new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
      adapter.behavior[manifest.provider_name] = {
        provider_name: manifest.provider_name,
        success: false,
        output: null,
        error: 'all down',
      };
      return adapter;
    };
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b')],
      adapterFactory,
      retryMaxAttempts: 1,
    });
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: ['a.b'],
    });
    expect(response.success).toBe(false);
    expect(response.winning_provider).toBe('');
    expect(response.fallback_attempts).toHaveLength(1);
    expect(response.fallback_attempts[0]!['error']).toBe('all down');
  });

  it('无可用 Provider → success=false 且不调用 adapter', async () => {
    let invoked = false;
    const adapterFactory: AdapterFactory = (manifest) => {
      const adapter = new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
      const original = adapter.invoke.bind(adapter);
      adapter.invoke = async (task, context, sandbox) => {
        invoked = true;
        return original(task, context, sandbox);
      };
      return adapter;
    };
    const { bridge } = makeBridge({ adapterFactory }); // registry 为空
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: [],
    });
    expect(response.success).toBe(false);
    expect(response.winning_provider).toBe('');
    expect(invoked).toBe(false);
  });

  it('④a 成功写入 shared_state（listHistory 可见）', async () => {
    const adapterFactory: AdapterFactory = (manifest) => new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
    const { bridge, sharedState } = makeBridge({
      manifests: [makeManifest('a.b')],
      adapterFactory,
    });
    await bridge.invoke({ forgekin_id: 'fk-1', task: 't', preferred_providers: ['a.b'] });
    const history = await sharedState.listHistory('fk-1');
    expect(history).toHaveLength(1);
    expect(history[0]!.provider_name).toBe('a.b');
    expect(history[0]!.decision_context).toBeDefined();
  });

  it('④b 成功触发能力融合（fusion_result.fused=true）', async () => {
    const adapterFactory: AdapterFactory = (manifest) => new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b', ['code-gen', 'review'])],
      adapterFactory,
    });
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: ['a.b'],
      context: {
        invocation_count: 3,
        success_rate: 0.9,
        forgekin_profile: { forgekin_id: 'fk-1', capabilities: ['code-gen'] },
      },
    });
    expect(response.fusion_result?.fused).toBe(true);
    // 完整合并列表（forgekin + external，不去重）
    expect(response.fusion_result?.fused_capabilities).toEqual([
      'code-gen',
      'code-gen',
      'review',
    ]);
  });

  it('⑤ 成本聚合（EX-006）', async () => {
    const adapterFactory: AdapterFactory = (manifest) => new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b')],
      adapterFactory,
    });
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: ['a.b'],
    });
    expect(response.cost['total_tokens']).toBe(10);
    expect(response.cost['total_calls']).toBe(1);
    expect(response.cost['total_cost']).toBe(0.001);
    expect(response.cost['attempts']).toBe(1);
  });

  it('worktree_root 注入 sandbox 到 adapter（host-owned）', async () => {
    const adapters = new Map<string, FakeAdapter>();
    const adapterFactory: AdapterFactory = (manifest) => {
      const adapter = new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
      adapters.set(manifest.provider_name, adapter);
      return adapter;
    };
    const { bridge } = makeBridge({
      manifests: [makeManifest('a.b')],
      adapterFactory,
    });
    await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: ['a.b'],
      worktree_root: '/tmp/wt-1',
    });
    const sandbox = adapters.get('a.b')?.lastSandbox as { cwd: string } | null;
    expect(sandbox).not.toBeNull();
    expect(sandbox?.cwd).toBe('/tmp/wt-1');
  });

  it('未注册 Provider 直接返回失败（_invokeSingle 校验）', async () => {
    const adapterFactory: AdapterFactory = (manifest) => new FakeAdapter(manifest, new HostInjector(new EnvCredentialStore()));
    const { bridge } = makeBridge({ adapterFactory });
    const response = await bridge.invoke({
      forgekin_id: 'fk-1',
      task: 't',
      preferred_providers: ['ghost.provider'],
    });
    expect(response.success).toBe(false);
    expect(response.fallback_attempts[0]!['error']).toContain('not registered');
  });
});

describe('ExternalAgentBridge 发现与列表', () => {
  it('listAvailableProviders 返回注册的全部 Provider', () => {
    const { bridge } = makeBridge({ manifests: [makeManifest('a.b'), makeManifest('c.d')] });
    const providers = bridge.listAvailableProviders();
    expect(providers.map((p) => p['provider_name'])).toEqual(['a.b', 'c.d']);
  });

  it('discoverProviders 按能力过滤（EX-008）', () => {
    const { bridge } = makeBridge({
      manifests: [
        makeManifest('a.b', ['code-gen']),
        makeManifest('c.d', ['deploy']),
      ],
    });
    const found = bridge.discoverProviders('deploy');
    expect(found).toHaveLength(1);
    expect(found[0]!['provider_name']).toBe('c.d');
  });

  it('stream 走 ACPTransport（EX-009）', async () => {
    const { bridge } = makeBridge({ manifests: [makeManifest('a.b')] });
    const chunks: string[] = [];
    for await (const chunk of bridge.stream('a.b', 't')) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toContain('[acp:a.b:stream]');
  });
});
