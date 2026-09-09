/**
 * Compact, self-contained cordis API catalog served to the model via the
 * `Service` / `Event` inspect providers (seam port of the generated dsh
 * `api-catalog.ts`). The shipped catalog is a large generated table bound to
 * the web bundle's AST; this package carries a reduced, hand-maintained subset
 * covering the browser-half-reachable seats (`slots`, `theme`, `timer`) so the
 * provider logic and its contract tests run deterministically without DSH
 * infrastructure. The query projections (`queryServiceApi` / `queryEventApi`)
 * are ported verbatim.
 *
 * @module @flowforge/cordis-client-runner/api-catalog
 */

/** One named parameter in a Service method or Event listener. */
export interface ApiParameter {
  /** Parameter name from the exact signature. */
  name: string
  /** Source-owned parameter contract. */
  description: string
}

/** One public service member and its source-owned contract. */
export interface ServiceApiMethod {
  /** Public method signature with its body stripped. */
  signature: string
  /** Method purpose and behavior. */
  description: string
  /** Named parameters in signature order. */
  parameters: readonly ApiParameter[]
  /** Non-void result contract when documented. */
  returns?: string
  /** Documented failure conditions. */
  throws?: readonly string[]
}

/** One `ctx.<key>` service and its public methods. */
export interface ServiceApiEntry {
  /** The `ctx.<key>` name, e.g. `slots`. */
  key: string
  /** First sentence of the service class JSDoc. */
  summary: string
  /** Complete service description. */
  description: string
  /** Public methods, bodies stripped, in source order. */
  methods: readonly ServiceApiMethod[]
}

/** One event: its dispatch mode, exact signature, and listener contract. */
export interface EventApiEntry {
  /** The scoped event name, e.g. `slots/changed`. */
  name: string
  /** The dispatch mode from the declaration's `@mode` tag. */
  mode: string
  /** The exact listener signature, whitespace-normalized. */
  signature: string
  /** First sentence of the event JSDoc. */
  summary: string
  /** Complete event description. */
  description: string
  /** Named listener parameters in signature order. */
  parameters: readonly ApiParameter[]
}

/** One inherited `ctx` member group with its summary. */
export interface InheritedApiEntry {
  /** The `ctx` member name(s), e.g. `ctx.on / ctx.once`. */
  name: string
  /** One-line summary of what the member does. */
  summary: string
}

/** One named type declaration referenced by a Service or Event signature. */
export interface TypeApiEntry {
  /** The exported type/interface name, e.g. `LocaleSnapshot`. */
  name: string
  /** The full declaration text, comments stripped. */
  declaration: string
}

/** The browser-half-reachable services served by this package. */
export const SERVICE_API: readonly ServiceApiEntry[] = [
  {
    key: 'slots',
    summary: 'cordis Service layer of the slot system: register components into declared slots.',
    description: 'Single registration API plus per-declaration injection effect. A browser half declares `inject: [\'slots\']` and registers components via `ctx.slots.register(options, component)`.',
    methods: [
      {
        signature: 'register(options, component): () => void',
        description: 'Register a component into a slot. Options must carry a string `name` (the slot key); the dynamic Guard assigns priority automatically.',
        parameters: [
          { name: 'options', description: 'registration options, minimally `{ name }`.' },
          { name: 'component', description: 'the seated component.' },
        ],
        returns: 'a disposer removing exactly this entry.',
      },
    ],
  },
  {
    key: 'theme',
    summary: 'Theme registry and token override layers.',
    description: 'Theme token access and `overrideTokens` partial token layers over the active theme. The dynamic Guard pins a package\'s override source to its package id.',
    methods: [
      {
        signature: 'overrideTokens(source: string, tokens): () => void',
        description: 'Stack a token override layer on the active theme; removing a layer restores what it covered.',
        parameters: [
          { name: 'source', description: 'layer identity; one layer per source.' },
          { name: 'tokens', description: 'token-name → `{ light, dark }` value pairs.' },
        ],
        returns: 'a disposer removing exactly the layer this call created.',
      },
    ],
  },
  {
    key: 'timer',
    summary: 'Disposable timer helpers mixed into Cordis contexts.',
    description: 'Run a callback once (`timeout`), repeatedly (`interval`), or through throttle/debounce; every timer belongs to the calling fiber and is disposed with it.',
    methods: [
      {
        signature: 'timeout(callback, delay): () => void',
        description: 'Run a callback once after a delay; returns its disposer.',
        parameters: [],
      },
      {
        signature: 'interval(callback, delay): () => void',
        description: 'Run a callback repeatedly; returns its disposer.',
        parameters: [],
      },
      {
        signature: 'throttle(callback, delay, noTrailing?): F & { dispose: () => void }',
        description: 'Return a throttled function disposed with the current fiber.',
        parameters: [],
      },
      {
        signature: 'debounce(callback, delay): F & { dispose: () => void }',
        description: 'Return a debounced function disposed with the current fiber.',
        parameters: [],
      },
    ],
  },
]

/** The events served by this package. */
export const EVENT_API: readonly EventApiEntry[] = [
  {
    name: 'slots/changed',
    mode: 'emit',
    signature: '\'slots/changed\'(key: string): void',
    summary: 'A slot declaration or registration set changed.',
    description: 'A slot declaration or registration set changed.',
    parameters: [{ name: 'key', description: 'mutated slot key.' }],
  },
]

/** The inherited `ctx` API, in curated order. */
export const INHERITED_CTX_API: readonly InheritedApiEntry[] = [
  { name: 'ctx.effect', summary: 'Register a disposable side effect tied to the fiber.' },
  { name: 'ctx.get / ctx.provide', summary: 'Low-level service-store access and binding.' },
]

/** Referenced type shapes (reduced subset of the shipped catalog). */
export const TYPE_API: readonly TypeApiEntry[] = [
  {
    name: 'LocaleSnapshot',
    declaration: 'export interface LocaleSnapshot {\n    active: LocaleId;\n    locales: readonly LocaleDefinition[];\n    revision: number;\n}',
  },
  {
    name: 'ThemeSnapshot',
    declaration: 'export interface ThemeSnapshot {\n    preference: ThemePreference;\n    fontSize: number;\n    active: ThemeDefinition;\n    themes: readonly ThemeDefinition[];\n    revision: number;\n}',
  },
]

function referencedTypeClosure(seeds: readonly string[]): TypeApiEntry[] {
  const included = new Set<string>()
  let frontier = [...seeds]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const entry of TYPE_API) {
      if (included.has(entry.name)) continue
      const pattern = new RegExp(`\\b${entry.name}\\b`)
      if (!frontier.some(text => pattern.test(text))) continue
      included.add(entry.name)
      next.push(entry.declaration)
    }
    frontier = next
  }
  return TYPE_API.filter(entry => included.has(entry.name))
}

/** Query the metric catalog as a compact directory or one exact coding contract. */
export function queryServiceApi(key?: string, services: readonly ServiceApiEntry[] = SERVICE_API): object {
  if (key === undefined) {
    return {
      mode: 'catalog',
      services: services.map(service => ({
        key: service.key,
        description: service.summary,
        methods: service.methods.map(method => ({ signature: method.signature })),
      })),
    }
  }
  const service = services.find(candidate => candidate.key === key)
  if (service === undefined) throw new Error(`no catalogued Service named "${key}"`)
  return {
    mode: 'service',
    service: {
      key: service.key,
      description: service.description,
      access: {
        optional: { expression: `ctx.get(${JSON.stringify(service.key)})`, requiresUndefinedCheck: true },
        hardDependency: { inject: [service.key], expression: `ctx.${service.key}` },
      },
      methods: service.methods,
    },
    referencedTypes: referencedTypeClosure(service.methods.map(method => method.signature)),
  }
}

/** Query the event catalog as a compact directory or one exact listener contract. */
export function queryEventApi(name?: string, events: readonly EventApiEntry[] = EVENT_API): object {
  if (name === undefined) {
    return {
      mode: 'catalog',
      events: events.map(event => ({
        name: event.name,
        description: event.summary,
        mode: event.mode,
        signature: event.signature,
      })),
    }
  }
  const event = events.find(candidate => candidate.name === name)
  if (event === undefined) throw new Error(`no catalogued Event named "${name}"`)
  return {
    mode: 'event',
    event: {
      name: event.name,
      description: event.description,
      mode: event.mode,
      signature: event.signature,
      parameters: event.parameters,
    },
    referencedTypes: referencedTypeClosure([event.signature]),
  }
}