/**
 * Compact, self-contained slot catalog: the regisable slot surface of the web
 * bundle (seam port of the generated dsh `slot-catalog.ts`). The shipped catalog
 * is a large generated table bound to the bundle's AST; this package carries a
 * reduced, hand-maintained set of representative seats (`conversation` and a
 * keyed `tool.view.cordis` seat) so the `Slots` inspect provider and its tests
 * run deterministically without DSH infrastructure. The public shapes
 * (`ClientSlotOption` / `ClientSlotEntry`) match the generated module.
 *
 * @module @flowforge/cordis-client-runner/slot-catalog
 */

/** One option a register call passes for a given slot cardinality. */
export interface ClientSlotOption {
  /** Option name as written in the register options object. */
  name: string
  /** Whether the cardinality requires it. */
  requirement: string
  /** Accepted type, in source spelling. */
  type: string
  /** What it does, from the registrant's side. */
  doc: string
}

/** One browser-half slot a dynamic package can contribute UI into. */
export interface ClientSlotEntry {
  /** SlotMap key passed as the register call's `name`. */
  key: string
  /** Cardinality: `single`, `list`, `keyed`, or `chain`. */
  kind: string
  /** Data scope: `root`, `session`, or `session-maybe`. */
  scope: string
  /** First sentence of the contract prose. */
  summary: string
  /** Full contract prose from the SlotMap declaration. */
  doc: string
  /** Options this cardinality accepts (beyond `name`). */
  registerOptions: readonly ClientSlotOption[]
  /** Declarations of the props the owner passes down. */
  ownerProps: readonly string[]
  /** Names of the shapes those props reference. */
  ownerPropsReferences: readonly string[]
  /** Framework-supplied component props for this scope. */
  standardProps: readonly string[]
  /** For keyed slots: how the key set is constrained and which keys are taken. */
  keyDomain: string
  /** Opaque per-render-site context passed to slot-level hooks, when declared. */
  hookContext: string
  /** Slot-level inject face every entry receives, when declared. */
  slotInject: string
  /** Which mounted entry makes this slot exist. */
  declaredBy: string
  /** Entries the shipped composition already registered here. */
  occupants: readonly string[]
  /** `shadows-shipped-ui` when registering here replaces shipped UI; `none` when additive. */
  replaceRisk: string
  /** A minimal browser half that registers into this slot. */
  example: string
  /** Source pointer of the contract declaration. */
  source: string
}

/** Rules that apply to every browser-half contribution, in reading order. */
export const CLIENT_NOTES: readonly string[] = [
  'Contribute UI only through `ctx.slots.register(options, Component)`; declare `inject: [\'slots\']` in your returned plugin.',
  'Do NOT pass `priority`: the browser-half facade assigns one automatically, LOWER than every shipped entry.',
  'Build markup with `React.createElement` and ship CSS through `styles.insert(css)`; use theme CSS variables.',
]

/** Every slot this package catalogs, sorted by key. */
export const CLIENT_SLOT_API: readonly ClientSlotEntry[] = [
  {
    key: 'conversation',
    kind: 'single',
    scope: 'session-maybe',
    summary: 'The whole center column, across both the no-session hero and a live conversation.',
    doc: 'The whole center column. OCCUPIED by the conversation root: registering here replaces the entire conversation surface rather than adding to it.',
    registerOptions: [],
    ownerProps: [],
    ownerPropsReferences: [],
    standardProps: ['useSessions', 'sessionId: SessionId | undefined', 'useConversation'],
    keyDomain: '',
    hookContext: '',
    slotInject: '',
    declaredBy: 'an entry in \'root\' (client-ui-layout)',
    occupants: ['client-ui-conversation ConversationRoot'],
    replaceRisk: 'shadows-shipped-ui',
    example: 'return {\n  inject: [\'slots\'],\n  apply(ctx) {\n    ctx.slots.register({ name: \'conversation\' }, () => React.createElement(\'div\'))\n  },\n}',
    source: 'packages/client/ui-layout (catalog subset)',
  },
  {
    key: 'tool.view.cordis',
    kind: 'keyed',
    scope: 'session',
    summary: 'The Cordis dynamic-plugin definition card, one per keyed entry.',
    doc: 'One definition card per key. The dynamic Guard fixes the key domain: only `self` is accepted, and it is bound to this Package\'s plugin id + package id.',
    registerOptions: [{ name: 'key', requirement: 'required', type: 'string', doc: 'the keyed entry selector; the dynamic Guard accepts only `self`.' }],
    ownerProps: [],
    ownerPropsReferences: [],
    standardProps: ['useSessions', 'sessionId: SessionId'],
    keyDomain: 'fixed by the dynamic Client Guard',
    hookContext: '',
    slotInject: '',
    declaredBy: 'the panel that hosts Cordis definition cards',
    occupants: [],
    replaceRisk: 'shadows-shipped-ui',
    example: 'return {\n  inject: [\'slots\'],\n  apply(ctx) {\n    ctx.slots.register({ name: \'tool.view.cordis\', key: \'self\' }, () => React.createElement(\'div\'))\n  },\n}',
    source: 'packages/client/ui-cordis (catalog subset)',
  },
]