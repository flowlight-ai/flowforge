/**
 * index — T7.10 Harness 七层工程 Cordis 插件（`ctx.forgeHarness`）。
 *
 * 移植 `harness/{durable_state,tool_mediation,evidence_sensors,governance,
 * entropy_manager}.py`（roleagent.md §3.2 Harness 七层，F008-F010/F040）：
 * - Layer1 感知现实：DurableStateSurface + Sqlite/Git 双后端（乐观锁）
 * - Layer2 改变现实：ToolMediator（白名单 + 危险等级 + 别名兜底 + 审计）
 * - Layer3 验证现实：EvidenceCollector（哈希校验）+ SensorBase（探针）
 * - Layer4 约束现实：GovernanceInjector（SYSTEM_ROLE 压缩免疫）
 * - Layer5 人机边界：magic-words（已由 forgekin/magic-words 交付）
 * - Layer6 清理现实：EntropyManager（DocGardener/DebtTracker/RuleEvolution/GC）
 * - Layer7 适配现实：HarnessabilityScorer（五维加权评估）
 *
 * @module @flowforge/forgekin-harness
 */

export * from './types.js';
export * from './durable-state.js';
export * from './tool-mediation.js';
export * from './evidence-sensors.js';
export * from './governance.js';
export * from './entropy-manager.js';
export * from './harnessability.js';
export * from './service.js';

export { default } from './service.js';
