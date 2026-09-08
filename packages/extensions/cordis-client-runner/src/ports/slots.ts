/**
 * Package-local slot registry port (`ClientSlotsPort`) + a real in-memory
 * implementation (`MemoryClientSlots`). Stands in for the dsh
 * `dsh-client-ui-renderer` SlotRegistry that the runner (entry-crash
 * supervision), the guard (register facade / spec lookup) and the inspect
 * providers (snapshot projection) all consumed. Per the seam pattern: a port
 * interface + a real memory implementation, no mocks.
 *
 * This is a deliberately small slice of cordis slot semantics — enough for the
 * guard's shadowing-priority ledger, the runner's render-crash attribution and
 * the providers' tree projection — not a full SlotCore port.
 *
 * @module @flowforge/cordis-client-runner/ports/slots
 */

/** One stored slot entry, retaining its component verbatim. */
export interface StoredSlotEntry {
  readonly key: string
  readonly options: Record<string, unknown>
  /** The component object/fn a package seated; crash attribution key. */
  readonly component: unknown
  /** Which async apply registered it (attribution aid). */
  readonly registrant?: string
}

/** A declaration describing one slot and the relationship that shapes snapshots. */
export interface SlotDeclarationSpec {
  readonly kind: 'single' | 'list' | 'keyed' | 'chain'
  readonly scope: 'root' | 'session-maybe' | 'session'
  readonly parent?: string
}

/** One node in a slot snapshot tree. */
export interface LiveSlotNode {
  readonly name: string
  readonly kind: string
  readonly scope: string
  readonly occupants: readonly { readonly key?: unknown; readonly component: unknown }[]
  readonly children: readonly LiveSlotNode[]
  readonly declaredBy?: string
}

/** Metadata a slot-entry crash reports. */
export interface SlotEntryCrashInfo {
  readonly abdicated: boolean
}

/** The package-local slot service surface consumed by runner / guard / providers. */
export interface ClientSlotsPort {
  /**
   * Register a slot declaration (its kind/scope, and optional nesting parent).
   * @param key - slot key.
   * @param spec - declaration metadata.
   */
  declare(key: string, spec: SlotDeclarationSpec): void
  /**
   * Read a declaration.
   * @param key - slot key.
   */
  spec(key: string): SlotDeclarationSpec | undefined
  /**
   * Register a component into a slot.
   * @param options - registration options (must carry a string `name`).
   * @param component - the seated component.
   * @returns a disposer removing exactly this entry.
   */
  register(options: { name: string; [option: string]: unknown }, component: unknown): () => void
  /**
   * Read the live entries of one slot.
   * @param key - slot key.
   */
  entries(key: string): readonly StoredSlotEntry[]
  /**
   * Subscribe to every entry crash on the page.
   * @param listener - supervision callback.
   * @returns unsubscribe.
   */
  onEntryError(listener: (slot: string, entry: StoredSlotEntry, error: unknown, info: SlotEntryCrashInfo) => void): () => void
  /**
   * Project one slot subtree (or the whole map when root is omitted).
   * @param root - exact slot key; the projection roots there.
   */
  snapshot(root?: string): readonly LiveSlotNode[]
  /** Notify the supervision seam that one live entry crashed. */
  crash(slot: string, entry: StoredSlotEntry, error: unknown, info: SlotEntryCrashInfo): void
}

/** Real in-memory slot registry: declarations + entries + crash fan-out + tree projection. */
export class MemoryClientSlots implements ClientSlotsPort {
  private readonly decls = new Map<string, SlotDeclarationSpec>()
  private readonly byKey = new Map<string, StoredSlotEntry[]>()
  private readonly crashes = new Set<(slot: string, entry: StoredSlotEntry, error: unknown, info: SlotEntryCrashInfo) => void>()
  private nextId = 0

  declare(key: string, spec: SlotDeclarationSpec): void {
    this.decls.set(key, spec)
  }

  spec(key: string): SlotDeclarationSpec | undefined {
    return this.decls.get(key)
  }

  register(options: { name: string; [option: string]: unknown }, component: unknown): () => void {
    const key = options.name
    const entry: StoredSlotEntry = {
      key,
      options: { ...options },
      component,
      registrant: `entry-${this.nextId++}`,
    }
    const list = this.byKey.get(key) ?? []
    list.push(entry)
    this.byKey.set(key, list)
    return (): void => {
      const current = this.byKey.get(key)
      if (current === undefined) return
      const next = current.filter(candidate => candidate !== entry)
      if (next.length === 0) this.byKey.delete(key)
      else this.byKey.set(key, next)
    }
  }

  entries(key: string): readonly StoredSlotEntry[] {
    const list = this.byKey.get(key)
    return list === undefined ? [] : [...list]
  }

  onEntryError(listener: (slot: string, entry: StoredSlotEntry, error: unknown, info: SlotEntryCrashInfo) => void): () => void {
    this.crashes.add(listener)
    return (): void => { this.crashes.delete(listener) }
  }

  snapshot(root?: string): readonly LiveSlotNode[] {
    const node = (name: string, spec: SlotDeclarationSpec): LiveSlotNode => ({
      name,
      kind: spec.kind,
      scope: spec.scope,
      occupants: (this.byKey.get(name) ?? []).map(entry => ({ key: entry.options.key, component: entry.component })),
      children: [...this.decls.entries()]
        .filter(([, child]) => child.parent === name)
        .map(([childName, childSpec]) => node(childName, childSpec)),
    })
    if (root !== undefined) {
      const spec = this.decls.get(root)
      if (spec === undefined) return []
      return [node(root, spec)]
    }
    return [...this.decls.entries()]
      .filter(([, spec]) => spec.parent === undefined)
      .map(([name, spec]) => node(name, spec))
  }

  crash(slot: string, entry: StoredSlotEntry, error: unknown, info: SlotEntryCrashInfo): void {
    for (const listener of [...this.crashes]) listener(slot, entry, error, info)
  }
}

/** Convenience constructor. */
export function createMemoryClientSlots(): MemoryClientSlots {
  return new MemoryClientSlots()
}

export default MemoryClientSlots