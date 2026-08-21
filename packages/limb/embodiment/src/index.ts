/**
 * @flowforge/limb-embodiment — 阶段6 T6.4 具身绑定域 Cordis 插件
 *
 * 挂载 `ctx.limbEmbodiment`：LimbEmbodimentBindingStore（四肢节点 ↔
 * 用户/线程/猫 具身绑定）、limb-yaml-loader（插件 limbs/*.yml 声明加载，
 * 供 PluginLimbAdapter 使用）。存储默认 Memory，组合根注入 Redis 后端。
 */

import { Context, Service } from '@flowforge/cordis';
import {
  LimbEmbodimentBinding,
  LimbEmbodimentBindingStore,
  MemoryLimbEmbodimentBindingStore,
} from './limb-embodiment-binding-store.js';
import {
  LimbDeclaration,
  loadLimbDeclaration,
} from './limb-yaml-loader.js';

export { LimbEmbodimentBinding } from './limb-embodiment-binding-store.js';
export {
  LimbEmbodimentBindingStore,
  MemoryLimbEmbodimentBindingStore,
  RedisBindingLike,
  RedisLimbEmbodimentBindingStore,
} from './limb-embodiment-binding-store.js';
export {
  LimbAuthConfig,
  LimbCommandDef,
  LimbCommandParam,
  LimbDeclaration,
  LimbErrorConfig,
  loadLimbDeclaration,
} from './limb-yaml-loader.js';

export interface EmbodimentServiceOptions {
  /** 具身绑定存储（缺省 Memory；组合根注入 Redis 后端） */
  readonly store?: LimbEmbodimentBindingStore | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 四肢具身绑定域：绑定存储 + limbs YAML 声明加载 */
    limbEmbodiment: EmbodimentService;
  }
}

export class EmbodimentService extends Service {
  /** 具身绑定存储 */
  readonly store: LimbEmbodimentBindingStore;

  constructor(ctx: Context, options: EmbodimentServiceOptions = {}) {
    super(ctx, 'limbEmbodiment');
    this.store = options.store ?? new MemoryLimbEmbodimentBindingStore();
  }

  // ─── Binding store ──────────────────────────────────────────

  /** 按 nodeId 获取具身绑定 */
  getBinding(nodeId: string): Promise<LimbEmbodimentBinding | undefined> {
    return this.store.get(nodeId);
  }

  /** 按 threadId 获取该线程全部具身绑定 */
  getBindingsByThread(threadId: string): Promise<LimbEmbodimentBinding[]> {
    return this.store.getByThread(threadId);
  }

  /** 写入/更新具身绑定（校验；同 nodeId 覆盖） */
  putBinding(binding: LimbEmbodimentBinding): Promise<void> {
    return this.store.put(binding);
  }

  /** 移除具身绑定 */
  removeBinding(nodeId: string): Promise<void> {
    return this.store.remove(nodeId);
  }

  // ─── YAML loader ────────────────────────────────────────────

  /** 从 limbs/*.yml 加载插件四肢声明 */
  loadDeclaration(yamlPath: string): LimbDeclaration {
    return loadLimbDeclaration(yamlPath);
  }
}

export default function Plugin(ctx: Context, options?: EmbodimentServiceOptions) {
  return ctx.plugin(EmbodimentService, options);
}
