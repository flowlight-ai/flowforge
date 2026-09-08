/**
 * @flowforge/infrastructure-github-signals — ITaskStore port + in-memory impl
 *
 * Self-contained port of the clowder-ai `ITaskStore` seam — the minimal surface
 * the GitHub wait lifecycle needs: `get`, `patchAutomationState` and
 * `replaceAutomationStateIfGeneration` (an optimistic-concurrency compare-and-swap
 * keyed on generation + updatedAt). The in-memory implementation is the real,
 * production-shaped contract for tests (critical paths are not mocked).
 */

import type {
  AutomationState,
  TaskItem,
  TaskStatus,
} from '../contract/github-wait.ts'

export interface ReplaceAutomationStateIfGenerationInput {
  readonly expectedGeneration: number | null
  readonly expectedUpdatedAt?: number
  readonly automationState: AutomationState | undefined
  readonly why?: string
  readonly status?: TaskStatus
}

export interface ITaskStore {
  get(taskId: string): TaskItem | null | Promise<TaskItem | null>
  patchAutomationState(taskId: string, patch: Partial<AutomationState>): TaskItem | null | Promise<TaskItem | null>
  replaceAutomationStateIfGeneration(
    taskId: string,
    input: ReplaceAutomationStateIfGenerationInput,
  ): TaskItem | null | Promise<TaskItem | null>
}

/** The live wait generation of an automation state (`await.generation` || `waitOutcome.generation`). */
export function automationGeneration(state: AutomationState | undefined): number | null {
  return state?.await?.generation ?? state?.waitOutcome?.generation ?? null
}

/**
 * Merge an automation-state patch onto existing state with the same
 * collector-field semantics as the clowder TaskStore (shallow per-column merge,
 * issue/pr quarantine preserved via the discriminated union).
 */
function mergeAutomationState(
  existing: AutomationState | undefined,
  patch: Partial<AutomationState>,
): AutomationState | undefined {
  if (!existing && Object.keys(patch).length === 0) return undefined
  const issue = (patch as { issue?: unknown }).issue
  const prCandidate = patch as Partial<AutomationState>
  return {
    ...(issue
      ? { issue: { ...(existing as { issue?: object } | undefined)?.issue, ...(issue as object) } }
      : existing && 'issue' in existing
        ? { issue: existing.issue }
        : {}),
    ...(prCandidate.review
      ? { review: { ...(existing as { review?: object } | undefined)?.review, ...prCandidate.review } }
      : existing && 'review' in existing
        ? { review: existing.review }
        : {}),
    ...(prCandidate.ci
      ? { ci: { ...(existing as { ci?: object } | undefined)?.ci, ...prCandidate.ci } }
      : existing && 'ci' in existing
        ? { ci: existing.ci }
        : {}),
    ...(prCandidate.conflict
      ? { conflict: { ...(existing as { conflict?: object } | undefined)?.conflict, ...prCandidate.conflict } }
      : existing && 'conflict' in existing
        ? { conflict: existing.conflict }
        : {}),
    ...(patch.await !== undefined ? { await: patch.await } : {}),
    ...(patch.waitOutcome !== undefined ? { waitOutcome: patch.waitOutcome } : {}),
    ...(patch.closedAt !== undefined ? { closedAt: patch.closedAt } : {}),
  } as AutomationState
}

/** In-memory, map-backed task store (the real contract implementation for tests). */
export class MemoryTaskStore implements ITaskStore {
  private readonly tasks = new Map<string, TaskItem>()

  seed(task: TaskItem): TaskItem {
    this.tasks.set(task.id, task)
    return task
  }

  list(): TaskItem[] {
    return [...this.tasks.values()]
  }

  get(taskId: string): TaskItem | null {
    return this.tasks.get(taskId) ?? null
  }

  patchAutomationState(taskId: string, patch: Partial<AutomationState>): TaskItem | null {
    const existing = this.tasks.get(taskId)
    if (!existing) return null
    const merged = mergeAutomationState(existing.automationState, patch)
    const updated: TaskItem = {
      ...existing,
      ...(merged !== undefined ? ({ automationState: merged } as const) : {}),
      updatedAt: Date.now(),
    }
    this.tasks.set(taskId, updated)
    return updated
  }

  replaceAutomationStateIfGeneration(
    taskId: string,
    input: ReplaceAutomationStateIfGenerationInput,
  ): TaskItem | null {
    const existing = this.tasks.get(taskId)
    if (!existing) return null
    if (input.expectedUpdatedAt !== undefined && existing.updatedAt !== input.expectedUpdatedAt) return null
    if (automationGeneration(existing.automationState) !== input.expectedGeneration) return null
    const updated: TaskItem = {
      ...existing,
      ...(input.automationState !== undefined ? { automationState: input.automationState } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: Date.now(),
    }
    this.tasks.set(taskId, updated)
    return updated
  }
}