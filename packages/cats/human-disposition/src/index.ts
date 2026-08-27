/**
 * @flowforge/cats-human-disposition — F281 human disposition Cordis 插件（C28）。
 *
 * TS 移植自 clowder-ai `domains/human-disposition`（C28 域）：
 *   - types：reason codes 6 类 + feedback/scope/expiry/invalidator discriminatedUnion +
 *     ledger entry（episode+envelope 身份一致性 superRefine）+ isEligible 纯函数
 *   - keys：owner 维度 base64url key 派生（receipts hash / episodes zset / subject zset）
 *   - ledger：双索引 zset + 严格游标分页（cursor 校验 + strictHydration），
 *     Redis 剥离为 HumanDispositionLedgerKV 注入接口（Memory 实现含 CAS appendReceipt）
 *   - lua：CAS append 脚本常量（Redis 宿主直接加载）
 *   - adapters：session-handoff / person-memory proposal（opaque proof）/ wait-cancel 三适配器
 *   - receipt-index：sourceRef-keyed 内存索引（applied/replay/conflict）
 *   - context-service：exact-subject 反馈上下文投影（lexical 候选 + subjectResolver 注入）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsHumanDisposition from '@flowforge/cats-human-disposition'
 * ctx.plugin(CatsHumanDisposition)
 * // ctx.catsHumanDisposition.createLedger(kv, producerLoader) / .createContextService(deps)
 * ```
 *
 * @module @flowforge/cats-human-disposition
 */

import { Context, Service } from '@flowforge/cordis';

import { HumanDispositionKeys } from './keys.js';
import {
  HUMAN_DISPOSITION_REASON_CODES,
  HUMAN_DISPOSITION_REASON_CORRECTIONS,
  buildHumanDispositionEnvelope,
  buildHumanDispositionLedgerEntry,
  buildHumanDispositionLedgerReceipt,
  classifyHumanDispositionFeedbackReplay,
  classifyHumanDispositionSourceReplay,
  humanDispositionDecisionEpisodeSchema,
  humanDispositionDecisionSchema,
  humanDispositionEligibilityContextSchema,
  humanDispositionEnvelopeSchema,
  humanDispositionExpirySchema,
  humanDispositionFeedbackInputSchema,
  humanDispositionInteractionKindSchema,
  humanDispositionInvalidatorSchema,
  humanDispositionInvalidatorTruthSchema,
  humanDispositionLedgerEntrySchema,
  humanDispositionLedgerReceiptSchema,
  humanDispositionLineageTruthSchema,
  humanDispositionScopeSchema,
  humanDispositionServerBindingSchema,
  isHumanDispositionEnvelopeEligible,
} from './types.js';
import type {
  HumanDispositionDecision,
  HumanDispositionDecisionEpisode,
  HumanDispositionEligibilityContext,
  HumanDispositionEnvelope,
  HumanDispositionExpiry,
  HumanDispositionFeedbackInput,
  HumanDispositionInteractionKind,
  HumanDispositionInvalidator,
  HumanDispositionInvalidatorTruth,
  HumanDispositionLedgerEntry,
  HumanDispositionLedgerReceipt,
  HumanDispositionLineageTruth,
  HumanDispositionReasonCode,
  HumanDispositionScope,
  HumanDispositionServerBinding,
  HumanDispositionSourceRef,
  HumanDispositionSourceReplay,
  HumanDispositionFeedbackReplay,
} from './types.js';
import {
  HumanDispositionLedger,
  HumanDispositionLedgerCursorError,
  HumanDispositionLedgerInvariantError,
  MemoryHumanDispositionLedgerKV,
} from './ledger.js';
import type {
  HumanDispositionLedgerCursor,
  HumanDispositionLedgerKV,
  HumanDispositionLedgerPage,
  HumanDispositionLedgerPageOptions,
  HumanDispositionLedgerQueryOptions,
  HumanDispositionProducerEntryLoader,
} from './ledger.js';
import {
  HUMAN_DISPOSITION_RECEIPT_APPEND_LUA,
  HUMAN_DISPOSITION_RECEIPT_FUNCTIONS_LUA,
  humanDispositionReceiptAppendArguments,
} from './lua.js';
import type { HumanDispositionReceiptAppendArguments } from './lua.js';
import {
  buildPersonMemoryDispositionLedgerEntry,
  buildSessionHandoffDispositionLedgerEntry,
  buildWaitCancellationDispositionLedgerEntry,
  mintPersonMemoryDispositionOpaqueProof,
  personMemoryDispositionOpaqueProofSchema,
} from './adapters.js';
import type {
  HumanDispositionRandomBytesSource,
  PersonMemoryDispositionAdapterInput,
  PersonMemoryDispositionOpaqueProof,
  SessionHandoffDispositionAdapterInput,
  WaitCancellationDispositionAdapterInput,
} from './adapters.js';
import { InMemoryHumanDispositionReceiptIndex } from './receipt-index.js';
import type { InMemoryHumanDispositionReceiptAppendOutcome } from './receipt-index.js';
import { HumanDispositionFeedbackContextService } from './context-service.js';
import type {
  FeedbackContextLogger,
  HumanDispositionFeedbackContextInput,
  HumanDispositionFeedbackContextServiceDeps,
  PersonMemoryDispositionSubjectProof,
  SubjectProofResolverPort,
} from './context-service.js';
import { extractCandidatePhrases, normalizeCandidatePhrase } from './lexical-noise.js';
import type { CandidateExtractionResult } from './lexical-noise.js';

// Re-export 核心实现 + 类型。
export { HumanDispositionKeys };
export {
  HUMAN_DISPOSITION_REASON_CODES,
  HUMAN_DISPOSITION_REASON_CORRECTIONS,
  buildHumanDispositionEnvelope,
  buildHumanDispositionLedgerEntry,
  buildHumanDispositionLedgerReceipt,
  classifyHumanDispositionFeedbackReplay,
  classifyHumanDispositionSourceReplay,
  humanDispositionDecisionEpisodeSchema,
  humanDispositionDecisionSchema,
  humanDispositionEligibilityContextSchema,
  humanDispositionEnvelopeSchema,
  humanDispositionExpirySchema,
  humanDispositionFeedbackInputSchema,
  humanDispositionInteractionKindSchema,
  humanDispositionInvalidatorSchema,
  humanDispositionInvalidatorTruthSchema,
  humanDispositionLedgerEntrySchema,
  humanDispositionLedgerReceiptSchema,
  humanDispositionLineageTruthSchema,
  humanDispositionScopeSchema,
  humanDispositionServerBindingSchema,
  isHumanDispositionEnvelopeEligible,
};
export type {
  HumanDispositionDecision,
  HumanDispositionDecisionEpisode,
  HumanDispositionEligibilityContext,
  HumanDispositionEnvelope,
  HumanDispositionExpiry,
  HumanDispositionFeedbackInput,
  HumanDispositionInteractionKind,
  HumanDispositionInvalidator,
  HumanDispositionInvalidatorTruth,
  HumanDispositionLedgerEntry,
  HumanDispositionLedgerReceipt,
  HumanDispositionLineageTruth,
  HumanDispositionReasonCode,
  HumanDispositionScope,
  HumanDispositionServerBinding,
  HumanDispositionSourceRef,
  HumanDispositionSourceReplay,
  HumanDispositionFeedbackReplay,
};
export { HumanDispositionLedger, MemoryHumanDispositionLedgerKV, HumanDispositionLedgerCursorError, HumanDispositionLedgerInvariantError };
export type {
  HumanDispositionLedgerCursor,
  HumanDispositionLedgerKV,
  HumanDispositionLedgerPage,
  HumanDispositionLedgerPageOptions,
  HumanDispositionLedgerQueryOptions,
  HumanDispositionProducerEntryLoader,
};
export {
  HUMAN_DISPOSITION_RECEIPT_APPEND_LUA,
  HUMAN_DISPOSITION_RECEIPT_FUNCTIONS_LUA,
  humanDispositionReceiptAppendArguments,
};
export type { HumanDispositionReceiptAppendArguments };
export {
  buildPersonMemoryDispositionLedgerEntry,
  buildSessionHandoffDispositionLedgerEntry,
  buildWaitCancellationDispositionLedgerEntry,
  mintPersonMemoryDispositionOpaqueProof,
  personMemoryDispositionOpaqueProofSchema,
};
export type {
  HumanDispositionRandomBytesSource,
  PersonMemoryDispositionAdapterInput,
  PersonMemoryDispositionOpaqueProof,
  SessionHandoffDispositionAdapterInput,
  WaitCancellationDispositionAdapterInput,
};
export { InMemoryHumanDispositionReceiptIndex };
export type { InMemoryHumanDispositionReceiptAppendOutcome };
export { HumanDispositionFeedbackContextService };
export type {
  FeedbackContextLogger,
  HumanDispositionFeedbackContextInput,
  HumanDispositionFeedbackContextServiceDeps,
  PersonMemoryDispositionSubjectProof,
  SubjectProofResolverPort,
};
export { extractCandidatePhrases, normalizeCandidatePhrase };
export type { CandidateExtractionResult };

/** HumanDispositionService 构造选项（对齐插件默认行为；铁律 5 参数外置）。 */
export interface HumanDispositionServiceOptions {
  /** 时间函数注入（缺省 Date.now；context-service 默认 now）。 */
  readonly now?: (() => number) | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** human disposition 域（F281）：ledger / context-service / receipt-index 工厂 */
    catsHumanDisposition: HumanDispositionService;
  }
}

/**
 * human disposition 域服务 — 组装 F281 ledger / adapters / context-service 工厂。
 *
 * 挂载 `ctx.catsHumanDisposition`，提供：
 *   - createLedger(kv?, producerLoader?)：KV 缺省 Memory 实现（CAS append 内置）
 *   - createContextService(deps)：exact-subject 反馈上下文投影
 *   - createReceiptIndex()：sourceRef-keyed 内存索引
 *   - mintOpaqueProof() / build*LedgerEntry()：纯函数静态 re-export
 */
export class HumanDispositionService extends Service {
  /** 时间函数（context-service 缺省 now 注入）。 */
  readonly now: () => number;

  constructor(ctx: Context, options: HumanDispositionServiceOptions = {}) {
    super(ctx, 'catsHumanDisposition');
    this.now = options.now ?? Date.now;
  }

  /** 创建 F281 ledger（KV 注入，缺省 Memory 实现；producerLoader 必须注入）。 */
  createLedger(
    producerLoader: HumanDispositionProducerEntryLoader,
    kv: HumanDispositionLedgerKV = new MemoryHumanDispositionLedgerKV(),
  ): HumanDispositionLedger {
    return new HumanDispositionLedger(kv, producerLoader);
  }

  /** 创建 exact-subject 反馈上下文投影服务（subjectResolver/ledger 注入）。 */
  createContextService(deps: HumanDispositionFeedbackContextServiceDeps): HumanDispositionFeedbackContextService {
    return new HumanDispositionFeedbackContextService(deps);
  }

  /** 创建 sourceRef-keyed receipt 内存索引（applied/replay/conflict）。 */
  createReceiptIndex(): InMemoryHumanDispositionReceiptIndex {
    return new InMemoryHumanDispositionReceiptIndex();
  }
}

export default HumanDispositionService;
