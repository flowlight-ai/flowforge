/**
 * @flowforge/webhook values 包内移植 — JSON 无损快照与深度冻结。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-util-values` 的 `snapshotJsonValue` /
 * `deepFreeze` / `JsonValue`。按任务铁律改为包内实现，用于跨规则共享投递前
 * 的“无损 JSON + 冻结”边界。
 */

/** JSON 值，含 `undefined` 用于无损检测（`undefined` 不可被 JSON 表示）。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }
  | undefined

/** 递归出现环时停止的哨兵。 */
const LOSSY = Symbol('flowforge.webhook.lossy')

/** 递归快照一层；`LOSSY` 表示不可无损表示。 */
function snapshotOne(value: unknown, ancestors: Set<object>): JsonValue | typeof LOSSY {
  if (value === undefined) return undefined
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value as string | boolean
  if (type === 'number') {
    return Number.isFinite(value as number) ? (value as number) : LOSSY
  }
  if (type === 'bigint' || type === 'symbol' || type === 'function') return LOSSY
  if (type !== 'object') return LOSSY
  const object = value as object
  if (ancestors.has(object)) return LOSSY
  ancestors.add(object)
  try {
    if (Array.isArray(object)) {
      const out: JsonValue[] = []
      for (const item of object) {
        const snap = snapshotOne(item, ancestors)
        if (snap === LOSSY) return LOSSY
        out.push(snap as JsonValue)
      }
      return out
    }
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(object)) {
      const snap = snapshotOne((object as Record<string, unknown>)[key], ancestors)
      if (snap === LOSSY) return LOSSY
      out[key] = snap as JsonValue
    }
    return out
  } finally {
    ancestors.delete(object)
  }
}

/**
 * 深度拷贝一个任意值为可 JSON 无损表示的快照。
 * @param value - 任意输入。
 * @returns 无损 JSON 快照；若包含不可表示值（bigint/symbol/函数/循环/NaN/Infinity）则为 `undefined`。
 */
export function snapshotJsonValue(value: unknown): JsonValue | undefined {
  const result = snapshotOne(value, new Set<object>())
  return result === LOSSY ? undefined : result
}

/**
 * 递归冻结对象树（就地 `Object.freeze`）。
 * @param value - 待冻结值。
 * @returns 同一值的冻结形态（供链式返回）。
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) deepFreeze(record[key])
    Object.freeze(value)
  }
  return value
}