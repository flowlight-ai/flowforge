/**
 * @flowforge/chat-stretch — chat stretch-domain ports Cordis 插件（阶段5 批次8，
 * T5.9/T5.10）。
 *
 * Mounts `ChatStretchService` at `ctx.chatStretch`（R13 一切皆插件，无模块级
 * 单例；真实能力由组合根注入，stretch 阶段缺省内存 mock）：
 * - IM 通道面（T5.10 / stage-map §3.4 S1）：五通道（lark/wecom/telegram/
 *   dingtalk/webchat）注册表 + sendIm / handleImEvent / imHealth 委托；
 *   移植 clowder-ai callback-lark-action-routes / callback-wecom-action-routes /
 *   connector-webhooks 通道语义为 ports（阶段 11+ 按凭据接真实适配器）
 * - world 域面（T5.9 / stage-map §3.4 S3）：故事渲染/导出 + 社区 issue +
 *   排行榜；移植 clowder-ai domains/story/* / community-issue-draft-routes /
 *   routes/leaderboard.ts 语义为 ports（阶段 11+ 接真实实现）
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/chat-stretch'
 * ```
 *
 * @module @flowforge/chat-stretch
 */

import { Context, Service } from '@flowforge/cordis'
import { IM_CHANNEL_KINDS, ImChannelRegistry } from './im-ports.ts'
import type {
  ImChannelKind,
  IImChannelAdapter,
  ImHealth,
  ImInboundEvent,
  ImInboundOutcome,
  ImOutboundMessage,
  ImSendResult,
} from './im-ports.ts'
import { InMemoryImChannelAdapter } from './mock/im-channel-mock.ts'
import {
  InMemoryCommunityService,
  InMemoryLeaderboardService,
  InMemoryStoryService,
} from './mock/world-mock.ts'
import type {
  CommunityIssue,
  ICommunityService,
  ILeaderboardService,
  IStoryService,
  LeaderboardEntry,
  StoryEntry,
  StoryExportPack,
} from './world-ports.ts'

/** Constructor options — 协作方全部可选（缺省内存 mock，真实实现组合根覆盖）。 */
export interface ChatStretchServiceOptions {
  /** IM 通道适配器预注册（缺省自动注册 5 种 InMemoryImChannelAdapter）。 */
  readonly imAdapters?: readonly IImChannelAdapter[] | undefined
  /** 缺省 mock 自动补全（缺省 true；组合根接管全部通道时置 false）。 */
  readonly autoRegisterMocks?: boolean | undefined
  /** 故事服务覆盖（缺省 InMemoryStoryService）。 */
  readonly storyService?: IStoryService | undefined
  /** 社区服务覆盖（缺省 InMemoryCommunityService）。 */
  readonly communityService?: ICommunityService | undefined
  /** 排行榜服务覆盖（缺省 InMemoryLeaderboardService）。 */
  readonly leaderboardService?: ILeaderboardService | undefined
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat stretch-domain ports（world/IM，T5.9/T5.10）— mounted by `@flowforge/chat-stretch`. */
    chatStretch: ChatStretchService
  }
}

export { IM_CHANNEL_KINDS, ImChannelRegistry } from './im-ports.ts'
export type {
  IImChannelAdapter,
  ImCardPayload,
  ImChannelKind,
  ImHealth,
  ImInboundEvent,
  ImInboundOutcome,
  ImOutboundMessage,
  ImSendResult,
} from './im-ports.ts'

export { InMemoryImChannelAdapter } from './mock/im-channel-mock.ts'
export type { InMemoryImChannelOptions } from './mock/im-channel-mock.ts'

export {
  InMemoryCommunityService,
  InMemoryLeaderboardService,
  InMemoryStoryService,
} from './mock/world-mock.ts'
export type {
  CommunityIssue,
  ICommunityService,
  ILeaderboardService,
  IStoryService,
  LeaderboardEntry,
  StoryEntry,
  StoryExportPack,
} from './world-ports.ts'

/**
 * ChatStretchService — stretch 域端口编排服务。
 *
 * 持有一个 IM 通道注册表 + 三个 world 域服务，全部经 options 注入
 * （缺省内存 mock）；对外提供 IM 出站/入站委托与 world 域委托方法，
 * 无模块级状态（R13）。
 */
export class ChatStretchService extends Service {
  /** IM 通道注册表（组合根可继续 register 覆盖缺省 mock）。 */
  readonly imChannels: ImChannelRegistry
  private readonly storyService: IStoryService
  private readonly communityService: ICommunityService
  private readonly leaderboardService: ILeaderboardService

  constructor(ctx: Context, options: ChatStretchServiceOptions = {}) {
    super(ctx, 'chatStretch')
    this.imChannels = new ImChannelRegistry()
    for (const adapter of options.imAdapters ?? []) {
      this.imChannels.register(adapter)
    }
    if (options.autoRegisterMocks ?? true) {
      for (const kind of IM_CHANNEL_KINDS) {
        if (!this.imChannels.get(kind)) {
          this.imChannels.register(new InMemoryImChannelAdapter(kind))
        }
      }
    }
    this.storyService = options.storyService ?? new InMemoryStoryService()
    this.communityService = options.communityService ?? new InMemoryCommunityService()
    this.leaderboardService = options.leaderboardService ?? new InMemoryLeaderboardService()
  }

  // -------------------------------------------------------------------------
  // IM 通道面（T5.10）
  // -------------------------------------------------------------------------

  /** 出站发送：通道未注册返回 delivered:false（不抛错）。 */
  async sendIm(kind: ImChannelKind, message: ImOutboundMessage): Promise<ImSendResult> {
    const adapter = this.imChannels.get(kind)
    return adapter ? adapter.send(message) : { delivered: false }
  }

  /** 入站回调归一化处理：通道未注册返回 'error'。 */
  async handleImEvent(event: ImInboundEvent): Promise<ImInboundOutcome> {
    const adapter = this.imChannels.get(event.kind)
    return adapter ? adapter.handleInbound(event) : 'error'
  }

  /** 通道健康快照：通道未注册返回 ok:false。 */
  async imHealth(kind: ImChannelKind): Promise<ImHealth> {
    const adapter = this.imChannels.get(kind)
    return adapter ? adapter.health() : { ok: false, detail: `no adapter for ${kind}` }
  }

  // -------------------------------------------------------------------------
  // world 域面（T5.9）
  // -------------------------------------------------------------------------

  /** 线程 → 故事渲染委托。 */
  buildStory(threadId: string): Promise<StoryEntry | null> {
    return this.storyService.buildStory(threadId)
  }

  /** 故事导出委托（export-store + content-sanitizer 语义）。 */
  exportStory(storyId: string): Promise<StoryExportPack> {
    return this.storyService.exportStory(storyId)
  }

  /** 社区 issue 列表委托（可按 repo 过滤）。 */
  listIssues(repo?: string): Promise<CommunityIssue[]> {
    return this.communityService.listIssues(repo)
  }

  /** 社区 issue 起草委托。 */
  createIssue(input: { repo: string; title: string; body: string }): Promise<CommunityIssue> {
    return this.communityService.createIssue(input)
  }

  /** 排行榜查询委托。 */
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]> {
    return this.leaderboardService.getLeaderboard(limit)
  }

  /** 计分事件委托。 */
  recordLeaderboardEvent(catId: string, displayName: string, score: number): Promise<void> {
    return this.leaderboardService.recordEvent(catId, displayName, score)
  }
}

export default function Plugin(ctx: Context, options?: ChatStretchServiceOptions) {
  ctx.plugin(ChatStretchService, options)
}
