/**
 * 信号发布契约（本地，fail-closed）：`events.publish` 输入/结果 + 信号声明 +
 * 结构校验 + 已安装 schema 子集校验。
 *
 * 忠实移植 clowder-ai `@clowder-ai/plugin-contract` 中 signal 域的既有语义，
 * 但 flowforge 侧该包不提供同名 signal 契约，故在包内以本地纯函数实现：
 * 结构校验只接受传输解码后的可靠字段（payload/source），任何多余字段立即拒绝；
 * JSON-schema 子集校验仅覆盖本域所需约束（type/required/properties/
 * additionalProperties/pattern/maxLength/…）。
 *
 * @flowforge/cats-signal-intake — contract/events-publish
 */

export interface SignalDeclaration {
  readonly type: string
  readonly schemaRef: string
  readonly epistemicStatus: 'observation' | 'inference'
  readonly privacyClass: 'behavioral' | 'content-adjacent' | 'content'
  readonly sourceClass: 'os-metadata' | 'accessibility-api' | 'remote-service'
}

export interface EventsPublishInput {
  readonly signalType: string
  readonly eventId: string
  readonly idempotencyKey: string
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly source: { readonly handle: string }
}

export type EventsPublishDisposition = 'accepted' | 'duplicate'

export interface EventsPublishResult {
  readonly publicationId: string
  readonly disposition: EventsPublishDisposition
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false }

const TOP_LEVEL_KEYS = new Set(['signalType', 'eventId', 'idempotencyKey', 'occurredAt', 'payload', 'source'])
const POW_PUBLICATION_ID = /^[a-z0-9-]{1,96}$/

// ── 结构校验（fail-closed）───────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function validatePayload(value: unknown): value is Readonly<Record<string, unknown>> {
  return isRecord(value)
}

/** 只接受传输解码后可靠字段；任何无关/多余字段（如 destination）一律拒绝。 */
export function validateEventsPublishInput(value: unknown): ValidationResult<EventsPublishInput> {
  if (!isRecord(value)) return { valid: false }
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) return { valid: false }
  }
  if (!boundedString(value.signalType, 240)) return { valid: false }
  if (!boundedString(value.eventId, 1_024)) return { valid: false }
  if (!boundedString(value.idempotencyKey, 1_024)) return { valid: false }
  if (!boundedString(value.occurredAt, 64)) return { valid: false }
  if (!validatePayload(value.payload)) return { valid: false }
  const source = value.source
  if (!isRecord(source) || !boundedString(source.handle, 1_024)) return { valid: false }
  for (const key of Object.keys(source)) {
    if (key !== 'handle') return { valid: false }
  }
  return {
    valid: true,
    value: {
      signalType: value.signalType,
      eventId: value.eventId,
      idempotencyKey: value.idempotencyKey,
      occurredAt: value.occurredAt,
      payload: value.payload,
      source: { handle: source.handle },
    },
  }
}

export function validateEventsPublishResult(value: unknown): ValidationResult<EventsPublishResult> {
  if (!isRecord(value)) return { valid: false }
  if (!boundedString(value.publicationId, 96) || !POW_PUBLICATION_ID.test(value.publicationId)) {
    return { valid: false }
  }
  if (value.disposition !== 'accepted' && value.disposition !== 'duplicate') return { valid: false }
  return {
    valid: true,
    value: { publicationId: value.publicationId, disposition: value.disposition },
  }
}

// ── JSON-schema 子集校验（本域所需约束）────────────────────────────────

type SubsetSchema = {
  readonly type?: 'object' | 'string' | 'array' | 'number' | 'integer' | 'boolean'
  readonly properties?: Readonly<Record<string, SubsetSchema | boolean>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly items?: SubsetSchema
  readonly minItems?: number
  readonly maxItems?: number
  readonly pattern?: string
  readonly minLength?: number
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
}

function compilePattern(pattern: string): RegExp {
  return new RegExp(pattern, 'u')
}

function validateSubset(value: unknown, schema: SubsetSchema | boolean, seen: Set<unknown>): boolean {
  if (schema === true) return true
  if (schema === false) return false
  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) return false
      if (schema.properties) {
        for (const [key, child] of Object.entries(schema.properties)) {
          if (!(key in value)) continue
          if (child !== true && child !== false && !validateSubset(value[key], child, seen)) return false
        }
      }
      if (schema.required) {
        for (const key of schema.required) {
          if (!(key in value)) return false
        }
      }
      if (schema.additionalProperties === false) {
        const known = new Set(Object.keys(schema.properties ?? {}))
        for (const key of Object.keys(value)) {
          if (!known.has(key)) return false
        }
      }
      return true
    }
    case 'array': {
      if (!Array.isArray(value)) return false
      if (schema.minItems !== undefined && value.length < schema.minItems) return false
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return false
      if (schema.items) {
        for (const item of value) {
          if (!validateSubset(item, schema.items, seen)) return false
        }
      }
      return true
    }
    case 'string': {
      if (typeof value !== 'string') return false
      if (schema.minLength !== undefined && value.length < schema.minLength) return false
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return false
      if (schema.pattern !== undefined && !compilePattern(schema.pattern).test(value)) return false
      return true
    }
    case 'integer': {
      return typeof value === 'number' && Number.isSafeInteger(value)
    }
    case 'number': {
      return typeof value === 'number' && Number.isFinite(value)
    }
    case 'boolean': {
      return typeof value === 'boolean'
    }
    default: {
      // type 缺省时按结构递归，仅用于嵌套 object/array 场景。
      if (Array.isArray(value)) return validateSubset(value, schema, seen)
      if (isRecord(value)) return validateSubset(value, schema, seen)
      return true
    }
  }
}

function coerceSubsetSchema(input: Record<string, unknown>): SubsetSchema {
  const result: Record<string, unknown> = {}
  if (typeof input.type === 'string') {
    const type = input.type as SubsetSchema['type']
    if (
      type === 'object' ||
      type === 'string' ||
      type === 'array' ||
      type === 'number' ||
      type === 'integer' ||
      type === 'boolean'
    ) {
      result.type = type
    }
  }
  if (isRecord(input.properties)) {
    const properties: Record<string, SubsetSchema | boolean> = {}
    for (const [key, value] of Object.entries(input.properties)) {
      if (value === true || value === false) properties[key] = value
      else if (isRecord(value)) properties[key] = coerceSubsetSchema(value)
    }
    result.properties = properties
  }
  if (Array.isArray(input.required)) result.required = input.required.filter((v) => typeof v === 'string')
  if (typeof input.additionalProperties === 'boolean') result.additionalProperties = input.additionalProperties
  if (isRecord(input.items)) result.items = coerceSubsetSchema(input.items)
  if (typeof input.minItems === 'number') result.minItems = input.minItems
  if (typeof input.maxItems === 'number') result.maxItems = input.maxItems
  if (typeof input.pattern === 'string') result.pattern = input.pattern
  if (typeof input.minLength === 'number') result.minLength = input.minLength
  if (typeof input.maxLength === 'number') result.maxLength = input.maxLength
  if (typeof input.minimum === 'number') result.minimum = input.minimum
  if (typeof input.maximum === 'number') result.maximum = input.maximum
  return result as SubsetSchema
}

/**
 * 声明级校验：信号必须由已受理包声明，且 payload/source 满足已安装 schema。
 * 仅校验 payload/source 投影（正文/目的地等结构化字段由结构校验先行拒绝）。
 */
export function validateDeclaredEventsPublishInput(
  declarations: readonly SignalDeclaration[],
  signalSchemas: Readonly<Record<string, unknown>>,
  input: EventsPublishInput,
): ValidationResult<EventsPublishInput> {
  const declaration = declarations.find((candidate) => candidate.type === input.signalType)
  if (!declaration) return { valid: false }
  const rawSchema = signalSchemas[declaration.schemaRef]
  if (!isRecord(rawSchema)) return { valid: false }
  const schema = coerceSubsetSchema(rawSchema)
  const projected = { payload: input.payload, source: input.source }
  if (!validateSubset(projected, schema, new Set())) return { valid: false }
  return { valid: true, value: input }
}