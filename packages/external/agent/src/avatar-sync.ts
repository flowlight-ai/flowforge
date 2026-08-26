/**
 * @flowforge/external-agent avatar-sync — Forgekin 形象同步（EAC v1 契约 7）。
 *
 * TS 重写自 flowforge/core/external_agent/avatar_sync.py：
 *   - AvatarSpec: forgekin_id / name / nickname / species /
 *     personality_summary / voice / avatar_uri / blind_spots
 *   - SyncResult: provider_name / success / synced_at / error
 *   - AvatarSyncAdapter: syncAvatar（内存写入 + 固定成功）/
 *     getSyncedAvatar / listSyncedProviders
 */

/** Forgekin 形象规格（avatar_sync.py AvatarSpec，SoulImprint 命名空间）。 */
export interface AvatarSpec {
  /** Forgekin ID（命名空间键）。 */
  readonly forgekin_id: string;
  /** Forgekin 正式名称。 */
  readonly name: string;
  /** 昵称。 */
  readonly nickname?: string;
  /** 物种（如 code_dragon / research_owl）。 */
  readonly species?: string;
  /** 性格摘要（一句话）。 */
  readonly personality_summary?: string;
  /** 语音风格描述。 */
  readonly voice?: string;
  /** 头像资源 URI。 */
  readonly avatar_uri?: string;
  /** 盲点列表（EX-002）。 */
  readonly blind_spots?: readonly string[];
}

/** 单个 Provider 的同步结果（avatar_sync.py SyncResult）。 */
export interface SyncResult {
  /** 目标 Provider 名称。 */
  readonly provider_name: string;
  /** 是否同步成功。 */
  readonly success: boolean;
  /** 同步时间（ISO 8601 UTC）。 */
  readonly synced_at: string;
  /** 失败时的错误信息。 */
  readonly error?: string;
}

/** Forgekin 形象同步适配器（avatar_sync.py AvatarSyncAdapter）。 */
export class AvatarSyncAdapter {
  /** forgekin_id -> provider_name -> AvatarSpec。 */
  private readonly _synced = new Map<string, Map<string, AvatarSpec>>();

  /**
   * 同步 Forgekin 形象到多个三方 Agent（骨架实现：固定成功）。
   *
   * 实际实现应按 Provider 协议（system_prompt 注入 / avatar API 上传）
   * 将 avatarSpec 推送到目标 Provider。
   */
  syncAvatar(
    forgekinId: string,
    avatarSpec: AvatarSpec,
    targetProviders: readonly string[],
  ): Record<string, SyncResult> {
    let providerMap = this._synced.get(forgekinId);
    if (!providerMap) {
      providerMap = new Map();
      this._synced.set(forgekinId, providerMap);
    }
    const results: Record<string, SyncResult> = {};
    const now = new Date().toISOString();
    for (const provider of targetProviders) {
      providerMap.set(provider, avatarSpec);
      results[provider] = {
        provider_name: provider,
        success: true,
        synced_at: now,
      };
    }
    return results;
  }

  /** 获取已同步到指定 Provider 的 Forgekin 形象（未同步返回 undefined）。 */
  getSyncedAvatar(forgekinId: string, providerName: string): AvatarSpec | undefined {
    return this._synced.get(forgekinId)?.get(providerName);
  }

  /** 列出已同步形象到哪些 Provider。 */
  listSyncedProviders(forgekinId: string): string[] {
    return [...(this._synced.get(forgekinId)?.keys() ?? [])];
  }
}
