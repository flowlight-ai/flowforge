/**
 * @flowforge/forgekin-app — F026 MindCouncil 通道注册
 *
 * TS 移植自 `forgemind/plugins.py` `register_council_channels`。
 * MindCouncil 是多 Forgekin 议事机制，用于解决跨 Forgekin 冲突、
 * 复杂决策、愿景方向校准。
 *
 * @module @flowforge/forgekin-app/channels
 */

/** MindCouncil 通道（ForgeMindPlugin.register_council_channels 的注册单元） */
export interface CouncilChannelDef {
  readonly name: string;
  readonly channel_type: string;
  readonly description: string;
  /** 参与者模板（如 ["forgemind:template:*"]） */
  readonly participants: readonly string[];
  /** 只读路径（Scope Guard：议事不得修改愿景/红线） */
  readonly readonly_paths: readonly string[];
}

/** 默认 MindCouncil 通道（2 个：愿景对齐 + 跨形态协作） */
export const DEFAULT_COUNCIL_CHANNELS: readonly CouncilChannelDef[] = [
  {
    name: 'forgemind:vision_review',
    channel_type: 'vision_alignment',
    description: 'Forgekin愿景对齐MindCouncil——校准 VISION §7 七条锚点',
    participants: ['forgemind:template:*'],
    readonly_paths: ['VISION.md#7', 'rules.md#红线'],
  },
  {
    name: 'forgemind:cross_species_coordination',
    channel_type: 'cross_species_review',
    description: '跨ForgekinSpecies协作MindCouncil——BioForgekin 与 OrgForgekin 等',
    participants: ['forgemind:template:*'],
    readonly_paths: [],
  },
];
