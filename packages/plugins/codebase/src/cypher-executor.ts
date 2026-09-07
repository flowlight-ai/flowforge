/**
 * @flowforge/plugin-codebase — Cypher executor (EP-CB3, T4.1c).
 *
 * Binds MATCH patterns against the real codebase graph (T1-T9: zero mocks),
 * evaluates the WHERE expression tree, maps RETURN columns with aggregation,
 * orders and pages. Row ceiling (100k) and an execution budget produce honest
 * errors/warnings rather than hangs — mirroring the C engine's virtual ceiling
 * and wall-clock budget.
 *
 * Direction semantics follow Cypher: `(a)-[:X]->(b)` traverses the edge a→b
 * (a is source), `(a)<-[:X]-(b)` traverses b→a (a is target child), and
 * `(a)-[:X]-(b)` is direction-agnostic.
 *
 * @module @flowforge/plugin-codebase/cypher-executor
 */

import type { CodebaseStore } from './store.ts'
import type { CypherQuery, NodePattern, RelPattern, Condition, WhereExpr } from './cypher-parser.ts'
import type { GraphNode } from './graph-model.ts'

/** Virtual ceiling on result rows (C parity). */
export const MAX_RESULT_ROWS = 100_000
/** Execution-budget floor on traversed-node work. */
export const DEFAULT_EXEC_BUDGET = 1_000_000

export interface CypherResult {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly rowCount: number
  readonly error?: string
  readonly warning?: string
}

export interface ExecOptions {
  readonly project: string
  readonly query: CypherQuery
  readonly maxRows?: number
  readonly budget?: number
}

interface Adjacency {
  /** source-id → type → target-id[] */
  readonly forward: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>
  /** target-id → type → source-id[] */
  readonly backward: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>
}

/** Build forward/backward adjacency restricted to the named rel types. */
export function buildAdjacency(store: CodebaseStore, project: string, relTypes: readonly string[]): Adjacency {
  const types = [...new Set(relTypes)]
  const edges = types.length === 0 ? store.edgesOf(project) : store.edgesByType(project, types)
  const forward = new Map<string, Map<string, string[]>>()
  const backward = new Map<string, Map<string, string[]>>()
  for (const edge of edges) {
    let fByType = forward.get(edge.source)
    if (fByType === undefined) {
      fByType = new Map<string, string[]>()
      forward.set(edge.source, fByType)
    }
    let fList = fByType.get(edge.type)
    if (fList === undefined) {
      fList = []
      fByType.set(edge.type, fList)
    }
    fList.push(edge.target)
    let bByType = backward.get(edge.target)
    if (bByType === undefined) {
      bByType = new Map<string, string[]>()
      backward.set(edge.target, bByType)
    }
    let bList = bByType.get(edge.type)
    if (bList === undefined) {
      bList = []
      bByType.set(edge.type, bList)
    }
    bList.push(edge.source)
  }
  return { forward, backward }
}

function matchesInlineProps(node: GraphNode, props: NodePattern['props']): boolean {
  for (const filter of props) {
    // `name` / `key` map to the node identifier; otherwise it is a props key.
    if (filter.key === 'name' || filter.key === 'key') {
      if (String(node.name) !== filter.value) return false
      continue
    }
    const value = node.props?.[filter.key]
    if (value === undefined || String(value) !== filter.value) return false
  }
  return true
}

function conditionEval(cond: Condition, row: ReadonlyMap<string, GraphNode>): boolean {
  const node = row.get(cond.variable)
  if (node === undefined) return false
  let actual: string
  let propValue: string | number | boolean | undefined
  if (cond.property === undefined || cond.property === 'name' || cond.property === 'key') {
    actual = node.name
  } else if (cond.property === 'label') {
    actual = node.label
  } else {
    propValue = node.props?.[cond.property]
    actual = propValue === undefined ? '' : String(propValue)
  }
  if (cond.op === 'IS NULL' || cond.op === 'IS NOT NULL') {
    const isNull = propValue === undefined && cond.property !== undefined && cond.property !== 'name' && cond.property !== 'key' && cond.property !== 'label'
    return cond.op === 'IS NULL' ? isNull : !isNull
  }
  switch (cond.op) {
    case '=': return actual === cond.value
    case '<>': return actual !== cond.value
    case '=~': {
      try {
        return new RegExp(cond.value, 'u').test(actual)
      } catch {
        return false
      }
    }
    case '>': return actual > cond.value
    case '<': return actual < cond.value
    case '>=': return actual >= cond.value
    case '<=': return actual <= cond.value
    case 'CONTAINS': return actual.includes(cond.value)
    case 'STARTS WITH': return actual.startsWith(cond.value)
    case 'ENDS WITH': return actual.endsWith(cond.value)
    case 'IN': return (cond.inValues ?? []).includes(actual)
    default: return false
  }
}

function exprEval(expr: WhereExpr | undefined, row: ReadonlyMap<string, GraphNode>): boolean {
  if (expr === undefined) return true
  switch (expr.kind) {
    case 'and': return exprEval(expr.left, row) && exprEval(expr.right, row)
    case 'or': return exprEval(expr.left, row) || exprEval(expr.right, row)
    case 'xor': return exprEval(expr.left, row) !== exprEval(expr.right, row)
    case 'not': return !exprEval(expr.left, row)
    case 'condition': return conditionEval(expr.cond as Condition, row)
    default: return false
  }
}

/**
 * Reachable node ids from an anchor following the rel pattern, honoring
 * direction/type/hop bounds. Returns { id, depth } candidates enabling the
 * min-hops lower bound check.
 */
function reachable(
  adj: Adjacency,
  anchorId: string,
  rel: RelPattern,
): Array<{ id: string; depth: number }> {
  const candidates: Array<{ id: string; depth: number }> = []
  const seen = new Map<string, number>()
  const pending: Array<{ id: string; depth: number }> = [{ id: anchorId, depth: 0 }]
  seen.set(anchorId, 0)
  const maxHop = rel.maxHops === 0 ? 0 : rel.maxHops
  while (pending.length > 0) {
    const current = pending.shift() as { id: string; depth: number }
    if (maxHop !== 0 && current.depth >= maxHop) continue
    const nextDepth = current.depth + 1
    const neighbors = new Map<string, string[]>()
    const add = (map: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>): void => {
      const byType = map.get(current.id)
      if (byType === undefined) return
      for (const [type, ids] of byType) {
        if (rel.types.length > 0 && !rel.types.includes(type)) continue
        const existing = neighbors.get(type)
        if (existing === undefined) neighbors.set(type, [...ids])
        else existing.push(...ids)
      }
    }
    if (rel.direction === 'outbound') add(adj.forward)
    else if (rel.direction === 'inbound') add(adj.backward)
    else {
      add(adj.forward)
      add(adj.backward)
    }
    for (const ids of neighbors.values()) {
      for (const id of ids) {
        const prior = seen.get(id)
        if (prior !== undefined && prior <= nextDepth) continue
        seen.set(id, nextDepth)
        if (nextDepth >= rel.minHops) candidates.push({ id, depth: nextDepth })
        pending.push({ id, depth: nextDepth })
      }
    }
  }
  return candidates
}

function bindPattern(
  store: CodebaseStore,
  project: string,
  pattern: CypherQuery['patterns'][number],
  adj: Adjacency,
  budget: number,
  threshold: number,
): readonly (ReadonlyMap<string, GraphNode>)[][] {
  const nodes = store.allNodes(project)
  const first = pattern.nodes[0] as NodePattern
  let rows: Array<ReadonlyMap<string, GraphNode>> = nodes
    .filter(node => (first.label === undefined || node.label === first.label) && matchesInlineProps(node, first.props))
    .map(node => {
      const row = new Map<string, GraphNode>()
      if (first.variable !== undefined) row.set(first.variable, node)
      return row
    })

  for (let index = 0; index < pattern.rels.length; index += 1) {
    const rel = pattern.rels[index] as RelPattern
    const nextNode = pattern.nodes[index + 1] as NodePattern
    const prevNode = pattern.nodes[index]
    const nextRows: Array<Array<ReadonlyMap<string, GraphNode>>> = []
    let work = 0
    for (const row of rows) {
      const anchor = prevNode?.variable === undefined ? undefined : row.get(prevNode.variable)
      const anchorNode = anchor
      if (anchorNode === undefined) continue
      const hops = reachable(adj, anchorNode.id, rel)
      work += hops.length
      if (work > threshold) break
      if (hops.length === 0) continue
      for (const hop of hops) {
        const node = nodes.find(candidate => candidate.id === hop.id)
        if (node === undefined) continue
        if (nextNode.label !== undefined && node.label !== nextNode.label) continue
        if (!matchesInlineProps(node, nextNode.props)) continue
        const nextRow = new Map<string, GraphNode>(row)
        if (nextNode.variable !== undefined) nextRow.set(nextNode.variable, node)
        nextRows.push([nextRow])
      }
      if (nextRows.length >= budget) break
    }
    rows = nextRows.flat()
  }
  return rows.map(row => [row])
}

function bindAll(
  store: CodebaseStore,
  project: string,
  query: CypherQuery,
  adj: Adjacency,
  budget: number,
): readonly (ReadonlyMap<string, GraphNode>)[] {
  const threshold = Math.max(1000, budget / 4)
  let rows: readonly (ReadonlyMap<string, GraphNode>)[] = [new Map<string, GraphNode>()]
  for (const pattern of query.patterns) {
    rows = bindPattern(store, project, pattern, adj, budget, threshold).map(cells => cells[0] as ReadonlyMap<string, GraphNode>)
    if (rows.length === 0) return rows
  }
  return rows
}

function columnKey(item: CypherQuery['returnItems'][number]): string {
  return item.alias ?? (item.func !== undefined
    ? `${item.func}(${item.variable}${item.property === undefined ? '' : `.${item.property}`})`
    : `${item.variable}${item.property === undefined ? '' : `.${item.property}`}`)
}

function valueOf(item: CypherQuery['returnItems'][number], row: ReadonlyMap<string, GraphNode>): string {
  const node = row.get(item.variable)
  if (node === undefined) return ''
  const prop = item.property
  let value: string | number | boolean
  if (prop === undefined || prop === 'name' || prop === 'key') value = node.name
  else if (prop === 'label') value = node.label
  else value = node.props?.[prop] ?? ''
  return String(value)
}

/**
 * Execute a parsed Cypher query against the store. Returns columns + rows
 * with the 100k ceiling and an honest partial-result warning on budget overrun.
 */
export function executeCypher(store: CodebaseStore, options: ExecOptions): CypherResult {
  const { project, query } = options
  const maxRows = options.maxRows ?? MAX_RESULT_ROWS
  const budget = options.budget ?? DEFAULT_EXEC_BUDGET

  const relTypes: string[] = []
  for (const pattern of query.patterns) {
    for (const rel of pattern.rels) relTypes.push(...rel.types)
  }
  const adj = buildAdjacency(store, project, relTypes)

  const bound = bindAll(store, project, query, adj, budget)
  const filtered = query.where === undefined ? bound : bound.filter(row => exprEval(query.where, row))

  const groupItems = query.returnItems.filter(item => item.func === undefined)
  const aggItems = query.returnItems.filter(item => item.func !== undefined)
  const isAggregate = aggItems.length > 0

  // --- aggregate path (grouped by non-agg items) ---
  let rowsOut: string[][]
  if (isAggregate) {
    const groups = new Map<string, Array<ReadonlyMap<string, GraphNode>>>()
    for (const row of filtered) {
      const key = groupItems.map(item => String(valueOf(item, row))).join('|')
      const bucket = groups.get(key) ?? []
      bucket.push(row)
      groups.set(key, bucket)
    }
    if (groups.size > maxRows) {
      return { columns: [], rows: [], rowCount: 0, error: `分组结果超过 ${maxRows} 行上限，请加 LIMIT 缩小范围` }
    }
    rowsOut = []
    for (const [, group] of groups) {
      const outRow: string[] = []
      for (const item of query.returnItems) {
        if (item.func === undefined) {
          outRow.push(String(valueOf(item, group[0] as ReadonlyMap<string, GraphNode>)))
          continue
        }
        if (item.func === 'COUNT') {
          if (item.distinct) outRow.push(String(new Set(group.map(row => valueOf({ ...item }, row))).size))
          else outRow.push(String(group.length))
          continue
        }
        const values = group.map(row => Number(valueOf({ ...item }, row)))
        if (item.func === 'SUM') outRow.push(String(values.reduce((a, b) => a + b, 0)))
        else if (item.func === 'AVG') outRow.push(String(values.reduce((a, b) => a + b, 0) / (values.length || 1)))
        else if (item.func === 'MIN') outRow.push(values.length === 0 ? '0' : String(Math.min(...values)))
        else if (item.func === 'MAX') outRow.push(values.length === 0 ? '0' : String(Math.max(...values)))
        else outRow.push(String(values.length)) // COLLECT → count of values
      }
      rowsOut.push(outRow)
    }
  } else {
    rowsOut = filtered.map(row => query.returnItems.map(item => String(valueOf(item, row))))
  }

  // DISTINCT over returned rows (non-aggregate projection)
  if (query.returnDistinct && !isAggregate) {
    const seen = new Set<string>()
    rowsOut = rowsOut.filter(row => {
      const key = row.join('\u0000')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // ORDER BY over returned columns/aliases
  if (query.orderBy.length > 0) {
    const names = query.returnItems.map(item => columnKey(item))
    rowsOut.sort((a, b) => {
      for (const order of query.orderBy) {
        const match = /^COUNT\((.+)\)$/.exec(order.key)
        const target = match !== null ? `COUNT(${(match[1] as string)})` : order.key
        const idx = names.indexOf(target)
        if (idx < 0) continue
        const left = a[idx] as string
        const right = b[idx] as string
        const nl = Number.parseFloat(left)
        const nr = Number.parseFloat(right)
        let cmp: number
        if (Number.isFinite(nl) && Number.isFinite(nr)) cmp = nl > nr ? 1 : nl < nr ? -1 : 0
        else cmp = left.localeCompare(right)
        if (cmp !== 0) return order.desc ? -cmp : cmp
      }
      return 0
    })
  }

  const total = rowsOut.length
  const skipped = query.skip > 0 ? rowsOut.slice(query.skip) : rowsOut
  const limitCount = query.limit > 0 ? Math.min(query.limit, maxRows) : maxRows
  const finalRows = skipped.slice(0, limitCount)

  return {
    columns: query.returnItems.map(item => columnKey(item)),
    rows: finalRows,
    rowCount: finalRows.length,
    ...(total > maxRows ? { error: `结果集超过 ${maxRows} 行上限，请加 LIMIT 缩小范围` } : {}),
    ...(total > budget ? { warning: '执行预算超限，返回部分结果（诚实部分集）' } : {}),
  }
}