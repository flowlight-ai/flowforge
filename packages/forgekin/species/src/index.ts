/**
 * @flowforge/forgekin-species — 阶段7 T7.25 物种体系域 Cordis 插件
 *
 * 挂载 `ctx.forgeSpecies`：Forgekin 五形态体系（bio/org/obj/virtual/hybrid）
 * 的枚举、数据模型、注册表、抽象基类、锻造表单与形态工厂。
 *
 * TS 移植自 `forgemind/{base,forgekin,registry,species}.py` + `species_impl/`。
 * 一切皆插件：形态构造器经 SpeciesFactoryRegistry 静态注册（替代 Python
 * importlib 动态导入），可由上层插件 register 扩展新形态。
 */
import { Context, Service } from '@flowforge/cordis';
import { ForgekinBase } from './base.js';
import { SPECIES_FACTORY_METADATA, SpeciesFactoryRegistry } from './factory.js';
import { ForgekinRegistry } from './registry.js';
import { ForgekinSpecies } from './species-enum.js';

export * from './base.js';
export * from './factory.js';
export * from './forms.js';
export * from './models.js';
export * from './registry.js';
export * from './species-enum.js';
export * from './impl/bio.js';
export * from './impl/hybrid.js';
export * from './impl/obj.js';
export * from './impl/org.js';
export * from './impl/virtual.js';

export interface SpeciesServiceOptions {
  /** 预创建的数据注册表（缺省进程级默认注册表；跨插件共享时可注入） */
  readonly registry?: ForgekinRegistry | undefined;
  /** 预创建的形态工厂注册表（缺省内置五形态；可先 register 自定义形态再注入） */
  readonly factory?: SpeciesFactoryRegistry | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 物种体系域：五形态枚举/数据注册表/工厂/锻造表单门面 */
    forgeSpecies: SpeciesService;
  }
}

export class SpeciesService extends Service {
  /** Forgekin 数据注册表（对齐 Python registry：按 forgekin_id 索引 Forgekin 数据模型） */
  readonly registry: ForgekinRegistry;
  /** 形态构造器工厂注册表（插件扩展点） */
  readonly factory: SpeciesFactoryRegistry;
  /** 活实例表（forgekin_id → ForgekinBase，由工厂锻造产出） */
  private readonly instances = new Map<string, ForgekinBase>();

  constructor(ctx: Context, options: SpeciesServiceOptions = {}) {
    super(ctx, 'forgeSpecies');
    this.registry = options.registry ?? new ForgekinRegistry();
    this.factory = options.factory ?? new SpeciesFactoryRegistry();
  }

  // ── 工厂门面 ────────────────────────────────────────────────────

  /** 按形态实例化 Forgekin（经形态工厂注册表分发） */
  create(species: ForgekinSpecies, init: Record<string, unknown>): ForgekinBase {
    return this.factory.create(species, init);
  }

  /** 注册/覆盖某形态的构造器（插件扩展点，替代 Python importlib 动态导入） */
  registerSpecies(species: ForgekinSpecies, constructor: (init: Record<string, unknown>) => ForgekinBase): void {
    this.factory.register(species, constructor);
  }

  /** 五形态构造器谱系元数据（module + class_name，对齐 config/forging.yaml:species_factory） */
  speciesMetadata(species: ForgekinSpecies): { module: string; class_name: string } {
    return SPECIES_FACTORY_METADATA[species];
  }

  // ── 活实例门面 ──────────────────────────────────────────────────

  /** 锻造一个活实例并收入实例表（重复 forgekin_id 抛错） */
  spawn(species: ForgekinSpecies, init: Record<string, unknown>): ForgekinBase {
    const instance = this.factory.create(species, init);
    if (this.instances.has(instance.forgekinId)) {
      throw new Error(`活实例表中已存在 forgekin_id=${instance.forgekinId}——请先 remove 再重铸。`);
    }
    this.instances.set(instance.forgekinId, instance);
    return instance;
  }

  /** 登记外部锻造产出的活实例（如 forging 流水线的产物） */
  adopt(instance: ForgekinBase): void {
    if (this.instances.has(instance.forgekinId)) {
      throw new Error(`活实例表中已存在 forgekin_id=${instance.forgekinId}——请先 remove 再重铸。`);
    }
    this.instances.set(instance.forgekinId, instance);
  }

  /** 按 ID 查询活实例（不存在抛错） */
  get(forgekinId: string): ForgekinBase {
    const found = this.instances.get(forgekinId);
    if (found === undefined) {
      throw new Error(`活实例表中不存在 forgekin_id=${forgekinId} 的 Forgekin`);
    }
    return found;
  }

  /** 注销某活实例（不存在抛错） */
  remove(forgekinId: string): ForgekinBase {
    const found = this.instances.get(forgekinId);
    if (found === undefined) {
      throw new Error(`活实例表中不存在 forgekin_id=${forgekinId} 的 Forgekin`);
    }
    this.instances.delete(forgekinId);
    return found;
  }

  /** 列出所有活实例（按注册顺序） */
  listInstances(): ForgekinBase[] {
    return [...this.instances.values()];
  }

  /** 快照（trace 日志）：数据注册表 + 活实例统计 */
  snapshot(): {
    registered: number;
    active: number;
    instances: number;
    speciesKnown: ForgekinSpecies[];
  } {
    return {
      registered: this.registry.count(),
      active: this.registry.listActive().length,
      instances: this.instances.size,
      speciesKnown: [
        ForgekinSpecies.BIO,
        ForgekinSpecies.ORG,
        ForgekinSpecies.OBJ,
        ForgekinSpecies.VIRTUAL,
        ForgekinSpecies.HYBRID,
      ],
    };
  }
}

export default function Plugin(ctx: Context, options?: SpeciesServiceOptions) {
  return ctx.plugin(SpeciesService, options);
}
