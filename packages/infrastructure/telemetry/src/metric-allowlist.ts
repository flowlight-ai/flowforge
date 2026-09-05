/**
 * F152: Metric Attribute Allowlist — D2 代码级强制（TS 移植自 clowder-ai
 * `metric-allowlist.ts` 纯逻辑部分）。
 *
 * OTel View/AttributesProcessor 的 SDK 接线挂 T9.5；本模块提供允许清单与
 * 纯过滤函数，防止把高基数属性（threadId、invocationId 等）加进指标。
 */

import * as semconv from './semconv.ts';

/** The ONLY attributes allowed on metric instruments. */
export const ALLOWED_METRIC_ATTRIBUTES: ReadonlySet<string> = new Set([
  semconv.AGENT_ID,
  semconv.GENAI_SYSTEM,
  semconv.GENAI_MODEL,
  semconv.OPERATION_NAME,
  semconv.ACTION_SUCCESSOR_MODE,
  semconv.ROUTING_EVENT_WAIT_REASON,
  semconv.STATUS,
  semconv.STREAM_ERROR_PATH,
  semconv.TRIGGER,
  semconv.THREAD_SYSTEM_KIND,
  semconv.CALLBACK_TOOL,
  semconv.CALLBACK_REASON,
  semconv.FRESHNESS_RELEVANCE_REASON,
  semconv.SIGNAL_KIND,
  semconv.SEAL_REASON,
  // F236 Track-1: anchor-first telemetry per-tool breakdown.
  semconv.ANCHOR_TOOL,
  // F167 Phase O PR-O2: claim grounding shadow telemetry.
  // Bounded cardinality: claim_type(7), verdict(3), action_family(9), source_tier(3).
  semconv.GROUNDING_CLAIM_TYPE,
  semconv.GROUNDING_VERDICT,
  semconv.GROUNDING_ACTION_FAMILY,
  semconv.GROUNDING_SOURCE_TIER,
  // F296 B4b: closed continuity/projection/delivery enums only.
  // Explicitly excluded: userId, threadId, subjectKey, epoch, prompt/message
  // ids, evidence refs and every free string.
  semconv.CONTEXT_PROJECTION_DISPOSITION,
  semconv.CONTEXT_PROJECTION_REASON,
  semconv.CONTEXT_PROJECTION_TRANSITION,
  semconv.CONTEXT_PROJECTION_MODE,
  semconv.CONTEXT_PROJECTION_DELTA_SIZE,
  semconv.CONTEXT_PROJECTION_TIER,
  semconv.CONTEXT_PROJECTION_LEDGER_OUTCOME,
]);

/** 纯过滤：仅保留允许清单内的属性（SDK AttributesProcessor 的无依赖等价物）。 */
export function filterMetricAttributes(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (ALLOWED_METRIC_ATTRIBUTES.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
