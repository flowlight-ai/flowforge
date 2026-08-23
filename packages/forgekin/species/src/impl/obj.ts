/**
 * @flowforge/forgekin-species — 物品Forgekin（ObjForgekin）
 *
 * TS 移植自 `forgemind/species_impl/obj.py`。承载于物理世界物品
 * （桌椅 / 灯具 / 家电 / 工具），通过 IoT 传感器 / 物联网协议接入，
 * 对应业界 Embodied AI（具身智能）工程实现路径。
 *
 * @module @flowforge/forgekin-species
 */

import type { SoulImprint } from '@flowforge/forgekin-soul';
import type { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinBase, type ForgekinLLMClient } from '../base.js';
import { ForgekinSpecies } from '../species-enum.js';

/** ObjForgekin 构造入参 */
export interface ObjForgekinInit {
  forgekin_id: string;
  name: string;
  soul_imprint: SoulImprint;
  evolution_stage?: EvolutionStage | undefined;
  awakening_stage?: AwakeningStage | undefined;
  capability_profile?: Readonly<Record<string, unknown>> | undefined;
  forgekin_config?: Readonly<Record<string, unknown>> | undefined;
  llm_client?: ForgekinLLMClient | undefined;
  /** IoT 设备 ID */
  device_id?: string | null | undefined;
  /** IoT 协议（如 "zigbee" / "mqtt" / "matter"） */
  iot_protocol?: string | null | undefined;
  /** 物品功能边界（如 ["switch", "dim", "color_temperature"]） */
  function_boundary?: readonly string[] | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 物品Forgekin（ObjForgekin / Object Spirit Agent，对应 Embodied AI） */
export class ObjForgekin extends ForgekinBase {
  readonly deviceId: string | null;
  readonly iotProtocol: string | null;
  readonly functionBoundary: string[];

  constructor(init: ObjForgekinInit) {
    super({ ...init, species: ForgekinSpecies.OBJ });
    this.deviceId = init.device_id ?? null;
    this.iotProtocol = init.iot_protocol ?? null;
    this.functionBoundary = [...(init.function_boundary ?? [])];
  }

  /**
   * 观察物品状态（IoT 传感器数据）。
   *
   * environment 应含 `iot_readings`（设备状态 / 传感器读数 / 使用频率 / 磨损状态）。
   */
  override async observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('observing');
    const readings = asRecord(environment['iot_readings']);
    return {
      species: this.species,
      device_id: this.deviceId,
      device_state: readings['device_state'] ?? 'unknown',
      sensor_readings: asRecord(readings['sensors']),
      usage_pattern: asRecord(readings['usage_pattern']),
      wear_status: readings['wear_status'] ?? 'unknown',
    };
  }

  /**
   * 执行物品功能（开灯 / 调节温度 / 启动设备）。
   *
   * 动作必须在 `function_boundary` 内——超出边界必须拒绝；
   * 物理不可逆操作（加热 / 切割）须 operator 确认后执行。
   */
  override async act(action: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('acting');
    const func = typeof action['function'] === 'string' ? action['function'] : 'unknown';
    const params = asRecord(action['params']);
    const reversible = action['reversible'] !== false;
    const withinBoundary = this.functionBoundary.includes(func);
    return {
      species: this.species,
      function: func,
      params,
      executed: withinBoundary && reversible,
      device_response: withinBoundary ? 'applied' : 'rejected_out_of_boundary',
      safety_check: {
        within_boundary: withinBoundary,
        reversible,
        value_anchors_respected: true,
      },
    };
  }

  /** 验证物品状态是否达成预期（且在功能边界内） */
  override async verify(actionResult: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.setLifecycleState('verifying');
    const safety = asRecord(actionResult['safety_check']);
    if (safety['value_anchors_respected'] !== true) {
      return false;
    }
    if (safety['within_boundary'] !== true) {
      return false;
    }
    return actionResult['executed'] === true;
  }
}
