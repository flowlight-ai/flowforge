/**
 * @flowforge/cats-taste — F221 Taste Capture Loop Cordis 插件（C29）。
 *
 * TS 移植自 clowder-ai `domains/taste`（9 文件）：
 *   - taste-routing-guard：propose_profile_update 品味信号检测（ADVISORY，KD-8 不阻止）
 *   - TasteRepository / writeVignette：canonical worktree 定位 + vignette 写入
 *     （GitRunner 注入，缺省 nodeGitRunner，promisify(execFile)）
 *   - approveTasteProposal：locked + checkpointed 审批管线（ApprovalLock 端口注入，
 *     结构化兼容 `@flowforge/cats-invocation` SessionMutexService）
 *   - InMemoryTasteProposalStore：pending → approving → approved 状态机
 *     （@cat-cafe/shared 替换为 @flowforge/cats-shared；Redis 变体不移植，仅保留 keys）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsTaste from '@flowforge/cats-taste'
 * ctx.plugin(CatsTaste)
 * // ctx.catsTaste.createStore() / .createVignetteWriter(root) / .detectTasteSignal(input)
 * ```
 *
 * @module @flowforge/cats-taste
 */

import { Context, Service } from '@flowforge/cordis';

import { detectTasteSignal } from './taste-routing-guard.js';
import type { TasteRoutingAdvisory } from './taste-routing-guard.js';
import { FileTasteRepository, nodeGitRunner } from './taste-repository.js';
import { createVignetteWriter, deriveSlug, formatVignette, insertIntoIndex } from './write-vignette.js';
import type { VignetteWriterFn } from './types.js';
import { approveTasteProposal } from './approve-taste-proposal.js';
import type { ApproveTasteProposalDeps, ApproveTasteProposalResult } from './approve-taste-proposal.js';
import { InMemoryTasteProposalStore } from './store.js';
import { TasteProposalKeys } from './keys.js';

// Re-export 核心实现 + 类型。
export { detectTasteSignal };
export type { TasteRoutingAdvisory };
export { FileTasteRepository, nodeGitRunner };
export { createVignetteWriter, deriveSlug, formatVignette, insertIntoIndex };
export type { VignetteWriterFn, GitRunner, GitResult, ApprovalLock, ITasteProposalStore, TasteRepository } from './types.js';
export { approveTasteProposal };
export type { ApproveTasteProposalDeps, ApproveTasteProposalResult };
export { InMemoryTasteProposalStore };
export { TasteProposalKeys };

declare module '@flowforge/cordis' {
  interface Context {
    /** taste 域（F221）：store / writer / approve 管线 / 信号守卫工厂 */
    catsTaste: TasteService;
  }
}

/**
 * taste 域服务 — 组装 F221 capture-loop 工厂。
 *
 * 挂载 `ctx.catsTaste`，提供：
 *   - createStore()：InMemory store（状态机 + 幂等 + Phase-I publication envelope）
 *   - createVignetteWriter(projectRoot, runner?)：Git 安全写入器（runner 注入，缺省 nodeGitRunner）
 *   - approveTasteProposal(id, by, deps, signal?)：locked+checkpointed 审批管线
 *   - detectTasteSignal(input)：品味信号路由建议（ADVISORY）
 */
export class TasteService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'catsTaste');
  }

  /** 创建 InMemory TasteProposalStore（测试 / 单进程 dev）。 */
  createStore(): InMemoryTasteProposalStore {
    return new InMemoryTasteProposalStore();
  }

  /** 创建 vignette 写入器（GitRunner 注入，缺省 nodeGitRunner）。 */
  createVignetteWriter(
    projectRoot: string,
    runner: import('./types.js').GitRunner = nodeGitRunner,
  ): VignetteWriterFn {
    return createVignetteWriter(projectRoot, runner);
  }

  /** 创建 canonical taste repository（worktree 定位 + approval lock key）。 */
  createRepository(
    projectRoot: string,
    runner: import('./types.js').GitRunner = nodeGitRunner,
  ): FileTasteRepository {
    return new FileTasteRepository(projectRoot, runner);
  }

  /** Locked + checkpointed F221 approval pipeline（端口注入，无框架依赖）。 */
  approveTasteProposal(
    proposalId: string,
    approvedBy: string,
    deps: ApproveTasteProposalDeps,
    signal?: AbortSignal,
  ): Promise<ApproveTasteProposalResult> {
    return approveTasteProposal(proposalId, approvedBy, deps, signal);
  }

  /** propose_profile_update 内容品味信号检测（ADVISORY — 不阻止提案创建）。 */
  detectTasteSignal(input: { rationale?: string; afterContent?: string }): TasteRoutingAdvisory | null {
    return detectTasteSignal(input);
  }
}

export default TasteService;
