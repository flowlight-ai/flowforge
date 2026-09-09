/**
 * @flowforge/cordis-client-runner — 动态包浏览器运行时 seam（A10，D50）移植。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-cordis-client-runner` 的 client 半（runtime /
 * orchestrator / evaluator / guard / inspect-registry / providers / timer /
 * api-catalog / slot-catalog）。职责：把模型撰写的浏览器半源码变成页面上被
 * guard-facade 包装的活插件——按包加载/卸载排队、按 run-id 收敛、为渲染崩溃归属，
 * 以及 Cordis 运行编排（approve/decline/start/reconcile）、只读 inspect 注册表、
 * 客户端 timer Service。
 *
 * 全部原 cordis / dsh 依赖（`SlotRegistry`、`Context`、`Service`/`Loader`/
 * `ClientModuleSystem`、`dsh-util-values` 的 `JsonValue`、Remote 传输）化为包内
 * 注入式端口 + 真实内存实现：`ClientSlotsPort`、`ServiceHostPort`、
 * `LoaderModulesPort`、`StyleDocumentPort`、`CordisRunHostSeam`、`JsonValue`。
 * 零 `@deepseek-ai/*` / `@cat-cafe/*` / `@clowder-ai/*` 引用、无 cordis
 * Service/Context feathers。
 */

export * from './types.ts'
export * from './values.ts'
export * from './messages.ts'
export * from './evaluator.ts'
export * from './guard.ts'
export * from './runtime.ts'
export * from './orchestrator.ts'
export * from './inspect-registry.ts'
export * from './providers.ts'
export * from './api-catalog.ts'
export * from './slot-catalog.ts'
export * from './timer.ts'

export {
  ClientSlotsPort,
  MemoryClientSlots,
  createMemoryClientSlots,
} from './ports/slots.ts'
export type {
  StoredSlotEntry,
  SlotDeclarationSpec,
  LiveSlotNode,
  SlotEntryCrashInfo,
} from './ports/slots.ts'
export {
  MemoryServiceHost,
  createMemoryServiceHost,
} from './ports/service-host.ts'
export type { ServiceHostPort } from './ports/service-host.ts'
export {
  MemoryStyleDocument,
  createMemoryStyleDocument,
} from './ports/style.ts'
export type { StyleDocumentPort, StyleNode } from './ports/style.ts'
export {
  MemoryLoaderModules,
  createMemoryLoaderModules,
} from './ports/loader-modules.ts'
export type { LoaderModulesPort, PackageFiber } from './ports/loader-modules.ts'
export {
  createCordisClientRuntime,
  memoryCordisClientRuntime,
} from './memory.ts'
export type {
  CordisClientRuntime,
  CordisClientRuntimeOptions,
  CordisClientRuntimeTransport,
} from './memory.ts'

import type { CordisRunOrchestratorEnv } from './orchestrator.ts'
import { CordisRunOrchestrator } from './orchestrator.ts'

/** 便捷装配：以注入端口构造一个运行编排器。 */
export function createCordisRunOrchestrator(env: CordisRunOrchestratorEnv): CordisRunOrchestrator {
  return new CordisRunOrchestrator(env)
}

export default CordisRunOrchestrator