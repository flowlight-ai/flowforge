/**
 * @flowforge/plugin-dev — task dispatcher (EP0-5 T0.5.3).
 *
 * Bidirectional interoperability (33-stage §5):
 * - Scenario 1 (flowforge-hosted): a harness driver is injected (flowforge's
 *   subagent service / any LLM tool) and tasks are dispatched to subagents —
 *   switching the underlying agent tool or LLM model mid-flight is fine because
 *   all state lives in `docs/process/instances/`, never in this object.
 * - Scenario 2 (external AI tool, no harness): `NullDispatcher` degrades to a
 *   manual-execution brief so trae/claude code/opencode/... can follow the same
 *   process by hand (subagent-driven-development ⑤: orchestrator stays, only
 *   the executor swaps).
 *
 * The dispatcher is deliberately stateless — dispatch results must be persisted
 * by the caller (evidence/review artifacts), never trusted to live memory.
 *
 * @module @flowforge/plugin-dev/dispatcher
 */

import type { ProcessPhase } from './state-machine.ts'

/** A self-contained unit of work handed to an executor (subagent or human). */
export interface DispatchTask {
  readonly instanceName: string
  readonly phase: ProcessPhase
  /** Imperative instruction — must be executable without further context. */
  readonly instruction: string
  /** Plane-1 methodology assets the executor must read first (⑤ dispatch brief). */
  readonly skillAssets: readonly string[]
}

/** Result of one dispatch attempt. */
export interface DispatchResult {
  readonly task: DispatchTask
  readonly mode: 'subagent' | 'manual'
  /** 'dispatched' — a subagent accepted; 'manual' — a brief was rendered. */
  readonly status: 'dispatched' | 'manual-brief'
  /** Executor identity when dispatched (model family for cross-review constraints). */
  readonly executor?: string
  /** Rendered brief (what to do) — always present for manual mode. */
  readonly brief: string
}

/** Harness-injected driver contract (scenario 1). Implementations wrap flowforge subagents or external tools. */
export interface SubagentDriver {
  /** Dispatch one task; resolves with the executor's report path or summary. */
  dispatch(task: DispatchTask): Promise<{ executor: string; output: string }>
}

/** Dispatcher contract: both directions expose the same surface. */
export interface TaskDispatcher {
  readonly mode: 'subagent' | 'manual'
  dispatch(task: DispatchTask): Promise<DispatchResult>
}

/** Render the manual-execution brief (scenario 2 — no harness required). */
export function buildManualBrief(task: DispatchTask): string {
  return [
    `# 手动执行指引：${task.instanceName}（${task.phase} 阶段）`,
    '',
    '（无宿主 subagent 驱动——按以下指引亲自执行，产物落盘后继续流程）',
    '',
    '## 任务指令',
    task.instruction,
    '',
    '## 前置阅读（Plane 1 方法论资产）',
    ...task.skillAssets.map(asset => `- ${asset}`),
    '',
    '## 完成后',
    '- 用 `ff_dev advance <name>` 推进（门禁未满足会拒绝，这是预期行为）',
    '- 产物路径登记进实例状态（gate 命令 --evidence 参数）',
  ].join('\n')
}

/**
 * Scenario 1: dispatch through an injected harness driver. State lives in the
 * repo (persistence), so a driver swap between calls is harmless — the new
 * driver reads the same instance file and resumes.
 */
export class SubagentDispatcher implements TaskDispatcher {
  readonly mode = 'subagent' as const

  constructor(private readonly driver: SubagentDriver) {}

  async dispatch(task: DispatchTask): Promise<DispatchResult> {
    const { executor, output } = await this.driver.dispatch(task)
    return {
      task,
      mode: 'subagent',
      status: 'dispatched',
      executor,
      brief: output,
    }
  }
}

/**
 * Scenario 2: no harness — render the manual brief. An external AI tool (or a
 * human) follows it directly; the seven-phase spine is enforced by
 * `ff_dev advance` gate rejections, not by the dispatcher.
 */
export class NullDispatcher implements TaskDispatcher {
  readonly mode = 'manual' as const

  async dispatch(task: DispatchTask): Promise<DispatchResult> {
    return { task, mode: 'manual', status: 'manual-brief', brief: buildManualBrief(task) }
  }
}

/**
 * Factory: prefer the injected driver, degrade to manual (never throw — the
 * process must remain executable in every environment, 33-stage risk note 2).
 */
export function createDispatcher(driver?: SubagentDriver): TaskDispatcher {
  return driver === undefined ? new NullDispatcher() : new SubagentDispatcher(driver)
}
