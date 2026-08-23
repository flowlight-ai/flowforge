/**
 * store — EvalLedgerStore 存储 + 查询（对齐 Python，CL-004）。
 *
 * 职责：
 * - 存储 EvalLedger 记录（内存骨架，生产环境应换为持久化存储）
 * - 查询历史 Eval 记录（按 method_id / proposal_id / merged 状态）
 * - 统计指标（total / merged / rejected / smoke_passed / promotion_passed）
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import { DEFAULT_MIN_NET_GAIN, EvalLedger } from './models.js';
import { RuleBasedJudge, type CaseJudge } from './judge.js';

export interface EvalLedgerStats {
  total: number;
  merged: number;
  rejected: number;
  smoke_passed: number;
  promotion_passed: number;
}

export interface EvalLedgerStoreOptions {
  readonly judge?: CaseJudge | undefined;
  readonly minNetGain?: number | undefined;
}

/** Eval Ledger 存储 + 查询（design.md v7.1-§D7.6.6）。 */
export class EvalLedgerStore {
  readonly judge: CaseJudge;
  readonly minNetGain: number;
  private readonly ledgers = new Map<string, EvalLedger>();

  constructor(options: EvalLedgerStoreOptions = {}) {
    this.judge = options.judge ?? new RuleBasedJudge();
    this.minNetGain = options.minNetGain ?? DEFAULT_MIN_NET_GAIN;
  }

  /** 保存 EvalLedger 记录，返回 eval_id。 */
  save(ledger: EvalLedger): string {
    this.ledgers.set(ledger.eval_id, ledger);
    return ledger.eval_id;
  }

  /** 获取单条 EvalLedger 记录。 */
  get(evalId: string): EvalLedger | undefined {
    return this.ledgers.get(evalId);
  }

  /** 按方法库（锻典）条目 ID 查询所有 Eval 记录。 */
  listByMethod(methodId: string): EvalLedger[] {
    return [...this.ledgers.values()].filter((l) => l.method_id === methodId);
  }

  /** 按进化提案 ID 查询所有 Eval 记录。 */
  listByProposal(proposalId: string): EvalLedger[] {
    return [...this.ledgers.values()].filter((l) => l.proposal_id === proposalId);
  }

  /** 查询所有已合入的 Eval 记录。 */
  listMerged(): EvalLedger[] {
    return [...this.ledgers.values()].filter((l) => l.merged);
  }

  /** 查询所有被拒绝的 Eval 记录。 */
  listRejected(): EvalLedger[] {
    return [...this.ledgers.values()].filter((l) => !l.merged);
  }

  /** 统计 {total, merged, rejected, smoke_passed, promotion_passed}。 */
  getStats(): EvalLedgerStats {
    const all = [...this.ledgers.values()];
    const merged = all.filter((l) => l.merged).length;
    return {
      total: all.length,
      merged,
      rejected: all.length - merged,
      smoke_passed: all.filter((l) => l.smoke_gate_passed).length,
      promotion_passed: all.filter((l) => l.promotion_gate_passed).length,
    };
  }
}
