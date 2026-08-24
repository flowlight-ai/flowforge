/**
 * @flowforge/forgekin-evolution-engine — 阶段7 T7.20 进化引擎三循环 Cordis 插件
 *
 * 入口 re-export：`ctx.forgeEvolution` 挂载见 `evolution-service.ts`（EvolutionService +
 * default Plugin），模型/三模式治理/审批中心/QC/CloseGate 等从各模块透出。
 *
 * TS 重写自 Python `evolution/{engine,foreman,runtime,qc_loop,close_gate,
 * process_evolution,scope_guard,metacognition,models}.py` + `core/approval_hub.py`。
 */

export * from './evolution-service.js';
export { default } from './evolution-service.js';
