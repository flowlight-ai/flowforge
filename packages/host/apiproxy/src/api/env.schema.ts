/**
 * env domain zod schemas (names derived from map keys: envSummaryRequestSchema /
 * envSummaryValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { EnvVariableView } from './env.ts'

/** EnvVariableView row of env.summary. */
export const envVariableViewSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().min(1),
  sensitive: z.boolean(),
  editable: z.boolean(),
  allowedValues: z.array(z.string()).optional(),
  currentValue: z.string().nullable(),
  masked: z.boolean().optional(),
}) satisfies z.ZodType<Wire<EnvVariableView>>

/** env.summary request payload (read-only, no input). */
export const envSummaryRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'env.summary'>>>

/** env.summary response value. */
export const envSummaryValueSchema = z.object({
  variables: z.array(envVariableViewSchema),
  categories: z.record(z.string(), z.string()),
}) satisfies z.ZodType<Wire<ResponseValue<'env.summary'>>>
