/**
 * @flowforge/limb-node — 阶段6 T6.2 四肢节点域 Cordis 插件
 *
 * 挂载 `ctx.limbNodes`：RemoteLimbNode（远端 HTTP 节点代理）、
 * PluginLimbAdapter（YAML 声明驱动的插件四肢）、PluginRestExecutor、
 * PluginTokenManager（client_credentials 令牌，Redis 缓存 + single-flight）。
 * 组合根可注入 LimbRegistry，registerNode 时同步进入注册表。
 */

import { Context, Service } from '@flowforge/cordis';
import type { ILimbNode, LimbNodeRecord } from '@flowforge/limb-core';
import { LimbRegistry } from '@flowforge/limb-core';
import type { LimbDeclaration } from '@flowforge/limb-embodiment';
import { PluginLimbAdapter, PluginLimbAdapterConfig } from './plugin-limb-adapter.js';
import type { RedisTokenLike } from './plugin-token-manager.js';
import { RemoteLimbNode, RemoteLimbNodeConfig } from './remote-limb-node.js';

export { InvokeContext, InvokeHandler, PluginLimbAdapter, PluginLimbAdapterConfig } from './plugin-limb-adapter.js';
export { PluginRestExecutor, RestApiError } from './plugin-rest-executor.js';
export { PluginTokenManager, RedisTokenLike } from './plugin-token-manager.js';
export { RemoteLimbNode, RemoteLimbNodeConfig } from './remote-limb-node.js';

export interface LimbNodeServiceOptions {
  /** 注入四肢注册表后，registerNode() 同步注册（组合根装配） */
  readonly registry?: LimbRegistry | undefined;
  /** 供 PluginTokenManager 共享的 Redis 缓存后端 */
  readonly tokenRedis?: RedisTokenLike | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 四肢节点域：远端节点/插件适配器工厂 + 生命周期管理 */
    limbNodes: LimbNodeService;
  }
}

export class LimbNodeService extends Service {
  /** 注入的四肢注册表（可选） */
  readonly registry: LimbRegistry | undefined;
  private readonly tokenRedis: RedisTokenLike | undefined;
  private readonly nodes = new Map<string, ILimbNode>();

  constructor(ctx: Context, options: LimbNodeServiceOptions = {}) {
    super(ctx, 'limbNodes');
    this.registry = options.registry;
    this.tokenRedis = options.tokenRedis;
  }

  // ─── Factories ─────────────────────────────────────────────

  /** 创建远端 HTTP 四肢节点代理 */
  createRemoteNode(config: RemoteLimbNodeConfig): RemoteLimbNode {
    const node = new RemoteLimbNode(config);
    this.nodes.set(config.nodeId, node);
    return node;
  }

  /** 创建 YAML 声明驱动的插件四肢适配器 */
  createPluginAdapter(config: PluginLimbAdapterConfig): PluginLimbAdapter {
    const adapter = new PluginLimbAdapter(config);
    this.nodes.set(config.declaration.nodeId, adapter);
    return adapter;
  }

  /** 从 limbs/*.yml 声明创建插件四肢适配器 */
  createPluginAdapterFromDeclaration(
    declaration: LimbDeclaration,
    pluginConfig: Record<string, string>,
    handlers?: PluginLimbAdapterConfig['handlers'],
  ): PluginLimbAdapter {
    const config: PluginLimbAdapterConfig = { declaration, pluginConfig };
    if (this.tokenRedis !== undefined) config.redis = this.tokenRedis;
    if (handlers !== undefined) config.handlers = handlers;
    return this.createPluginAdapter(config);
  }

  // ─── Registry integration ──────────────────────────────────

  /** 登记节点并（若注入 registry）同步注册 */
  async registerNode(node: ILimbNode): Promise<LimbNodeRecord | undefined> {
    this.nodes.set(node.nodeId, node);
    if (this.registry) {
      return this.registry.register(node);
    }
    return undefined;
  }

  /** 注销节点（registry 存在时同步注销） */
  deregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.registry?.deregister(nodeId);
  }

  /** 取回已创建/登记的节点 */
  getNode(nodeId: string): ILimbNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** 列出全部节点实例 */
  listNodes(): ILimbNode[] {
    return [...this.nodes.values()];
  }
}

export default function Plugin(ctx: Context, options?: LimbNodeServiceOptions) {
  return ctx.plugin(LimbNodeService, options);
}
