/**
 * @flowforge/external-agent capability-fusion — F35 能力融合（EX-010）。
 *
 * TS 重写自 flowforge/core/external_agent/capability_fusion.py：
 *   - FusionConfig: base_weight=0.1 / max_weight=0.5 / min_invocations=3 /
 *     min_success_rate=0.7 / fuse_blind_spots=true
 *   - FusionResult: fused_profile / fused / fused_capabilities /
 *     fused_blind_spots / fusion_weight / reason
 *   - fuse(forgekinProfile, externalAgentProfile, invocationCount,
 *     successRate)：门槛检查 → weight = min(base*count, max) →
 *     能力不去重合并 → 盲点合并 → 历史追加
 */

/** 融合配置（capability_fusion.py FusionConfig）。 */
export interface FusionConfig {
  /** 单次调用的基础权重。 */
  readonly base_weight: number;
  /** 权重上限。 */
  readonly max_weight: number;
  /** 融合最低调用次数门槛。 */
  readonly min_invocations: number;
  /** 融合最低成功率门槛。 */
  readonly min_success_rate: number;
  /** 是否融合盲点（EX-002）。 */
  readonly fuse_blind_spots: boolean;
}

/** 默认融合配置（capability_fusion.py 缺省值）。 */
export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  base_weight: 0.1,
  max_weight: 0.5,
  min_invocations: 3,
  min_success_rate: 0.7,
  fuse_blind_spots: true,
};

/** 融合结果（capability_fusion.py FusionResult）。 */
export interface FusionResult {
  /** 融合后的 Forgekin 画像（原画像 + 新能力）。 */
  readonly fused_profile: Record<string, unknown>;
  /** 是否发生了融合（门槛未过时为 false）。 */
  readonly fused: boolean;
  /** 新增能力列表（未去重合并）。 */
  readonly fused_capabilities: readonly string[];
  /** 新增盲点列表。 */
  readonly fused_blind_spots: readonly string[];
  /** 融合权重（base*count 封顶 max）。 */
  readonly fusion_weight: number;
  /** 未融合的原因（fused=false 时）。 */
  readonly reason: string;
}

/** 能力融合历史条目。 */
export interface FusionHistoryEntry {
  readonly provider_name: string;
  readonly fused_capabilities: readonly string[];
  readonly fused_blind_spots: readonly string[];
  readonly fusion_weight: number;
  readonly timestamp: string;
}

/** 外部 Agent 能力融合（capability_fusion.py ExternalAgentCapabilityFusion）。 */
export class ExternalAgentCapabilityFusion {
  private readonly _config: FusionConfig;
  /** 融合历史（provider_name -> entries）。 */
  private readonly _history = new Map<string, FusionHistoryEntry[]>();

  constructor(config: Partial<FusionConfig> = {}) {
    this._config = { ...DEFAULT_FUSION_CONFIG, ...config };
  }

  /**
   * 融合外部 Agent 能力到 Forgekin 画像（EX-010）。
   *
   * 门槛检查（capability_fusion.py fuse）：
   *   - invocation_count < min_invocations → 不融合
   *   - success_rate < min_success_rate → 不融合
   * 权重：weight = min(base_weight * invocation_count, max_weight)。
   */
  fuse(
    forgekinProfile: Record<string, unknown>,
    externalAgentProfile: Record<string, unknown>,
    invocationCount: number,
    successRate: number,
  ): FusionResult {
    // 1. 门槛检查
    if (invocationCount < this._config.min_invocations) {
      return {
        fused_profile: forgekinProfile,
        fused: false,
        fused_capabilities: [],
        fused_blind_spots: [],
        fusion_weight: 0,
        reason:
          `invocation_count=${invocationCount} < ` +
          `min_invocations=${this._config.min_invocations}`,
      };
    }
    if (successRate < this._config.min_success_rate) {
      return {
        fused_profile: forgekinProfile,
        fused: false,
        fused_capabilities: [],
        fused_blind_spots: [],
        fusion_weight: 0,
        reason:
          `success_rate=${successRate} < ` +
          `min_success_rate=${this._config.min_success_rate}`,
      };
    }

    // 2. 权重计算
    const weight = Math.min(
      this._config.base_weight * invocationCount,
      this._config.max_weight,
    );

    // 3. 能力不去重合并
    const externalCapabilities = asStrArray(externalAgentProfile.capabilities);
    const profileCapabilities = asStrArray(forgekinProfile.capabilities);
    const fusedCapabilities = [...profileCapabilities, ...externalCapabilities];

    // 4. 盲点合并（forgekin + external，不去重）
    const profileBlindSpots = asStrArray(forgekinProfile.blind_spots);
    const fusedBlindSpots = this._config.fuse_blind_spots
      ? [...profileBlindSpots, ...asStrArray(externalAgentProfile.blind_spots)]
      : [];

    // 5. 融合画像
    const fusedProfile: Record<string, unknown> = {
      ...forgekinProfile,
      capabilities: fusedCapabilities,
    };
    if (this._config.fuse_blind_spots) {
      fusedProfile.blind_spots = [...fusedBlindSpots];
    }

    // 6. 追加历史
    const providerName =
      typeof externalAgentProfile.provider_name === 'string'
        ? (externalAgentProfile.provider_name as string)
        : 'unknown';
    const entry: FusionHistoryEntry = {
      provider_name: providerName,
      fused_capabilities: externalCapabilities,
      fused_blind_spots: fusedBlindSpots,
      fusion_weight: weight,
      timestamp: new Date().toISOString(),
    };
    const history = this._history.get(providerName) ?? [];
    history.push(entry);
    this._history.set(providerName, history);

    return {
      fused_profile: fusedProfile,
      fused: true,
      fused_capabilities: fusedCapabilities,
      fused_blind_spots: fusedBlindSpots,
      fusion_weight: weight,
      reason: 'fused',
    };
  }

  /** 查询某 Provider 的融合历史（按时间升序）。 */
  getFusionHistory(providerName: string): FusionHistoryEntry[] {
    return [...(this._history.get(providerName) ?? [])];
  }

  /** 当前融合配置。 */
  get config(): FusionConfig {
    return { ...this._config };
  }
}

function asStrArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}
