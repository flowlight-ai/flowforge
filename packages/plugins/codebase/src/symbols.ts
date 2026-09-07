/**
 * @flowforge/plugin-codebase — symbol extraction (EP-CB1, T2.2b).
 *
 * Port of codebase-memory-mcp's definition pass (extract_defs.c walk_defs /
 * extract_class_def / extract_class_methods / extract_enum_members /
 * extract_variables) scoped to the TS/TSX/JS grammars:
 *
 * - QN rule (helpers.c cbm_fqn_compute): project + dotted path segments +
 *   name; extension stripped from the last segment, `index`/`__init__` dropped
 *   from the module stem when a name follows, dotfile segments keep their stem.
 * - Explicit-stack walk whose frames carry the enclosing class QN; TS/JS
 *   descend into function bodies so nested named definitions are captured.
 * - Class-family nodes (class/interface/enum/type alias) mint
 *   Class/Interface/Enum/Type labels; enum members become Variable nodes;
 *   methods and class-field arrow functions become Method nodes with
 *   DEFINES_METHOD material (extract_defs.c #new_ts_class_field_arrow).
 * - Module-level `const x = 1` becomes a Variable node; values that are
 *   functions/arrows are skipped here (the function path mints them instead),
 *   and `require()` bindings emit nothing (#871 import-shadow rule).
 *
 * @module @flowforge/plugin-codebase/symbols
 */

import { computeComplexity, countParams } from './complexity.ts'
import type { EdgeType, NodeLabel } from './graph-model.ts'
import type { NodeRecord } from './store.ts'
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

/** Function-shaped node kinds (lang_specs.c ts_func_types, shared by TS/TSX/JS). */
export const FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'function_signature',
])

/** Class-family node kinds (lang_specs.c ts_class_types, internal_module excluded — namespace scope). */
export const CLASS_NODE_TYPES: ReadonlySet<string> = new Set([
  'class_declaration',
  'class',
  'abstract_class_declaration',
  'enum_declaration',
  'interface_declaration',
  'type_alias_declaration',
])

const NAMESPACE_NODE_TYPE = 'internal_module'
const MAX_DOCSTRING_CHARS = 512

/** Variable declaration kinds scanned at module level (js_var_types). */
const VARIABLE_DECLARATION_TYPES: ReadonlySet<string> = new Set([
  'lexical_declaration',
  'variable_declaration',
])

/** Wrapper nodes unwrapped when scanning module-level variables. */
const WRAPPER_NODE_TYPES: ReadonlySet<string> = new Set([
  'expression_statement',
  'export_statement',
  'statement',
])

/** Call-value kinds that mark a declarator as a function definition. */
const FUNCTION_VALUE_TYPES: ReadonlySet<string> = new Set([
  'arrow_function',
  'function_expression',
  'generator_function',
])

/** Enum member kinds (is_enum_member_kind + the 0.23 bare property_identifier). */
const ENUM_MEMBER_TYPES: ReadonlySet<string> = new Set([
  'property_identifier',
  'enum_assignment',
  'enum_member',
  'enum_constant',
  'enum_member_declaration',
])

export interface ExtractSymbolsContext {
  readonly project: string
  readonly relPath: string
  readonly language: string
}

/** Edge material: adjacency without the project dimension. */
export interface EdgeMaterial {
  readonly source: string
  readonly target: string
  readonly type: EdgeType
}

export interface SymbolExtraction {
  readonly nodes: readonly NodeRecord[]
  /** File → symbol DEFINES edges (one per minted symbol). */
  readonly defines: readonly EdgeMaterial[]
  /** Class → Method DEFINES_METHOD edges. */
  readonly methods: readonly EdgeMaterial[]
  /** True when the tree carries an ERROR node (coverage.parse_partial). */
  readonly parseIncomplete: boolean
}

/** Stable id of the File node a symbol's DEFINES edge points from. */
export function fileNodeId(project: string, relPath: string): string {
  return `c:${project}:${relPath}`
}

/** Stable id of a symbol node (QN-scoped; overload collisions dedup on upsert). */
export function symbolNodeId(project: string, qn: string): string {
  return `s:${project}:${qn}`
}

/**
 * Compute a qualified name (helpers.c cbm_fqn_compute): `project.path.parts.name`
 * with the extension stripped from the last path part, `index`/`__init__`
 * skipped as the module stem, and dotfile segments contributing their stem.
 */
export function computeQualifiedName(project: string, relPath: string, name: string): string {
  const out: string[] = [project]
  const hasName = name.length > 0

  // strip_ext_len: last '.' inside the basename only (dotfile markers kept).
  let stemLen = relPath.length
  for (let i = relPath.length; i > 0; i -= 1) {
    const ch = relPath[i - 1]
    if (ch === '.') {
      if (i - 1 === 0 || relPath[i - 2] === '/') break
      stemLen = i - 1
      break
    }
    if (ch === '/') break
  }

  const segments = relPath.slice(0, stemLen).split('/')
  for (let index = 0; index < segments.length; index += 1) {
    const raw = segments[index]
    if (raw === undefined || raw.length === 0) continue
    const isLast = index === segments.length - 1
    if (isLast && hasName && (raw === '__init__' || raw === 'index')) continue
    const segment = raw.startsWith('.') ? raw.slice(1) : raw
    if (segment.length > 0) out.push(segment)
  }
  if (hasName) out.push(name)
  return out.join('.')
}

/** Resolve a function-shaped node's name node (cbm_resolve_func_name, JS/TS paths). */
function resolveFuncName(node: SyntaxNode): SyntaxNode | undefined {
  const byField = node.childForFieldName('name')
  if (byField !== null) return byField
  if (node.type !== 'arrow_function') return undefined
  // resolve_toplevel_arrow_name: parent declarator/field/pair carries the name.
  const parent = node.parent
  if (parent === null) return undefined
  const parentKind = parent.type
  if (parentKind === 'variable_declarator' || parentKind === 'public_field_definition') {
    return parent.childForFieldName('name') ?? undefined
  }
  if (parentKind === 'field_definition') {
    return parent.childForFieldName('property') ?? undefined
  }
  if (parentKind === 'pair') {
    return parent.childForFieldName('key') ?? undefined
  }
  return undefined
}

interface LineSpan {
  readonly startLine: number
  readonly endLine: number
}

function spanOf(node: SyntaxNode): LineSpan {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 }
}

function textOf(source: string, node: SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex)
}

/** Normalize a return_type annotation: TS field text is `: T`, strip the colon. */
function returnTypeTextOf(source: string, node: SyntaxNode): string {
  let text = textOf(source, node).trim()
  if (text.startsWith(':')) text = text.slice(1).trim()
  return text
}

/** Docstring: the comment immediately preceding the definition (extract_docstring). */
function docstringOf(source: string, node: SyntaxNode): string | undefined {
  const parent = node.parent
  if (parent === null) return undefined
  let prev: SyntaxNode | null = null
  for (const child of parent.children) {
    if (child === null) continue
    if (child.id === node.id) break
    prev = child
  }
  if (prev === null || prev.type !== 'comment') return undefined
  const text = textOf(source, prev).trim()
  if (text.length === 0) return undefined
  return text.length > MAX_DOCSTRING_CHARS ? text.slice(0, MAX_DOCSTRING_CHARS) : text
}

/** is_test for JS/TS (helpers.c cbm_is_test_file): stem suffix/prefix conventions. */
export function isTestFilePath(relPath: string): boolean {
  if (relPath.includes('__tests__/') || relPath.includes('/tests/') || relPath.includes('/test/') || relPath.includes('/spec/')) return true
  if (relPath.startsWith('tests/') || relPath.startsWith('test/') || relPath.startsWith('spec/') || relPath.startsWith('__tests__/')) return true
  const base = relPath.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const noExt = dot > 0 ? base.slice(0, dot) : base
  return noExt.endsWith('.test') || noExt.endsWith('.spec') || noExt.endsWith('_test') || noExt.endsWith('_spec') || base.startsWith('test_')
}

interface SymbolSink {
  readonly project: string
  readonly relPath: string
  readonly language: string
  readonly source: string
  readonly isTestFile: boolean
  readonly nodes: NodeRecord[]
  readonly defines: EdgeMaterial[]
  readonly methods: EdgeMaterial[]
}

interface MintOptions {
  readonly label: NodeLabel
  readonly name: string
  readonly qn: string
  readonly span: LineSpan
  readonly parentClass?: string
  readonly props?: Record<string, string | number | boolean>
}

function mintSymbol(sink: SymbolSink, options: MintOptions): string {
  const id = symbolNodeId(sink.project, options.qn)
  const { startLine, endLine } = options.span
  sink.nodes.push({
    id,
    project: sink.project,
    label: options.label,
    name: options.qn,
    filePath: sink.relPath,
    language: sink.language,
    lines: endLine - startLine + 1,
    props: {
      shortName: options.name,
      startLine,
      endLine,
      ...(sink.isTestFile ? { isTest: true } : {}),
      ...(options.parentClass === undefined ? {} : { parentClass: options.parentClass }),
      ...(options.props ?? {}),
    },
  })
  sink.defines.push({ source: fileNodeId(sink.project, sink.relPath), target: id, type: 'DEFINES' })
  if (options.label === 'Method' && options.parentClass !== undefined) {
    sink.methods.push({ source: symbolNodeId(sink.project, options.parentClass), target: id, type: 'DEFINES_METHOD' })
  }
  return id
}

/** Complexity property family for Function/Method nodes (set_def_complexity). */
function complexityPropsOf(node: SyntaxNode): Record<string, number> {
  const metrics = computeComplexity(node)
  return {
    complexity: metrics.complexity,
    cognitive: metrics.cognitive,
    loopCount: metrics.loopCount,
    loopDepth: metrics.loopDepth,
    maxAccessDepth: metrics.maxAccessDepth,
  }
}

/** extract_func_def (TS scope): Function node with signature/return type/complexity. */
function extractFuncDef(sink: SymbolSink, node: SyntaxNode, enclosing: string | undefined): void {
  const nameNode = resolveFuncName(node)
  if (nameNode === undefined) return
  const name = textOf(sink.source, nameNode)
  if (name.length === 0 || name === 'function') return

  const params = node.childForFieldName('parameters')
  const returnTypeNode = node.childForFieldName('return_type')
  const doc = docstringOf(sink.source, node)
  mintSymbol(sink, {
    label: 'Function',
    name,
    qn: enclosing === undefined ? computeQualifiedName(sink.project, sink.relPath, name) : `${enclosing}.${name}`,
    span: spanOf(node),
    props: {
      ...(params === null ? {} : { signature: textOf(sink.source, params), paramCount: countParams(params) }),
      ...(returnTypeNode === null ? {} : { returnType: returnTypeTextOf(sink.source, returnTypeNode) }),
      ...complexityPropsOf(node),
      ...(doc === undefined ? {} : { docstring: doc }),
    },
  })
}

/** push_method_def: Method node under the class QN, with DEFINES_METHOD material. */
function pushMethodDef(sink: SymbolSink, node: SyntaxNode, classQn: string, nameNode: SyntaxNode): void {
  const name = textOf(sink.source, nameNode)
  if (name.length === 0) return
  const params = node.childForFieldName('parameters')
  const returnTypeNode = node.childForFieldName('return_type')
  mintSymbol(sink, {
    label: 'Method',
    name,
    qn: `${classQn}.${name}`,
    span: spanOf(node),
    parentClass: classQn,
    props: {
      ...(params === null ? {} : { signature: textOf(sink.source, params), paramCount: countParams(params) }),
      ...(returnTypeNode === null ? {} : { returnType: returnTypeTextOf(sink.source, returnTypeNode) }),
      ...complexityPropsOf(node),
    },
  })
}

/** class_label_for_kind (TS kinds only). */
function classLabelForKind(kind: string): NodeLabel {
  if (kind === 'interface_declaration') return 'Interface'
  if (kind === 'enum_declaration') return 'Enum'
  if (kind === 'type_alias_declaration') return 'Type'
  return 'Class'
}

/** Enum member display name: bare property_identifier or the inner identifier. */
function enumMemberName(sink: SymbolSink, member: SyntaxNode): string | undefined {
  if (member.type === 'property_identifier') return textOf(sink.source, member)
  for (const child of member.namedChildren) {
    if (child === null) continue
    if (child.type === 'property_identifier' || child.type === 'identifier') return textOf(sink.source, child)
  }
  return undefined
}

/** extract_enum_members: each enum member becomes a Variable node. */
function extractEnumMembers(sink: SymbolSink, node: SyntaxNode, classQn: string): void {
  const body = node.childForFieldName('body')
  if (body === null) return
  for (const member of body.namedChildren) {
    if (member === null || !ENUM_MEMBER_TYPES.has(member.type)) continue
    const name = enumMemberName(sink, member)
    if (name === undefined || name.length === 0) continue
    mintSymbol(sink, { label: 'Variable', name, qn: `${classQn}.${name}`, span: spanOf(member) })
  }
}

/** extract_class_methods (TS scope): method_definition + class-field arrow functions. */
function extractClassMethods(sink: SymbolSink, node: SyntaxNode, classQn: string): void {
  const body = node.childForFieldName('body')
  if (body === null) return
  for (const child of body.children) {
    if (child === null) continue
    if (child.type === 'method_definition') {
      const nameNode = child.childForFieldName('name')
      if (nameNode !== null) pushMethodDef(sink, child, classQn, nameNode)
      continue
    }
    // #new_ts_class_field_arrow: `handleClick = () => {...}` mints a Method.
    if (child.type === 'public_field_definition') {
      const value = child.childForFieldName('value')
      if (value === null || !FUNCTION_NODE_TYPES.has(value.type)) continue
      const nameNode = child.childForFieldName('name')
      if (nameNode === null) continue
      pushMethodDef(sink, value, classQn, nameNode)
    }
  }
}

/** compute_class_qn: enclosing chain or file-based QN. */
function computeClassQn(sink: SymbolSink, node: SyntaxNode, savedEnclosing: string | undefined): string | undefined {
  const nameNode = node.childForFieldName('name')
  if (nameNode === null) return savedEnclosing
  const name = textOf(sink.source, nameNode)
  if (name.length === 0) return savedEnclosing
  if (savedEnclosing !== undefined) return `${savedEnclosing}.${name}`
  return computeQualifiedName(sink.project, sink.relPath, name)
}

/** push_var_def: module-level Variable node (QN is file-scoped, never class-scoped). */
function pushVarDef(sink: SymbolSink, name: string, node: SyntaxNode): void {
  if (name.length === 0 || name === '_') return
  mintSymbol(sink, { label: 'Variable', name, qn: computeQualifiedName(sink.project, sink.relPath, name), span: spanOf(node) })
}

/** destructure_ident: identifier behind a pattern child. */
function destructureIdent(patternChild: SyntaxNode): SyntaxNode | undefined {
  const kind = patternChild.type
  if (kind === 'shorthand_property_identifier_pattern' || kind === 'identifier') return patternChild
  if (kind === 'pair_pattern') {
    return patternChild.childForFieldName('value') ?? undefined
  }
  return patternChild.namedChildren[0] ?? undefined
}

/** extract_destructured_vars: one Variable per destructured binding. */
function extractDestructuredVars(sink: SymbolSink, pattern: SyntaxNode, decl: SyntaxNode): void {
  for (const patternChild of pattern.namedChildren) {
    if (patternChild === null) continue
    const ident = destructureIdent(patternChild)
    if (ident === undefined) continue
    const text = textOf(sink.source, ident)
    if (text.length > 0) pushVarDef(sink, text, decl)
  }
}

/** is_require_import_call: CommonJS `require('...')` binding (#871 skip rule). */
function isRequireImportCall(sink: SymbolSink, value: SyntaxNode): boolean {
  if (value.type !== 'call_expression') return false
  const fn = value.childForFieldName('function')
  if (fn === null || fn.type !== 'identifier') return false
  if (textOf(sink.source, fn) !== 'require') return false
  const args = value.childForFieldName('arguments')
  if (args === null) return false
  for (const arg of args.namedChildren) {
    if (arg === null) continue
    if (arg.type === 'string' || arg.type === 'template_string') return true
  }
  return false
}

/** extract_js_vars: module-level declarators, skipping function values. */
function extractJsVars(sink: SymbolSink, node: SyntaxNode): void {
  for (const child of node.namedChildren) {
    if (child === null || child.type !== 'variable_declarator') continue
    let isRequire = false
    const value = child.childForFieldName('value')
    if (value !== null) {
      if (FUNCTION_VALUE_TYPES.has(value.type)) continue
      isRequire = isRequireImportCall(sink, value)
    }
    const nameNode = child.childForFieldName('name')
    if (nameNode === null) continue
    if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
      extractDestructuredVars(sink, nameNode, child)
      continue
    }
    if (isRequire) continue
    pushVarDef(sink, textOf(sink.source, nameNode), child)
  }
}

interface WalkFrame {
  readonly node: SyntaxNode
  readonly enclosing: string | undefined
}

function pushChildren(stack: WalkFrame[], node: SyntaxNode, enclosing: string | undefined): void {
  const children = node.children
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child != null) stack.push({ node: child, enclosing })
  }
}

/**
 * push_nested_class_nodes: only nested class-family nodes of a class body
 * re-enter the walk (with the class QN as their enclosing scope). Methods
 * were already minted by extractClassMethods — pushing them again would
 * double-mint every method as a free Function.
 */
function pushNestedClassNodes(stack: WalkFrame[], classNode: SyntaxNode, enclosing: string | undefined): void {
  const body = classNode.childForFieldName('body')
  if (body === null) {
    pushChildren(stack, classNode, enclosing)
    return
  }
  for (const child of body.children) {
    if (child !== null && CLASS_NODE_TYPES.has(child.type)) stack.push({ node: child, enclosing })
  }
}

/**
 * Extract the symbol slice of one parsed file. The walk mirrors walk_defs:
 * explicit stack, frames carry the enclosing class QN, TS/JS descend into
 * function bodies, classes re-scope their body children, namespaces
 * (internal_module) extend the scope and mint a Module node.
 */
export function extractSymbols(tree: Tree, source: string, context: ExtractSymbolsContext): SymbolExtraction {
  const sink: SymbolSink = {
    project: context.project,
    relPath: context.relPath,
    language: context.language,
    source,
    isTestFile: isTestFilePath(context.relPath),
    nodes: [],
    defines: [],
    methods: [],
  }

  const stack: WalkFrame[] = [{ node: tree.rootNode, enclosing: undefined }]
  while (stack.length > 0) {
    const frame = stack.pop() as WalkFrame
    const node = frame.node
    const kind = node.type

    if (kind === NAMESPACE_NODE_TYPE) {
      // TS namespace: scope extender + Module def (extract_typescript_namespace_def).
      const namespaceQn = computeClassQn(sink, node, frame.enclosing)
      const nameNode = node.childForFieldName('name')
      if (namespaceQn !== undefined && nameNode !== null) {
        const name = textOf(sink.source, nameNode)
        if (name.length > 0) {
          mintSymbol(sink, { label: 'Module', name, qn: namespaceQn, span: spanOf(node) })
        }
      }
      pushChildren(stack, node, namespaceQn)
      continue
    }

    if (FUNCTION_NODE_TYPES.has(kind)) {
      extractFuncDef(sink, node, frame.enclosing)
      // TS/JS descend into function bodies for nested named definitions.
      pushChildren(stack, node, frame.enclosing)
      continue
    }

    if (CLASS_NODE_TYPES.has(kind)) {
      // extract_class_def + push_class_body_children: methods are minted by
      // extractClassMethods, so only nested class nodes re-enter the walk.
      const classQn = computeClassQn(sink, node, frame.enclosing)
      if (classQn !== undefined) {
        const label = classLabelForKind(kind)
        const nameNode = node.childForFieldName('name')
        const name = nameNode === null ? '' : textOf(sink.source, nameNode)
        const doc = docstringOf(sink.source, node)
        mintSymbol(sink, {
          label,
          name,
          qn: classQn,
          span: spanOf(node),
          ...(doc === undefined ? {} : { props: { docstring: doc } }),
        })
        if (label === 'Enum') extractEnumMembers(sink, node, classQn)
        extractClassMethods(sink, node, classQn)
        pushNestedClassNodes(stack, node, classQn)
        continue
      }
      pushNestedClassNodes(stack, node, frame.enclosing)
      continue
    }

    pushChildren(stack, node, frame.enclosing)
  }

  // Module-level variables (extract_variables): top-level declarations plus
  // wrappers (export_statement etc.).
  for (const child of tree.rootNode.namedChildren) {
    if (child === null) continue
    if (VARIABLE_DECLARATION_TYPES.has(child.type)) {
      extractJsVars(sink, child)
      continue
    }
    if (WRAPPER_NODE_TYPES.has(child.type)) {
      for (const inner of child.namedChildren) {
        if (inner === null) continue
        if (VARIABLE_DECLARATION_TYPES.has(inner.type)) extractJsVars(sink, inner)
      }
    }
  }

  return {
    nodes: sink.nodes,
    defines: sink.defines,
    methods: sink.methods,
    parseIncomplete: tree.rootNode.hasError,
  }
}
