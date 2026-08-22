/**
 * @flowforge/forgekin-species — 虚拟Forgekin（VirtualForgekin）
 *
 * TS 移植自 `forgemind/species_impl/virtual.py`。承载于虚拟世界角色
 * （童话 / 神话 / 历史 / 现实人物 / VR / 游戏角色），纯虚拟无物理接入，
 * 对应业界 Character AI / NPC Agent 范式的工程实现路径。
 *
 * @module @flowforge/forgekin-species
 */

import type { SoulImprint } from '@flowforge/forgekin-soul';
import type { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinBase, type ForgekinLLMClient } from '../base.js';
import { ForgekinSpecies } from '../species-enum.js';

/** VirtualForgekin 构造入参 */
export interface VirtualForgekinInit {
  forgekin_id: string;
  name: string;
  soul_imprint: SoulImprint;
  evolution_stage?: EvolutionStage | undefined;
  awakening_stage?: AwakeningStage | undefined;
  capability_profile?: Readonly<Record<string, unknown>> | undefined;
  forgekin_config?: Readonly<Record<string, unknown>> | undefined;
  llm_client?: ForgekinLLMClient | undefined;
  /** 角色设定（性格 / 背景 / 动机 / 能力） */
  character_setting?: Readonly<Record<string, unknown>> | undefined;
  /** 世界观约束（如 "西游记神话体系"） */
  worldview?: string | null | undefined;
  /** 关系网图谱（与其他角色的关系） */
  relationship_graph?: Readonly<Record<string, unknown>> | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 虚拟Forgekin（VirtualForgekin / Virtual Character Agent） */
export class VirtualForgekin extends ForgekinBase {
  readonly characterSetting: Record<string, unknown>;
  readonly worldview: string | null;
  readonly relationshipGraph: Record<string, unknown>;

  constructor(init: VirtualForgekinInit) {
    super({ ...init, species: ForgekinSpecies.VIRTUAL });
    this.characterSetting = { ...(init.character_setting ?? {}) };
    this.worldview = init.worldview ?? null;
    this.relationshipGraph = { ...(init.relationship_graph ?? {}) };
  }

  /**
   * 观察虚拟世界状态（角色关系图谱 / 世界观事件）。
   *
   * environment 应含 `virtual_world_state`（当前场景 / 在场角色 / 世界观事件）。
   */
  override async observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('observing');
    const state = asRecord(environment['virtual_world_state']);
    return {
      species: this.species,
      character: this.name,
      worldview: this.worldview,
      current_scene: state['current_scene'] ?? 'unknown',
      present_characters: Array.isArray(state['present_characters']) ? state['present_characters'] : [],
      worldview_events: Array.isArray(state['worldview_events']) ? state['worldview_events'] : [],
      relationship_delta: asRecord(state['relationship_delta']),
    };
  }

  /**
   * 执行角色行为（对话 / 行动 / 关系推进）。
   *
   * 必须遵守世界观约束（如孙悟空不可念经）和角色设定（性格 / 动机 /
   * 能力边界）；违反的动作拒绝执行。
   */
  override async act(action: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('acting');
    const behaviorType = typeof action['behavior_type'] === 'string' ? action['behavior_type'] : 'unknown';
    const params = asRecord(action['params']);
    const worldviewAligned = action['worldview_alignment'] !== false;
    const characterConsistent = this.checkCharacterConsistency(params);
    return {
      species: this.species,
      behavior_type: behaviorType,
      params,
      executed: worldviewAligned && characterConsistent,
      character_response: characterConsistent ? 'in_character' : 'out_of_character',
      consistency_check: {
        worldview_aligned: worldviewAligned,
        character_consistent: characterConsistent,
        value_anchors_respected: true,
      },
    };
  }

  /** 验证角色行为是否保持角色一致性（且遵守世界观） */
  override async verify(actionResult: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.setLifecycleState('verifying');
    const check = asRecord(actionResult['consistency_check']);
    if (check['value_anchors_respected'] !== true) {
      return false;
    }
    if (check['worldview_aligned'] !== true) {
      return false;
    }
    return actionResult['executed'] === true;
  }

  /** 检查行为是否符合角色设定（骨架实现：检查能力边界） */
  private checkCharacterConsistency(params: Readonly<Record<string, unknown>>): boolean {
    const boundary = Array.isArray(this.characterSetting['ability_boundary'])
      ? this.characterSetting['ability_boundary'].filter((a): a is string => typeof a === 'string')
      : [];
    if (boundary.length === 0) {
      return true;
    }
    const requiredAbility = params['required_ability'];
    if (typeof requiredAbility === 'string' && requiredAbility !== '' && !boundary.includes(requiredAbility)) {
      return false;
    }
    return true;
  }
}
