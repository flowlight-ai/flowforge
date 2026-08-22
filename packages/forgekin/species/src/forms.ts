/**
 * @flowforge/forgekin-species — ForgekinFormData 锻造表单
 *
 * TS 移植自 `forgemind/forms.py`（pydantic v2 → 构造函数校验）：
 * - 必填字段（name / species / namespace）非空
 * - value_anchors 无重复
 * - 觉醒阶默认 E1 全导阶，保证新锻造 Forgekin 从全人工起步
 *
 * @module @flowforge/forgekin-species/forms
 */

import { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinSpecies } from './species-enum.js';

/** ForgekinFormData 构造入参 */
export interface ForgekinFormDataInit {
  readonly name: string;
  readonly species: ForgekinSpecies;
  readonly namespace: string;
  /** 锻造需求描述（自然语言，供形态定义阶段消费） */
  readonly requirement?: string | undefined;
  /** 初始种子参数（写入 SoulImprint，作为谱系锚点） */
  readonly seed_params?: Readonly<Record<string, unknown>> | undefined;
  /** 价值锚点（对齐 VISION §7 + 15 条红线） */
  readonly value_anchors?: readonly string[] | undefined;
  /** 能力画像初始值（可选，由能力注入阶段补充） */
  readonly capability_profile?: Readonly<Record<string, unknown>> | undefined;
  /** 初始进化阶（默认 E1 萌芽阶） */
  readonly evolution_stage?: EvolutionStage | undefined;
  /** 初始觉醒阶（默认 E1 全导阶） */
  readonly awakening_stage?: AwakeningStage | undefined;
  /** 锻造发起者（operator 命名空间 ID，可选） */
  readonly operator_id?: string | null | undefined;
}

/** Forgekin 锻造表单 — Forge Nurturing 流水线的标准输入 */
export class ForgekinFormData {
  readonly name: string;
  readonly species: ForgekinSpecies;
  readonly namespace: string;
  readonly requirement: string;
  readonly seedParams: Record<string, unknown>;
  readonly valueAnchors: string[];
  readonly capabilityProfile: Record<string, unknown>;
  readonly evolutionStage: EvolutionStage;
  readonly awakeningStage: AwakeningStage;
  readonly operatorId: string | null;

  constructor(init: ForgekinFormDataInit) {
    const name = (init.name ?? '').trim();
    if (!name) {
      throw new Error('name 不能为空白字符。');
    }
    const namespace = (init.namespace ?? '').trim();
    if (!namespace) {
      throw new Error('namespace 不能为空。');
    }
    const anchors = [...(init.value_anchors ?? [])];
    if (new Set(anchors).size !== anchors.length) {
      throw new Error('value_anchors 不能包含重复项。');
    }
    this.name = name;
    this.species = init.species;
    this.namespace = namespace;
    this.requirement = init.requirement ?? '';
    this.seedParams = { ...(init.seed_params ?? {}) };
    this.valueAnchors = anchors;
    this.capabilityProfile = { ...(init.capability_profile ?? {}) };
    this.evolutionStage = init.evolution_stage ?? EvolutionStage.E1;
    this.awakeningStage = init.awakening_stage ?? AwakeningStage.E1;
    this.operatorId = init.operator_id ?? null;
  }

  /**
   * 生成用于 SoulImprint 计算的种子参数字典。
   *
   * 表单核心字段（name / species / namespace / operator_id）作为基础，
   * `seed_params` 展开优先（同名键覆盖）。
   */
  toImprintSeed(): Record<string, unknown> {
    return {
      name: this.name,
      species: this.species,
      namespace: this.namespace,
      operator_id: this.operatorId,
      ...this.seedParams,
    };
  }
}
