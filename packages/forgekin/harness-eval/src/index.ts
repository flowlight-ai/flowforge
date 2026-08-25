/**
 * index — T7.27 Harness Eval 控制面 Cordis 插件（`ctx.forgeHarnessEval`）。
 *
 * 移植 `harness/feedback_loop.py` + `evaluators/` + F040 契约
 * （对照 clowder `infrastructure/harness-eval` 16 域评估 C32）：
 * - 生命周期五态判定：LifecycleJudge（增值/折旧/行动/瓶颈/稳定，F040 §3.3）
 * - 行动建议派发：ActionRecommender（F012 sunset / F020 fix / escalate CVO）
 * - 每日汇总：DailySummarizer（聚合 F018 契约 + F019 信号 + F020 归因）
 * - 维度评估器：ScoringRuleEvaluator / MultiDimensionEvaluator（evaluators/base.py）
 * - 外环质量门控：FeedbackLoop（4 维评分 + PASS/CONDITIONAL/FAIL + 启发式回退）
 * - 评估器注册中心 + Eval 域注册表（EvaluatorRegistry / EvalDomainRegistry 16 域）
 *
 * @module @flowforge/forgekin-harness-eval
 */

export * from './types.js';
export * from './lifecycle.js';
export * from './recommender.js';
export * from './summarizer.js';
export * from './evaluator.js';
export * from './feedback-loop.js';
export * from './registry.js';
export * from './control-plane.js';

export { default } from './control-plane.js';
