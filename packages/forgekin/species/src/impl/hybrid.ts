/**
 * @flowforge/forgekin-species — 混合Forgekin（HybridForgekin）
 *
 * TS 移植自 `forgemind/species_impl/hybrid.py`。多形态融合：通过组合
 * （而非继承）多个 species Forgekin 实例实现"多形态协作"（组合优于继承，
 * 编程红线第 9 条）。
 *
 * 校验：至少 2 个子Forgekin + 至少 2 种不同 species + 禁止嵌套 Hybrid。
 *
 * @module @flowforge/forgekin-species
 */

import type { SoulImprint } from '@flowforge/forgekin-soul';
import type { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinBase, type ForgekinLLMClient } from '../base.js';
import { ForgekinSpecies } from '../species-enum.js';

/** HybridForgekin 构造入参 */
export interface HybridForgekinInit {
  forgekin_id: string;
  name: string;
  soul_imprint: SoulImprint;
  evolution_stage?: EvolutionStage | undefined;
  awakening_stage?: AwakeningStage | undefined;
  capability_profile?: Readonly<Record<string, unknown>> | undefined;
  forgekin_config?: Readonly<Record<string, unknown>> | undefined;
  llm_client?: ForgekinLLMClient | undefined;
  /** 组成该混合Forgekin的子Forgekin列表（组合模式），≥2 且 ≥2 种 species */
  components?: readonly ForgekinBase[] | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 混合Forgekin（HybridForgekin / Hybrid Spirit Agent） */
export class HybridForgekin extends ForgekinBase {
  readonly components: ForgekinBase[];

  constructor(init: HybridForgekinInit) {
    super({ ...init, species: ForgekinSpecies.HYBRID });
    this.components = [...(init.components ?? [])];
    this.validateComponents();
  }

  /** 校验子Forgekin列表符合混合形态要求 */
  private validateComponents(): void {
    if (this.components.length < 2) {
      throw new Error('HybridForgekin 至少需要 2 个子Forgekin——单形态不是混合形态。详见 [doc:design/naming-contract.md#2.3]');
    }
    const speciesSet = new Set(this.components.map((c) => c.species));
    if (speciesSet.size < 2) {
      throw new Error('HybridForgekin 的子Forgekin必须包含至少 2 种不同 species——同 species 的组合不构成混合形态。');
    }
    for (const comp of this.components) {
      if (comp.species === ForgekinSpecies.HYBRID) {
        throw new Error('HybridForgekin 不允许嵌套 HybridForgekin——避免无限递归，请展平子Forgekin列表。');
      }
    }
  }

  /** 多源融合观察（组合所有子Forgekin的观察结果） */
  override async observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('observing');
    const componentObservations: Array<Record<string, unknown>> = [];
    for (const comp of this.components) {
      const obs = await comp.observe(environment);
      componentObservations.push({
        component_id: comp.forgekinId,
        component_species: comp.species,
        observation: obs,
      });
    }
    const covered = this.components.map((c) => c.species);
    return {
      species: this.species,
      component_observations: componentObservations,
      fused_state: {
        components_count: this.components.length,
        species_covered: covered,
      },
      species_coverage: covered,
    };
  }

  /**
   * 多形态协作行动（按子Forgekin分工分发动作）。
   *
   * action.component_actions: forgekin_id → 子动作 的分发字典；
   * 所有被分发的子Forgekin都执行才算整体执行。
   */
  override async act(action: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('acting');
    const componentActions = asRecord(action['component_actions']);
    const componentResults: Array<Record<string, unknown>> = [];
    let allExecuted = true;
    for (const comp of this.components) {
      const subAction = componentActions[comp.forgekinId];
      if (subAction === undefined || typeof subAction !== 'object' || subAction === null) {
        continue;
      }
      const result = await comp.act(asRecord(subAction));
      componentResults.push({
        component_id: comp.forgekinId,
        component_species: comp.species,
        result,
      });
      if (result['executed'] !== true) {
        allExecuted = false;
      }
    }
    return {
      species: this.species,
      component_results: componentResults,
      executed: allExecuted,
      coordination_check: {
        components_coordinated: componentResults.length,
        value_anchors_respected: true,
      },
    };
  }

  /** 多形态协作验证（所有子Forgekin都验证通过才算通过） */
  override async verify(actionResult: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.setLifecycleState('verifying');
    const coordination = asRecord(actionResult['coordination_check']);
    if (coordination['value_anchors_respected'] !== true) {
      return false;
    }
    const componentResults = Array.isArray(actionResult['component_results'])
      ? (actionResult['component_results'] as Array<Record<string, unknown>>)
      : [];
    if (componentResults.length === 0) {
      return false;
    }
    for (const cr of componentResults) {
      const entry = asRecord(cr);
      const result = asRecord(entry['result']);
      const compId = typeof entry['component_id'] === 'string' ? entry['component_id'] : '';
      for (const comp of this.components) {
        if (comp.forgekinId === compId) {
          if (!(await comp.verify(result))) {
            return false;
          }
          break;
        }
      }
    }
    return true;
  }
}
