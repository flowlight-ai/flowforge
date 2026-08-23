/**
 * index — T7.18 Eval 自代谢域 Cordis 插件（`ctx.forgeEvalLedger`）。
 *
 * 整合四模块（对齐 Python `evolution/eval_ledger.py` + `core/eval/`）：
 * - Replay A/B 进化级台账（CL-004）：EvalLedgerStore + ReplayABRunner 七步流程
 * - Eval Contract 五问：ContractRegistry 按 component_ref 索引
 * - 三方信号交叉：ThreeSignalCrossValidator（trace/human/auto）
 * - 七类归因矩阵：Attributor（keyword 规则 + 外置文案模板）
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import { Service, type Context } from '@flowforge/cordis';
import {
  Attributor,
  type AttributionReport,
  type AttributorOptions,
} from './attribution.js';
import { ContractRegistry, EvalContract } from './contract.js';
import { RuleBasedJudge, type CaseJudge } from './judge.js';
import { EvalLedger, TestCase } from './models.js';
import { ReplayABRunner, type CaseRunner, type RunReplayAbOptions } from './runner.js';
import { EvalLedgerStore, type EvalLedgerStats } from './store.js';
import { ThreeSignalCrossValidator, Signal, type CrossValidationResult } from './three-signals.js';

export interface EvalLedgerServiceOptions {
  /** 单 case 评审器（不提供则 RuleBasedJudge） */
  readonly judge?: CaseJudge | undefined;
  /** 净增益阈值（默认 0.05） */
  readonly minNetGain?: number | undefined;
  /** 归因文案模板 YAML 路径（铁律 5+P16） */
  readonly promptsPath?: string | undefined;
  /** 自定义归因关键词规则 */
  readonly attributionRules?: AttributorOptions['rules'] | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    forgeEvalLedger: EvalLedgerService;
  }
}

/** Eval 自代谢域服务——进化台账 + 契约 + 三方信号 + 七类归因。 */
export class EvalLedgerService extends Service {
  /** Replay A/B 台账存储（进化级 Eval，CL-004） */
  readonly store: EvalLedgerStore;
  /** Replay A/B 七步流程执行器 */
  readonly runner: ReplayABRunner;
  /** Eval Contract 注册表（五问契约） */
  readonly contracts: ContractRegistry;
  /** 三方信号交叉验证器（trace / human / auto） */
  readonly signals: ThreeSignalCrossValidator;
  /** 七类归因器 */
  readonly attributor: Attributor;

  constructor(ctx: Context, options: EvalLedgerServiceOptions = {}) {
    super(ctx, 'forgeEvalLedger');
    this.store = new EvalLedgerStore({
      judge: options.judge,
      minNetGain: options.minNetGain,
    });
    this.runner = new ReplayABRunner(this.store);
    this.contracts = new ContractRegistry();
    this.signals = new ThreeSignalCrossValidator();
    this.attributor = new Attributor({
      promptsPath: options.promptsPath,
      rules: options.attributionRules,
    });
  }

  // ========== 进化级台账（CL-004）==========

  /** 执行 Replay A/B 七步流程，返回并落账 EvalLedger。 */
  runReplayAb(
    methodId: string,
    proposalId: string,
    testCases: readonly TestCase[],
    options: RunReplayAbOptions = {},
  ): Promise<EvalLedger> {
    return this.runner.runReplayAb(methodId, proposalId, testCases, options);
  }

  /** 台账统计 {total, merged, rejected, smoke_passed, promotion_passed}。 */
  getStats(): EvalLedgerStats {
    return this.store.getStats();
  }

  // ========== Eval Contract 五问 ==========

  /** 注册一个组件的 Eval Contract（同 component_ref 覆盖）。 */
  registerContract(contract: EvalContract): Promise<void> {
    return this.contracts.register(contract);
  }

  /** 按 component_ref 查询契约。 */
  getContract(componentRef: string): Promise<EvalContract | undefined> {
    return this.contracts.get(componentRef);
  }

  // ========== 三方信号交叉 ==========

  /** 三方信号交叉验证（推荐 3 方各 1 条）。 */
  crossValidate(signals: readonly Signal[]): Promise<CrossValidationResult> {
    return this.signals.crossValidate(signals);
  }

  // ========== 七类归因 ==========

  /** 对 Eval 失败进行七类归因（禁止笼统归因到"agent 没做好"）。 */
  attribute(failureData: Record<string, unknown>): Promise<AttributionReport> {
    return this.attributor.attribute(failureData);
  }

  // ========== 观测 ==========

  /** 快照：台账统计 + 契约数 + 归因成熟度标注。 */
  async snapshot(): Promise<{
    ledger: EvalLedgerStats;
    contracts: number;
    attribution_maturity: 'experimental';
    min_net_gain: number;
    judge: string;
  }> {
    const components = await this.contracts.listComponents();
    return {
      ledger: this.store.getStats(),
      contracts: components.length,
      attribution_maturity: 'experimental',
      min_net_gain: this.store.minNetGain,
      judge: this.store.judge instanceof RuleBasedJudge ? 'rule_based' : 'custom',
    };
  }
}

/** Cordis 插件入口。 */
export default function Plugin(ctx: Context, options?: EvalLedgerServiceOptions) {
  return ctx.plugin(EvalLedgerService, options);
}

export type { CaseRunner };
export * from './attribution.js';
export * from './contract.js';
export * from './judge.js';
export * from './models.js';
export * from './runner.js';
export * from './store.js';
export * from './three-signals.js';
