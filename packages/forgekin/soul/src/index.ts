/**
 * @flowforge/forgekin-soul — 阶段7 T7.1 灵魂印记域 Cordis 插件
 *
 * 挂载 `ctx.forgeSoul`：SoulImprint 锻造/校验/登记（内存注册表按 namespace 隔离，
 * 组合根可注入持久化后端）。对齐 Python `forgemind/soul_imprint.py` 语义：
 * 不可变身份 + 哈希稳定性 + 命名空间隔离。
 */

import { Context, Service } from '@flowforge/cordis';
import {
  forgeSoulImprint,
  SoulImprint,
  validateSoulImprintInput,
  verifySoulImprint,
} from './soul-imprint.js';

export { SoulImprint } from './soul-imprint.js';
export {
  computeSoulHash,
  forgeSoulImprint,
  stableJson,
  validateSoulImprintInput,
  verifySoulImprint,
} from './soul-imprint.js';

/** SoulImprint 注册表后端（组合根可注入 SQLite/Redis 持久化） */
export interface SoulImprintRegistry {
  /** 登记一个 SoulImprint（同 namespace+hash 幂等覆盖） */
  put(imprint: SoulImprint): Promise<void>;
  /** 按 imprintHash 查询 */
  get(hash: string): Promise<SoulImprint | undefined>;
  /** 按 namespace 列出全部印记 */
  listByNamespace(namespace: string): Promise<SoulImprint[]>;
}

/** 内存注册表（默认后端） */
export class MemorySoulImprintRegistry implements SoulImprintRegistry {
  private readonly entries = new Map<string, SoulImprint>();

  async put(imprint: SoulImprint): Promise<void> {
    this.entries.set(imprint.imprintHash, imprint);
  }

  async get(hash: string): Promise<SoulImprint | undefined> {
    return this.entries.get(hash);
  }

  async listByNamespace(namespace: string): Promise<SoulImprint[]> {
    return [...this.entries.values()].filter((i) => i.namespace === namespace);
  }
}

export interface SoulServiceOptions {
  /** 印记注册表（缺省 Memory；组合根注入持久化后端） */
  readonly registry?: SoulImprintRegistry | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 灵魂印记域：SoulImprint 锻造/校验/登记 */
    forgeSoul: SoulService;
  }
}

export class SoulService extends Service {
  readonly registry: SoulImprintRegistry;

  constructor(ctx: Context, options: SoulServiceOptions = {}) {
    super(ctx, 'forgeSoul');
    this.registry = options.registry ?? new MemorySoulImprintRegistry();
  }

  /** 锻造一个新 SoulImprint（自动计算哈希；命名空间隔离） */
  async forge(
    seedParams: Readonly<Record<string, unknown>>,
    valueAnchors: readonly string[],
    namespace: string,
  ): Promise<SoulImprint> {
    validateSoulImprintInput(namespace, valueAnchors);
    const imprint = forgeSoulImprint(seedParams, valueAnchors, namespace);
    await this.registry.put(imprint);
    return imprint;
  }

  /** 校验印记哈希一致性（被篡改/损坏返回 false，谱系追踪应中止） */
  verify(imprint: SoulImprint): boolean {
    return verifySoulImprint(imprint);
  }

  /** 按哈希查询已登记的印记 */
  get(hash: string): Promise<SoulImprint | undefined> {
    return this.registry.get(hash);
  }

  /** 按命名空间列出印记 */
  listByNamespace(namespace: string): Promise<SoulImprint[]> {
    return this.registry.listByNamespace(namespace);
  }
}

export default function Plugin(ctx: Context, options?: SoulServiceOptions) {
  return ctx.plugin(SoulService, options);
}
