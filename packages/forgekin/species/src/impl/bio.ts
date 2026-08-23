/**
 * @flowforge/forgekin-species — 生物Forgekin（BioForgekin）
 *
 * TS 移植自 `forgemind/species_impl/bio.py`。承载于物理世界生物体
 * （猫 / 狗 / 鸟 / 鱼等），通过传感器建立"观察生物状态 → 推理需求 →
 * 行动（喂食/互动/健康干预）→ 验证健康度"的现实闭环。
 *
 * @module @flowforge/forgekin-species
 */

import type { SoulImprint } from '@flowforge/forgekin-soul';
import type { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinBase, type ForgekinLLMClient } from '../base.js';
import { ForgekinSpecies } from '../species-enum.js';

/** BioForgekin 构造入参 */
export interface BioForgekinInit {
  forgekin_id: string;
  name: string;
  soul_imprint: SoulImprint;
  evolution_stage?: EvolutionStage | undefined;
  awakening_stage?: AwakeningStage | undefined;
  capability_profile?: Readonly<Record<string, unknown>> | undefined;
  forgekin_config?: Readonly<Record<string, unknown>> | undefined;
  llm_client?: ForgekinLLMClient | undefined;
  /** 生物主体标识（如 "cat:bengal:orange"） */
  biological_subject?: string | null | undefined;
  /** 传感器通道列表（如 ["camera", "microphone", "wearable"]） */
  sensor_channels?: readonly string[] | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 生物Forgekin（BioForgekin / Biological Spirit Agent） */
export class BioForgekin extends ForgekinBase {
  readonly biologicalSubject: string | null;
  readonly sensorChannels: string[];

  constructor(init: BioForgekinInit) {
    super({ ...init, species: ForgekinSpecies.BIO });
    this.biologicalSubject = init.biological_subject ?? null;
    this.sensorChannels = [...(init.sensor_channels ?? [])];
  }

  /**
   * 观察生物环境（物理传感器数据）。
   *
   * environment 应含 `sensor_readings`（摄像头帧 / 麦克风音频 / 可穿戴生理数据）。
   * 返回 subject_state / health_signals / behavioral_cues / sensor_quality / channels_active。
   */
  override async observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('observing');
    const sensorReadings = asRecord(environment['sensor_readings']);
    const channels = Array.isArray(sensorReadings['channels'])
      ? sensorReadings['channels'].filter((c): c is string => typeof c === 'string')
      : [];
    return {
      species: this.species,
      subject: this.biologicalSubject,
      subject_state: sensorReadings['subject_state'] ?? 'unknown',
      health_signals: asRecord(sensorReadings['health_signals']),
      behavioral_cues: Array.isArray(sensorReadings['behavioral_cues']) ? sensorReadings['behavioral_cues'] : [],
      sensor_quality: sensorReadings['sensor_quality'] ?? 0.0,
      channels_active: this.sensorChannels.filter((c) => channels.includes(c)),
    };
  }

  /**
   * 对生物主体执行动作（喂食 / 互动 / 健康干预）。
   *
   * 必须遵守"不伤害 operator"和"不伤害生物主体"双重价值锚点；
   * 觉醒阶 E1/E2 默认降级为建议（executed: false）。
   */
  override async act(action: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('acting');
    const actionType = typeof action['action_type'] === 'string' ? action['action_type'] : 'unknown';
    const params = asRecord(action['params']);
    return {
      species: this.species,
      action_type: actionType,
      params,
      executed: false, // 默认降级为建议——觉醒阶 E1/E2 不直接执行
      effect_on_subject: 'pending_operator_confirmation',
      safety_check: {
        biological_safety: 'passed',
        operator_safety: 'passed',
        value_anchors_respected: true,
      },
    };
  }

  /** 验证动作结果是否改善生物主体健康度 */
  override async verify(actionResult: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.setLifecycleState('verifying');
    const safety = asRecord(actionResult['safety_check']);
    if (safety['value_anchors_respected'] !== true) {
      return false;
    }
    if (safety['biological_safety'] !== 'passed') {
      return false;
    }
    return actionResult['executed'] === true;
  }
}
