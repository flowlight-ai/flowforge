/**
 * @flowforge/plugin-codebase — edge extraction (EP-CB1, T2.3).
 *
 * Port of codebase-memory-mcp's call-resolution and heritage slices:
 *
 * - buildRegistry / resolveCall: the five-level resolution chain of
 *   registry.c (import_map → same_module → qualified_suffix → unique_name →
 *   suffix_match), including the receiver-chain guard and the weak-member
 *   suppression (#592/#606) that drops member calls x.f() bound only by a
 *   weak short-name strategy.
 * - extractEdges: an explicit-stack walk whose frames carry the caller QN
 *   (enclosing function, or the File for module-level sites) and the
 *   enclosing class QN. call_expression/new_expression sites resolve through
 *   the chain into CALLS material; class heritage (extract_ts_bases) becomes
 *   INHERITS/IMPLEMENTS; bare identifier references to registry symbols
 *   become USAGE material (pass_usages slice: definition/callee/parameter/
 *   import positions excluded).
 *
 * @module @flowforge/plugin-codebase/edges
 */

import {
  CLASS_NODE_TYPES,
  FUNCTION_NODE_TYPES,
  computeQualifiedName,
  fileNodeId,
  symbolNodeId,
} from './symbols.ts'
import type { EdgeMaterial } from './symbols.ts'
import type { NodeRecord } from './store.ts'
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

/**
 * Labels admitted to the registry (cbm_label_is_registry_symbol, TS slice:
 * Function/Method + type-like Class/Interface/Enum/Type + Variable/Field).
 * The membership set is the single source of truth for call and usage
 * resolution targets.
 */
const REGISTRY_LABELS: ReadonlySet<string> = new Set([
  'Function',
  'Method',
  'Class',
  'Interface',
  'Enum',
  'Type',
  'Variable',
  'Field',
])

/** Strategies suppressed for member calls with an unresolved receiver. */
const WEAK_STRATEGIES: ReadonlySet<string> = new Set(['unique_name', 'suffix_match'])

export interface Registry {
  /** All registered symbol QNs (exact membership). */
  readonly exact: ReadonlySet<string>
  /** Simple name → registered QNs. */
  readonly byName: ReadonlyMap<string, readonly string[]>
}

export type ResolutionStrategy = 'import_map' | 'same_module' | 'qualified_suffix' | 'unique_name' | 'suffix_match'

export interface Resolution {
  readonly qn: string
  readonly strategy: ResolutionStrategy
}

/** One import binding: local name → the QN it refers to (symbol or module). */
export interface ImportBinding {
  readonly localName: string
  readonly targetQn: string
}

export interface ResolveCallContext {
  readonly fileQn: string
  /** Enclosing class QN — set for this/super receiver calls (design §4.4). */
  readonly classQn?: string
  readonly imports: readonly ImportBinding[]
  readonly registry: Registry
  /** Member call x.f() with an unresolved receiver (#592/#606). */
  readonly isMethod?: boolean
}

export interface ExtractEdgesContext {
  readonly project: string
  readonly relPath: string
  readonly fileQn: string
  readonly imports: readonly ImportBinding[]
  readonly registry: Registry
}

export interface EdgeExtraction {
  readonly calls: readonly EdgeMaterial[]
  readonly inherits: readonly EdgeMaterial[]
  readonly implements: readonly EdgeMaterial[]
  readonly usages: readonly EdgeMaterial[]
}

/** Simple name: last dot segment (simple_name, "::" not used by the TS slice). */
function simpleName(qn: string): string {
  const dot = qn.lastIndexOf('.')
  return dot === -1 ? qn : qn.slice(dot + 1)
}

/** Build the resolution registry from symbol nodes (first QN wins on upsert). */
export function buildRegistry(nodes: readonly NodeRecord[]): Registry {
  const exact = new Set<string>()
  const byName = new Map<string, string[]>()
  for (const node of nodes) {
    if (!REGISTRY_LABELS.has(node.label)) continue
    if (node.name.length === 0 || exact.has(node.name)) continue
    exact.add(node.name)
    const simple = simpleName(node.name)
    const arr = byName.get(simple)
    if (arr === undefined) byName.set(simple, [node.name])
    else arr.push(node.name)
  }
  return { exact, byName }
}

/** Count common dot-separated prefix segments (common_prefix_len). */
function commonPrefixLen(a: string, b: string): number {
  let count = 0
  let ia = 0
  let ib = 0
  while (ia < a.length && ib < b.length) {
    const adot = a.indexOf('.', ia)
    const bdot = b.indexOf('.', ib)
    const alen = adot === -1 ? a.length - ia : adot - ia
    const blen = bdot === -1 ? b.length - ib : bdot - ib
    if (alen !== blen || a.slice(ia, ia + alen) !== b.slice(ib, ib + blen)) break
    count += 1
    if (adot === -1 || bdot === -1) break
    ia = adot + 1
    ib = bdot + 1
  }
  return count
}

/** Test/mock path spellings are deprioritized when tiebreaking (is_test_qn). */
function isTestQn(qn: string): boolean {
  return /Test|test|Mock|mock|Stub|stub|Fake|fake|Fixture|spec/.test(qn)
}

/** Composite score: non-test (+1000) then namespace proximity. */
function candidateScore(candidateQn: string, moduleQn: string): number {
  return (isTestQn(candidateQn) ? 0 : 1000) + commonPrefixLen(candidateQn, moduleQn)
}

function bestByImportDistance(candidates: readonly string[], moduleQn: string): string | undefined {
  let best: string | undefined
  let bestScore = -1
  for (const qn of candidates) {
    const score = candidateScore(qn, moduleQn)
    if (score > bestScore) {
      best = qn
      bestScore = score
    }
  }
  return best
}

/** Candidate module is import-reachable when its QN overlaps an import target. */
function isImportReachable(candidateQn: string, imports: readonly ImportBinding[]): boolean {
  const last = candidateQn.lastIndexOf('.')
  const candMod = last === -1 ? candidateQn : candidateQn.slice(0, last)
  for (const binding of imports) {
    if (candMod.includes(binding.targetQn) || binding.targetQn.includes(candMod)) return true
  }
  return false
}

/** Qualified tail match at a segment boundary; unique hit or none (L887). */
function qualifiedSuffixMatch(arr: readonly string[], callee: string): string | undefined {
  if (!callee.includes('.')) return undefined
  let match: string | undefined
  for (const qn of arr) {
    if (!qn.endsWith(callee)) continue
    const tail = qn.length - callee.length
    if (tail > 0 && qn[tail - 1] !== '.') continue
    if (match !== undefined) return undefined // ambiguous
    match = qn
  }
  return match
}

/**
 * Receiver-chain guard (receiver_chain_admits, L943): a dotted callee whose
 * first segment is upper-case names a type; the candidate's parent segment
 * must then appear in the callee's chain. Lower-case roots name values and
 * pass through.
 */
function receiverChainAdmits(callee: string, candidateQn: string): boolean {
  const lastDot = callee.lastIndexOf('.')
  if (lastDot === -1) return true
  const head = callee[0]
  if (head === undefined || head < 'A' || head > 'Z') return true
  const root = callee.slice(0, lastDot)
  if (/[A-Z_]+/.test(root) && root.includes('_')) return true
  const candLast = candidateQn.lastIndexOf('.')
  if (candLast === -1) return true
  const candPrev = candidateQn.lastIndexOf('.', candLast - 1)
  const parent = candidateQn.slice(candPrev + 1, candLast)
  if (parent.length === 0) return true
  return callee
    .slice(0, lastDot)
    .split('.')
    .some(seg => (seg.endsWith('()') ? seg.slice(0, -2) : seg) === parent)
}

/** Strategy 1: import map — binding hit, direct or with a suffix (L735). */
function resolveImportMap(prefix: string, suffix: string | undefined, ctx: ResolveCallContext): Resolution | undefined {
  for (const binding of ctx.imports) {
    if (binding.localName !== prefix) continue
    if (suffix === undefined || suffix.length === 0) {
      // Aliased direct-symbol import called bare: direct QN hit.
      if (ctx.registry.exact.has(binding.targetQn)) return { qn: binding.targetQn, strategy: 'import_map' }
      continue
    }
    const candidate = `${binding.targetQn}.${suffix}`
    if (ctx.registry.exact.has(candidate)) return { qn: candidate, strategy: 'import_map' }
  }
  return undefined
}

/** Strategy 2: same module — class scope first (this/super), then file scope. */
function resolveSameModule(callee: string, suffix: string | undefined, ctx: ResolveCallContext): Resolution | undefined {
  if (ctx.classQn !== undefined) {
    const inClass = `${ctx.classQn}.${callee}`
    if (ctx.registry.exact.has(inClass)) return { qn: inClass, strategy: 'same_module' }
  }
  const inFile = `${ctx.fileQn}.${callee}`
  if (ctx.registry.exact.has(inFile)) return { qn: inFile, strategy: 'same_module' }
  if (suffix !== undefined && suffix.length > 0) {
    const bySuffix = `${ctx.fileQn}.${suffix}`
    if (ctx.registry.exact.has(bySuffix)) return { qn: bySuffix, strategy: 'same_module' }
  }
  return undefined
}

/** Strategy 3+4: name lookup — qualified tail, unique name, suffix match. */
function resolveNameLookup(callee: string, ctx: ResolveCallContext): Resolution | undefined {
  const lookup = simpleName(callee)
  const arr = ctx.registry.byName.get(lookup)
  if (arr === undefined || arr.length === 0) return undefined

  // Strategy 3.5: qualified suffix disambiguates among multiple candidates.
  if (arr.length > 1) {
    const q = qualifiedSuffixMatch(arr, callee)
    if (q !== undefined) return { qn: q, strategy: 'qualified_suffix' }
  }

  // Strategy 3: unique name.
  if (arr.length === 1) {
    const only = arr[0]
    if (only === undefined || !receiverChainAdmits(callee, only)) return undefined
    return { qn: only, strategy: 'unique_name' }
  }

  // Strategy 4: import-reachable filter, then import distance.
  const filtered = arr.filter(qn => isImportReachable(qn, ctx.imports))
  const pool = filtered.length > 0 ? filtered : arr
  const best = bestByImportDistance(pool, ctx.fileQn)
  if (best === undefined) return undefined
  if (!receiverChainAdmits(callee, best)) return undefined
  return { qn: best, strategy: 'suffix_match' }
}

/**
 * The five-level resolution chain (registry_resolve_chain, L1061) with the
 * weak-member suppression applied to the winning strategy (#592/#606):
 * a member call x.f() whose receiver type is unknown drops weak bindings.
 */
export function resolveCall(callee: string, ctx: ResolveCallContext): Resolution | undefined {
  const dot = callee.indexOf('.')
  const prefix = dot === -1 ? callee : callee.slice(0, dot)
  const suffix = dot === -1 ? undefined : callee.slice(dot + 1)

  const res =
    resolveImportMap(prefix, suffix, ctx) ??
    resolveSameModule(callee, suffix, ctx) ??
    resolveNameLookup(callee, ctx)
  if (res === undefined) return undefined
  if (ctx.isMethod === true && WEAK_STRATEGIES.has(res.strategy)) return undefined
  return res
}

interface EdgeFrame {
  readonly node: SyntaxNode
  readonly callerQn: string
  readonly callerIsModule: boolean
  readonly classQn: string | undefined
}

function textOf(source: string, node: SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex)
}

/** Function-shaped QN in the current scope (mirrors symbols.ts extractFuncDef). */
function functionQn(ctx: ExtractEdgesContext, frame: EdgeFrame, name: string): string {
  return frame.classQn === undefined
    ? computeQualifiedName(ctx.project, ctx.relPath, name)
    : `${frame.classQn}.${name}`
}

/** Class-family QN in the current scope (mirrors computeClassQn). */
function classQnOf(ctx: ExtractEdgesContext, node: SyntaxNode, source: string, enclosing: string | undefined): string | undefined {
  const nameNode = node.childForFieldName('name')
  if (nameNode === null) return enclosing
  const name = textOf(source, nameNode)
  if (name.length === 0) return enclosing
  return enclosing === undefined ? computeQualifiedName(ctx.project, ctx.relPath, name) : `${enclosing}.${name}`
}

function pushChildren(stack: EdgeFrame[], node: SyntaxNode, frame: Omit<EdgeFrame, 'node'>): void {
  const children = node.children
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child != null) stack.push({ ...frame, node: child })
  }
}

function edgeOf(project: string, sourceQn: string, targetQn: string, type: EdgeMaterial['type']): EdgeMaterial {
  return { source: symbolNodeId(project, sourceQn), target: symbolNodeId(project, targetQn), type }
}

interface CallSite {
  readonly callee: string
  readonly isMethod: boolean
  readonly thisReceiver: boolean
}

/** Describe the callee of a call/new expression (select_primary_callee). */
function describeCallee(node: SyntaxNode, source: string): CallSite | undefined {
  const fn = node.type === 'new_expression'
    ? node.childForFieldName('constructor') ?? node.namedChild(0)
    : node.childForFieldName('function') ?? node.namedChild(0)
  if (fn === null || fn === undefined) return undefined
  if (fn.type === 'identifier') return { callee: textOf(source, fn), isMethod: false, thisReceiver: false }
  if (fn.type === 'member_expression') {
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj === null || prop === null) return undefined
    if (obj.type === 'this' || obj.type === 'super') {
      // this/super receivers stay unflagged; their target is the class (#592).
      return { callee: textOf(source, prop), isMethod: false, thisReceiver: true }
    }
    return { callee: textOf(source, fn), isMethod: true, thisReceiver: false }
  }
  if (fn.type === 'type_identifier') {
    return { callee: textOf(source, fn), isMethod: false, thisReceiver: false }
  }
  return undefined
}

/** collect_ts_bases: extends/implements type names of a class/interface node. */
function heritageNames(node: SyntaxNode, source: string, clauseKind: 'extends' | 'implements'): string[] {
  const out: string[] = []
  const pushBaseText = (value: SyntaxNode): void => {
    const text = textOf(source, value).trim()
    if (text.length > 0) out.push(text)
  }
  const collectClause = (clause: SyntaxNode): void => {
    const isExtends = clause.type === 'extends_clause' || clause.type === 'extends_type_clause'
    if (clauseKind === 'extends' ? !isExtends : clause.type !== 'implements_clause') return
    if (clause.type === 'extends_clause') {
      const value = clause.childForFieldName('value')
      if (value !== null) pushBaseText(value)
      return
    }
    for (const child of clause.namedChildren) {
      if (child === null || child.type === 'type_arguments') continue
      if (child.type === 'generic_type') {
        const name = child.childForFieldName('name')
        if (name !== null) {
          pushBaseText(name)
          continue
        }
      }
      pushBaseText(child)
    }
  }
  const scan = (container: SyntaxNode): void => {
    for (const child of container.children) {
      if (child === null) continue
      if (child.type === 'class_heritage') {
        for (const clause of child.children) {
          if (clause !== null) collectClause(clause)
        }
      } else if (child.type === 'extends_type_clause') {
        collectClause(child)
      } else if (child.type === 'extends_clause' || child.type === 'implements_clause') {
        collectClause(child)
      }
    }
  }
  scan(node)
  return out
}

/** Parent types whose identifier children are definitions, not usages. */
const DEFINITION_PARENT_TYPES: ReadonlySet<string> = new Set([
  'variable_declarator',
  'formal_parameters',
  'required_parameter',
  'optional_parameter',
  'object_pattern',
  'array_pattern',
  'rest_pattern',
])

/** True when the identifier occupies the name/definition position. */
function isDefinitionPosition(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent === null) return false
  if (DEFINITION_PARENT_TYPES.has(parent.type)) {
    // variable_declarator: only the `name` field is a definition; pair_pattern
    // keys likewise. web-tree-sitter wraps nodes on access, so identity is
    // compared through the stable numeric node id, never by reference.
    if (parent.type === 'variable_declarator') return parent.childForFieldName('name')?.id === node.id
    return true
  }
  if (FUNCTION_NODE_TYPES.has(parent.type) || CLASS_NODE_TYPES.has(parent.type) || parent.type === 'internal_module') {
    return parent.childForFieldName('name')?.id === node.id
  }
  return false
}

/** True when the identifier is the callee of a call/new expression. */
function isCalleePosition(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent === null) return false
  if (parent.type === 'call_expression') return parent.childForFieldName('function')?.id === node.id
  if (parent.type === 'new_expression') return parent.childForFieldName('constructor')?.id === node.id
  return false
}

/**
 * Extract the edge slice of one parsed file: CALLS (five-level chain with
 * weak-member suppression), INHERITS/IMPLEMENTS (heritage) and USAGE (bare
 * identifier references to registry symbols).
 */
export function extractEdges(tree: Tree, source: string, ctx: ExtractEdgesContext): EdgeExtraction {
  const calls: EdgeMaterial[] = []
  const inherits: EdgeMaterial[] = []
  const implementsEdges: EdgeMaterial[] = []
  const usages: EdgeMaterial[] = []
  const seen = new Set<string>()

  const pushEdge = (list: EdgeMaterial[], material: EdgeMaterial): void => {
    const key = `${material.source}|${material.target}|${material.type}`
    if (seen.has(key)) return
    seen.add(key)
    list.push(material)
  }

  const stack: EdgeFrame[] = [{ node: tree.rootNode, callerQn: ctx.fileQn, callerIsModule: true, classQn: undefined }]
  while (stack.length > 0) {
    const frame = stack.pop() as EdgeFrame
    const node = frame.node
    const kind = node.type

    // Import statements reference module paths, not symbols.
    if (kind === 'import_statement') continue

    if (kind === 'call_expression' || kind === 'new_expression') {
      const site = describeCallee(node, source)
      if (site !== undefined && site.callee.length > 0) {
        const res = resolveCall(site.callee, {
          fileQn: ctx.fileQn,
          ...(site.thisReceiver && frame.classQn !== undefined ? { classQn: frame.classQn } : {}),
          imports: ctx.imports,
          registry: ctx.registry,
          isMethod: site.isMethod,
        })
        if (res !== undefined) {
          emitCall(
            { calls, seen },
            ctx.project,
            frame.callerIsModule ? fileNodeId(ctx.project, ctx.relPath) : symbolNodeId(ctx.project, frame.callerQn),
            res.qn,
          )
        }
      }
      pushChildren(stack, node, frame)
      continue
    }

    if (FUNCTION_NODE_TYPES.has(kind)) {
      const nameNode = node.childForFieldName('name')
      if (nameNode !== null) {
        const name = textOf(source, nameNode)
        if (name.length > 0 && name !== 'function') {
          pushChildren(stack, node, {
            callerQn: functionQn(ctx, frame, name),
            callerIsModule: false,
            classQn: frame.classQn,
          })
          continue
        }
      }
      pushChildren(stack, node, frame)
      continue
    }

    if (CLASS_NODE_TYPES.has(kind) || kind === 'internal_module') {
      const scopeQn = classQnOf(ctx, node, source, frame.classQn)
      if (scopeQn !== undefined) {
        if (kind !== 'internal_module') {
          for (const base of heritageNames(node, source, 'extends')) {
            const res = resolveCall(base, { fileQn: ctx.fileQn, imports: ctx.imports, registry: ctx.registry })
            if (res !== undefined) pushEdge(inherits, edgeOf(ctx.project, scopeQn, res.qn, 'INHERITS'))
          }
          for (const iface of heritageNames(node, source, 'implements')) {
            const res = resolveCall(iface, { fileQn: ctx.fileQn, imports: ctx.imports, registry: ctx.registry })
            if (res !== undefined) pushEdge(implementsEdges, edgeOf(ctx.project, scopeQn, res.qn, 'IMPLEMENTS'))
          }
        }
        pushChildren(stack, node, { callerQn: frame.callerQn, callerIsModule: frame.callerIsModule, classQn: scopeQn })
        continue
      }
      pushChildren(stack, node, frame)
      continue
    }

    if (kind === 'identifier') {
      const name = textOf(source, node)
      if (name.length > 0 && !isDefinitionPosition(node) && !isCalleePosition(node)) {
        const res = resolveCall(name, { fileQn: ctx.fileQn, imports: ctx.imports, registry: ctx.registry })
        if (res !== undefined) {
          pushEdge(usages, {
            source: frame.callerIsModule ? fileNodeId(ctx.project, ctx.relPath) : symbolNodeId(ctx.project, frame.callerQn),
            target: symbolNodeId(ctx.project, res.qn),
            type: 'USAGE',
          })
        }
      }
      continue
    }

    pushChildren(stack, node, frame)
  }

  return { calls, inherits, implements: implementsEdges, usages }
}

/** Emit one CALLS material entry (self-edges dropped, dedup by pair). */
function emitCall(
  sink: { calls: EdgeMaterial[]; seen: Set<string> },
  project: string,
  sourceId: string,
  targetQn: string,
): void {
  const targetId = symbolNodeId(project, targetQn)
  if (sourceId === targetId) return
  const key = `${sourceId}|${targetId}|CALLS`
  if (sink.seen.has(key)) return
  sink.seen.add(key)
  sink.calls.push({ source: sourceId, target: targetId, type: 'CALLS' })
}

export interface ExtractImportsContext {
  readonly project: string
  readonly relPath: string
}

/** Strip surrounding quotes off a string-literal node text. */
function unquoted(text: string): string {
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    return text.slice(1, -1)
  }
  return text
}

/** Resolve `.`/`..` segments against the importing file's directory. */
function normalizeRelative(path: string): string {
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/**
 * Module QN of an import specifier: relative specifiers resolve against the
 * importing file's directory (C resolve_import semantics — the file QN stem,
 * with index/__init__ files absorbed by the QN rule); bare specifiers keep
 * their dotted form (they never match registry QNs, which carry the project
 * prefix — no fabricated edges).
 */
function moduleQnOf(ctx: ExtractImportsContext, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier.split('/').join('.')
  const fileDir = ctx.relPath.includes('/') ? ctx.relPath.slice(0, ctx.relPath.lastIndexOf('/')) : ''
  return computeQualifiedName(ctx.project, normalizeRelative(`${fileDir}/${specifier}`), '')
}

/**
 * Extract the import bindings of one parsed file: named imports map
 * local → `module.symbol` (aliased ones keep the imported symbol), default
 * and namespace imports map local → module QN. Side-effect-only imports
 * produce nothing.
 */
export function extractImports(tree: Tree, source: string, ctx: ExtractImportsContext): ImportBinding[] {
  const out: ImportBinding[] = []
  const push = (localName: string, targetQn: string): void => {
    if (localName.length > 0 && targetQn.length > 0) out.push({ localName, targetQn })
  }

  for (const statement of tree.rootNode.children) {
    if (statement === null || statement.type !== 'import_statement') continue
    const sourceNode = statement.childForFieldName('source')
    if (sourceNode === null) continue
    const specifier = unquoted(textOf(source, sourceNode))
    if (specifier.length === 0) continue
    const moduleQn = moduleQnOf(ctx, specifier)

    const clause = statement.namedChild(0)
    if (clause === null || clause.type !== 'import_clause') continue // side-effect import
    for (const part of clause.namedChildren) {
      if (part === null) continue
      if (part.type === 'identifier') {
        push(textOf(source, part), moduleQn)
        continue
      }
      if (part.type === 'namespace_import') {
        const alias = part.namedChild(0)
        if (alias !== null && alias.type === 'identifier') push(textOf(source, alias), moduleQn)
        continue
      }
      if (part.type === 'named_imports') {
        for (const spec of part.namedChildren) {
          if (spec === null || spec.type !== 'import_specifier') continue
          const nameNode = spec.childForFieldName('name')
          if (nameNode === null) continue
          const imported = textOf(source, nameNode)
          const aliasNode = spec.childForFieldName('alias')
          const local = aliasNode === null ? imported : textOf(source, aliasNode)
          push(local, `${moduleQn}.${imported}`)
        }
      }
    }
  }
  return out
}
