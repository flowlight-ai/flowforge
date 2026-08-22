/**
 * @flowforge/forgekin-species — 形态构造器工厂注册表
 *
 * 替代 Python `importlib.import_module` 动态导入（TS 插件化）：
 * `species_factory` 配置中的模块/类名映射到已静态导入的构造器。
 * 可通过 registerSpeciesConstructor 注册自定义形态构造器（插件扩展点）。
 *
 * @module @flowforge/forgekin-species
 */

import type { ForgekinBase } from './base.js';
import { BioForgekin, type BioForgekinInit } from './impl/bio.js';
import { HybridForgekin, type HybridForgekinInit } from './impl/hybrid.js';
import { ObjForgekin, type ObjForgekinInit } from './impl/obj.js';
import { OrgForgekin, type OrgForgekinInit } from './impl/org.js';
import { VirtualForgekin, type VirtualForgekinInit } from './impl/virtual.js';
import { ForgekinSpecies } from './species-enum.js';

/** 形态构造器签名（通用 init 字典，形态专属字段按需读取） */
export type SpeciesConstructor = (init: Record<string, unknown>) => ForgekinBase;

const bioCtor: SpeciesConstructor = (init) => new BioForgekin(init as unknown as BioForgekinInit);
const orgCtor: SpeciesConstructor = (init) => new OrgForgekin(init as unknown as OrgForgekinInit);
const objCtor: SpeciesConstructor = (init) => new ObjForgekin(init as unknown as ObjForgekinInit);
const virtualCtor: SpeciesConstructor = (init) => new VirtualForgekin(init as unknown as VirtualForgekinInit);
const hybridCtor: SpeciesConstructor = (init) => new HybridForgekin(init as unknown as HybridForgekinInit);

/** 内置五形态构造器映射 */
export const DEFAULT_SPECIES_CONSTRUCTORS: Record<ForgekinSpecies, SpeciesConstructor> = {
  [ForgekinSpecies.BIO]: bioCtor,
  [ForgekinSpecies.ORG]: orgCtor,
  [ForgekinSpecies.OBJ]: objCtor,
  [ForgekinSpecies.VIRTUAL]: virtualCtor,
  [ForgekinSpecies.HYBRID]: hybridCtor,
};

/**
 * species_factory 配置元数据（对齐 config/forging.yaml:species_factory）。
 * module 字段保留 Python 模块路径作为谱系标记；TS 构造经
 * DEFAULT_SPECIES_CONSTRUCTORS 静态分发。
 */
export const SPECIES_FACTORY_METADATA: Record<ForgekinSpecies, { module: string; class_name: string }> = {
  [ForgekinSpecies.BIO]: { module: 'flowforge.forgemind.species_impl.bio', class_name: 'BioForgekin' },
  [ForgekinSpecies.ORG]: { module: 'flowforge.forgemind.species_impl.org', class_name: 'OrgForgekin' },
  [ForgekinSpecies.OBJ]: { module: 'flowforge.forgemind.species_impl.obj', class_name: 'ObjForgekin' },
  [ForgekinSpecies.VIRTUAL]: { module: 'flowforge.forgemind.species_impl.virtual', class_name: 'VirtualForgekin' },
  [ForgekinSpecies.HYBRID]: { module: 'flowforge.forgemind.species_impl.hybrid', class_name: 'HybridForgekin' },
};

/** 形态构造器注册表（实例级，可被插件覆盖扩展） */
export class SpeciesFactoryRegistry {
  private readonly constructors = new Map<ForgekinSpecies, SpeciesConstructor>(
    Object.entries(DEFAULT_SPECIES_CONSTRUCTORS) as Array<[ForgekinSpecies, SpeciesConstructor]>,
  );

  /** 注册/覆盖某形态的构造器 */
  register(species: ForgekinSpecies, constructor: SpeciesConstructor): void {
    this.constructors.set(species, constructor);
  }

  /** 按形态实例化 Forgekin；未知形态抛错 */
  create(species: ForgekinSpecies, init: Record<string, unknown>): ForgekinBase {
    const ctor = this.constructors.get(species);
    if (ctor === undefined) {
      throw new Error(`未注册的ForgekinSpecies形态构造器: ${species}——请先 registerSpeciesConstructor。`);
    }
    return ctor(init);
  }

  has(species: ForgekinSpecies): boolean {
    return this.constructors.has(species);
  }
}
