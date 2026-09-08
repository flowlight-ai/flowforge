/**
 * Browser-half closure evaluation for dynamic packages: the package source runs
 * as the body of an async function whose parameters ARE the symbol surface.
 * Shadowing parameters (setTimeout/fetch/require/…) turn the ambient browser
 * globals into teaching redirects without touching the page.
 *
 * The React runtime and the console are injected through the closure env
 * (`react`, `console`) so this package never imports a UI framework; DOM style
 * insertion goes through {@link DynamicCordisStyles}, which writes to a
 * package-local style-document port.
 *
 * @module @flowforge/cordis-client-runner/evaluator
 */

import { DYNAMIC_CLIENT_REDIRECTS, messages } from './messages.ts'
import type { CordisDynamicPluginId } from './types.ts'
import type { StyleDocumentPort } from './ports/style.ts'

/** A mountable plugin as the closure must return it (FUNCTION or OBJECT form). */
export interface DynamicCordisEvaluatedPlugin {
  /** Optional plugin name; the runner overwrites it with the module id. */
  name?: string
  /** Services the browser half declares; the runner overwrites it from the dispatched row. */
  inject?: readonly string[]
  /** Plugin body receiving the guard facade. */
  apply: (ctx: unknown, config?: unknown) => unknown
}

/** What the evaluator needs from the runner to build one package's closure. */
export interface DynamicCordisClosureEnv {
  /** Record one runtime error text into the load report. */
  noteError(message: string): void
  /** Route `host.call` to this package's host half. */
  invoke(method: string, args: unknown): Promise<unknown>
  /** The React runtime exposed to the closure (no JSX transform). */
  react?: unknown
  /** Optional console seam; defaults to the ambient console. */
  console?: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>
}

/** Narrow a closure return value to a mountable plugin. */
export function isDynamicCordisPlugin(
  value: unknown,
): value is DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown) {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null
    && typeof (value as { apply?: unknown }).apply === 'function'
}

/** Callable teaching traps shadowing the ambient globals the closure must not reach. */
function closureTraps(redirects: Readonly<Record<string, string>>): Record<string, () => never> {
  const traps: Record<string, () => never> = {}
  for (const [name, redirect] of Object.entries(redirects)) {
    traps[name] = (): never => {
      throw new Error(`${name} is not available in a dynamic client half — ${redirect}`)
    }
  }
  return traps
}

/** The `harness` seat exists only host-side; any touch teaches the split. */
function harnessTrap(): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      throw new Error(messages.harnessSeat(String(prop)))
    },
  })
}

/** Stringify one console argument for the error mirror. */
export function errorText(arg: unknown): string {
  if (arg instanceof Error) return arg.message
  if (typeof arg === 'string') return arg
  if (arg === undefined) return 'undefined'
  try {
    return JSON.stringify(arg)
  } catch {
    return '[unserializable console argument]'
  }
}

/** Tagged write-through console; error lines additionally copy into the load report. */
function taggedConsole(
  pluginId: CordisDynamicPluginId,
  noteError: (message: string) => void,
  target: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>,
): Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'> {
  const tag = `[cordis:${pluginId}]`
  const forward = (level: 'log' | 'info' | 'warn' | 'error' | 'debug') => (...args: unknown[]): void => {
    target[level](tag, ...args)
    if (level !== 'error') return
    noteError(args.map(errorText).join(' ').slice(0, 500))
  }
  return {
    log: forward('log'),
    info: forward('info'),
    warn: forward('warn'),
    error: forward('error'),
    debug: forward('debug'),
  }
}

/**
 * Per-package style-tag bookkeeping behind the `styles.insert` symbol. Writes
 * through a style-document port so unload can dispose every owned tag.
 */
export class DynamicCordisStyles {
  private readonly tags = new Set<ReturnType<StyleDocumentPort['createStyleNode']>>()

  /** @param doc - style-document seam (page head adapter or memory impl). */
  constructor(doc: StyleDocumentPort, private readonly pluginId: CordisDynamicPluginId) {
    this.doc = doc
  }

  private readonly doc: StyleDocumentPort

  /**
   * Inject one stylesheet, removed automatically on package unload.
   * @param css - raw CSS text.
   * @returns disposer removing this one tag early.
   */
  insert(css: string): () => void {
    if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
    const tag = this.doc.createStyleNode(this.pluginId)
    tag.textContent = css
    this.doc.attach(tag)
    this.tags.add(tag)
    return (): void => {
      this.tags.delete(tag)
      this.doc.detach(tag)
    }
  }

  /** Live tag count (load-report contribution summary). */
  get count(): number {
    return this.tags.size
  }

  /** Remove every tag this package still owns (unload path). */
  dispose(): void {
    for (const tag of this.tags) this.doc.detach(tag)
    this.tags.clear()
  }
}

/**
 * Evaluate one package's browser half and return the (un-guarded) plugin.
 * @param pluginId - stable Plugin ID (console tag and style ownership).
 * @param clientCode - the browser half's source: an async function body returning a plugin.
 * @param env - runner wiring for `host.call`, error mirroring, React and console.
 * @param styles - the package's style bookkeeping (owned by the caller so unload can dispose it).
 * @returns the plugin the closure returned.
 * @throws teaching errors for syntax failures and non-plugin returns.
 */
export async function evaluateClientHalf(
  pluginId: CordisDynamicPluginId,
  clientCode: string,
  env: DynamicCordisClosureEnv,
  styles: DynamicCordisStyles,
): Promise<DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown)> {
  const traps = closureTraps(DYNAMIC_CLIENT_REDIRECTS)
  const parameters = ['React', 'console', 'styles', 'host', 'harness', ...Object.keys(traps), 'process', 'Buffer']
  let closure: (...args: unknown[]) => Promise<unknown>
  try {
    // The wrapper mirrors the host precheck exactly, so line offsets match.
    const factory = new Function(...parameters, `return (async () => {\n${clientCode}\n})()`)
    closure = factory as (...args: unknown[]) => Promise<unknown>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new Error(messages.parseFailed(error.message))
  }
  const host = {
    call: (method: string, args: unknown = null): Promise<unknown> => env.invoke(method, args),
  }
  const target = env.console ?? console
  const returned = await closure(
    env.react,
    taggedConsole(pluginId, message => { env.noteError(message) }, target),
    styles,
    host,
    harnessTrap(),
    ...Object.values(traps),
    undefined, // process: undefined keeps `typeof process` probes safe
    undefined, // Buffer
  )
  if (!isDynamicCordisPlugin(returned)) {
    if (returned === undefined) throw new Error(messages.undefinedReturn())
    throw new Error(messages.invalidReturn())
  }
  return returned
}