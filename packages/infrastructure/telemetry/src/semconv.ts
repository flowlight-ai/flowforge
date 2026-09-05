/**
 * GenAI 语义约定常量隔离层（批次30 批次内联于 index.ts，批次51 补齐全量常量
 * 并拆分为独立模块——对齐 clowder-ai `genai-semconv.ts`）。
 */

export const GENAI_SYSTEM = 'gen_ai.system';
export const GENAI_MODEL = 'gen_ai.request.model';
export const GENAI_TOKENS_INPUT = 'gen_ai.usage.input_tokens';
export const GENAI_TOKENS_OUTPUT = 'gen_ai.usage.output_tokens';
export const AGENT_ID = 'agent.id';
export const OPERATION_NAME = 'operation.name';
export const STATUS = 'status';
export const STREAM_ERROR_PATH = 'cat_cafe.stream_error.path';
export const TRIGGER = 'trigger';
export const THREAD_SYSTEM_KIND = 'thread.system_kind';
export const TOOL_NAME = 'tool.name';
export const TOOL_INPUT_KEYS = 'tool.input_keys';
export const TOOL_CATEGORY = 'tool.category';
export const ROUTING_EVENT_WAIT_REASON = 'routing_event_wait_reason';
export const ACTION_SUCCESSOR_MODE = 'action_successor.mode';
export const CALLBACK_TOOL = 'callback.tool';
export const CALLBACK_REASON = 'callback.reason';
export const FRESHNESS_RELEVANCE_REASON = 'freshness.relevance_reason';
export const ANCHOR_TOOL = 'anchor.tool';
export const SIGNAL_KIND = 'signal.kind';
export const SEAL_REASON = 'seal.reason';
export const GROUNDING_CLAIM_TYPE = 'grounding.claim_type';
export const GROUNDING_VERDICT = 'grounding.verdict';
export const GROUNDING_ACTION_FAMILY = 'grounding.action_family';
export const GROUNDING_SOURCE_TIER = 'grounding.source_tier';
export const CONTEXT_PROJECTION_DISPOSITION = 'context_projection.disposition';
export const CONTEXT_PROJECTION_REASON = 'context_projection.reason';
export const CONTEXT_PROJECTION_TRANSITION = 'context_projection.transition';
export const CONTEXT_PROJECTION_MODE = 'context_projection.mode';
export const CONTEXT_PROJECTION_DELTA_SIZE = 'context_projection.delta_size';
export const CONTEXT_PROJECTION_TIER = 'context_projection.tier';
export const CONTEXT_PROJECTION_LEDGER_OUTCOME = 'context_projection.ledger_outcome';
