/**
 * Degradation decision tree — automatic strategy selection on failure.
 *
 * Faithful map of flowforge Python legacy core/degradation.py (F25):
 * LLM unavailable → switch provider / degrade to human; storage errors →
 * memory fallback; workflow errors → hardcoded SOP; tool errors →
 * alternative tool / skip; anything else → abort. Collaborators
 * (llm_router / tool_registry / event_bus) are injected.
 */

export type DegradationActionType =
  | 'switch_provider'
  | 'degrade_to_human'
  | 'use_memory_fallback'
  | 'use_hardcoded_sop'
  | 'use_alternative_tool'
  | 'skip_and_log'
  | 'abort'

export interface DegradationAction {
  actionType: DegradationActionType
  target?: string
  reason: string
  urgency: string
}

export interface DegradeToHumanEvent {
  taskId: string
  component: string
  originalError: string
  degradationReason: string
  contextSnapshot: Record<string, unknown>
  suggestedAction: string
  urgency: string
}

export function toDegradeEventData(event: DegradeToHumanEvent): Record<string, unknown> {
  return {
    event_type: 'task.degrade_to_human',
    data: {
      task_id: event.taskId,
      component: event.component,
      original_error: event.originalError,
      degradation_reason: event.degradationReason,
      context_snapshot: event.contextSnapshot,
      suggested_action: event.suggestedAction,
      urgency: event.urgency,
    },
    metadata: { requires_notification: true },
  }
}

export interface DegradationLlmRouter {
  getFallbackProvider?(component: string): Promise<string | null> | string | null
}

export interface DegradationToolRegistry {
  getAlternative?(component: string): string | null
}

export interface DegradationEventBus {
  emit(eventType: string, payload: Record<string, unknown>): unknown
}

export interface DegradationCollaborators {
  llmRouter?: DegradationLlmRouter
  toolRegistry?: DegradationToolRegistry
  eventBus?: DegradationEventBus
}

const LLM_ERROR_TYPES = new Set([
  'LLMTimeoutError',
  'LLMRateLimitError',
  'LLMAuthError',
  'LLMConnectionError',
  'ModelNotAvailableError',
  'APITimeoutError',
  'RateLimitError',
])

const STORAGE_ERROR_TYPES = new Set([
  'StorageError',
  'DatabaseCorruptError',
  'DatabaseError',
  'SQLiteError',
  'OperationalError',
])

const WORKFLOW_ERROR_TYPES = new Set([
  'WorkflowCompileError',
  'WorkflowValidationError',
  'YAMLParseError',
])

const TOOL_ERROR_TYPES = new Set([
  'ToolExecutionError',
  'ToolTimeoutError',
  'ToolNotFoundError',
])

/** Best-effort error type name (class name first, then .name). */
export function errorTypeName(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name !== 'Error' ? error.constructor.name : error.name
  }
  return typeof error
}

export class DegradationDecisionTree {
  private readonly llmRouter: DegradationLlmRouter | undefined
  private readonly toolRegistry: DegradationToolRegistry | undefined
  private readonly eventBus: DegradationEventBus | undefined
  private readonly degradationHistory: Array<Record<string, unknown>> = []

  constructor(collaborators: DegradationCollaborators = {}) {
    this.llmRouter = collaborators.llmRouter
    this.toolRegistry = collaborators.toolRegistry
    this.eventBus = collaborators.eventBus
  }

  async decide(
    component: string,
    error: unknown,
    context: Record<string, unknown> | null = null,
  ): Promise<DegradationAction> {
    const type = errorTypeName(error)
    const message = error instanceof Error ? error.message : String(error)
    const action = await this.evaluate(component, error, type, message, context)
    this.degradationHistory.push({
      component,
      error_type: type,
      error_msg: message.slice(0, 200),
      action: action.actionType,
      target: action.target ?? null,
      reason: action.reason,
    })
    if (action.actionType === 'degrade_to_human') {
      await this.emitDegradeToHuman(component, error, action, context)
    }
    return action
  }

  private async evaluate(
    component: string,
    _error: unknown,
    type: string,
    message: string,
    _context: Record<string, unknown> | null,
  ): Promise<DegradationAction> {
    if (this.isLlmError(type, message)) {
      if (this.llmRouter?.getFallbackProvider) {
        try {
          const fallback = await this.llmRouter.getFallbackProvider(component)
          if (fallback) {
            return {
              actionType: 'switch_provider',
              target: fallback,
              reason: `LLM error: ${type}`,
              urgency: 'high',
            }
          }
        } catch {
          // lookup failure falls through to human degradation
        }
      }
      return {
        actionType: 'degrade_to_human',
        reason: `LLM unavailable: ${type}`,
        urgency: 'critical',
      }
    }

    if (this.isStorageError(type, message)) {
      return {
        actionType: 'use_memory_fallback',
        reason: `Storage error: ${type}`,
        urgency: 'high',
      }
    }

    if (this.isWorkflowError(type, message)) {
      return {
        actionType: 'use_hardcoded_sop',
        reason: `Workflow failed: ${type}`,
        urgency: 'medium',
      }
    }

    if (this.isToolError(type, message)) {
      if (this.toolRegistry?.getAlternative) {
        try {
          const alternative = this.toolRegistry.getAlternative(component)
          if (alternative) {
            return {
              actionType: 'use_alternative_tool',
              target: alternative,
              reason: `Tool failed: ${type}`,
              urgency: 'medium',
            }
          }
        } catch {
          // lookup failure falls through to skip
        }
      }
      return {
        actionType: 'skip_and_log',
        reason: `Tool failed, no alternative: ${type}`,
        urgency: 'low',
      }
    }

    return {
      actionType: 'abort',
      reason: `Unrecoverable: ${type}`,
      urgency: 'critical',
    }
  }

  private isLlmError(type: string, message: string): boolean {
    return (
      LLM_ERROR_TYPES.has(type) ||
      message.toLowerCase().includes('timeout') ||
      message.includes('429')
    )
  }

  private isStorageError(type: string, message: string): boolean {
    return STORAGE_ERROR_TYPES.has(type) || message.toLowerCase().includes('database')
  }

  private isWorkflowError(type: string, message: string): boolean {
    const lower = message.toLowerCase()
    return (
      WORKFLOW_ERROR_TYPES.has(type) || lower.includes('workflow') || lower.includes('yaml')
    )
  }

  private isToolError(type: string, message: string): boolean {
    return TOOL_ERROR_TYPES.has(type) || message.toLowerCase().includes('tool')
  }

  private async emitDegradeToHuman(
    component: string,
    error: unknown,
    action: DegradationAction,
    context: Record<string, unknown> | null,
  ): Promise<void> {
    const event: DegradeToHumanEvent = {
      taskId: typeof context?.task_id === 'string' ? context.task_id : '',
      component,
      originalError: String(error instanceof Error ? error.message : error).slice(0, 500),
      degradationReason: action.reason,
      contextSnapshot: context ?? {},
      suggestedAction: `Please review and handle the ${component} failure manually`,
      urgency: action.urgency,
    }
    if (!this.eventBus) return
    try {
      await this.eventBus.emit('task.degrade_to_human', toDegradeEventData(event))
    } catch {
      // emit failures are non-fatal
    }
  }

  getHistory(component?: string, limit = 50): Array<Record<string, unknown>> {
    const history = component
      ? this.degradationHistory.filter(record => record.component === component)
      : this.degradationHistory
    return history.slice(-limit)
  }
}
