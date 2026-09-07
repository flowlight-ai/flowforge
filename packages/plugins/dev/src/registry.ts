/**
 * @flowforge/plugin-dev — in-memory registry of delivery process
 * instances (EP0). One `ForgeProcessStateMachine` per instance name;
 * the registry is the single entry point used by the future CLI
 * (`forge dev ...`) and the seven-phase workflow skills.
 *
 * @module @flowforge/plugin-dev/registry
 */

import {
  ForgeProcessStateMachine,
  type ForgeProcessStateMachineOptions,
  type ProcessSnapshot,
} from './state-machine.ts'

/** Options of the registry itself. */
export interface ForgeProcessRegistryOptions {
  /** Injected clock handed to every created instance (deterministic tests). */
  readonly now?: () => Date
}

/** Error thrown on unknown or duplicate instance names. */
export class ProcessRegistryError extends Error {
  constructor(
    message: string,
    readonly instanceName: string,
  ) {
    super(message)
    this.name = 'ProcessRegistryError'
  }
}

/**
 * In-memory process instance table: create / get / list / remove,
 * plus whole-registry export/import for persistence boundaries.
 */
export class ForgeProcessRegistry {
  private readonly instances = new Map<string, ForgeProcessStateMachine>()
  private readonly now?: (() => Date) | undefined

  constructor(options: ForgeProcessRegistryOptions = {}) {
    this.now = options.now
  }

  /** Create a new process instance; rejects duplicate names. */
  create(name: string): ForgeProcessStateMachine {
    if (this.instances.has(name)) {
      throw new ProcessRegistryError(`process instance '${name}' already exists`, name)
    }
    const machine = new ForgeProcessStateMachine(this.machineOptions(name))
    this.instances.set(name, machine)
    return machine
  }

  /** Get an existing instance; throws on unknown names. */
  get(name: string): ForgeProcessStateMachine {
    const machine = this.instances.get(name)
    if (machine === undefined) {
      throw new ProcessRegistryError(`process instance '${name}' not found`, name)
    }
    return machine
  }

  /** Get an existing instance or `undefined` (lookup without throwing). */
  find(name: string): ForgeProcessStateMachine | undefined {
    return this.instances.get(name)
  }

  /** True when the instance name is registered. */
  has(name: string): boolean {
    return this.instances.has(name)
  }

  /** Remove an instance; throws on unknown names. */
  remove(name: string): void {
    if (!this.instances.delete(name)) {
      throw new ProcessRegistryError(`process instance '${name}' not found`, name)
    }
  }

  /** All registered instance names (insertion order). */
  list(): string[] {
    return [...this.instances.keys()]
  }

  /** Snapshots of all instances (insertion order). */
  snapshots(): ProcessSnapshot[] {
    return [...this.instances.values()].map(machine => machine.snapshot())
  }

  /** Import instances from snapshots (e.g. after CLI restart). */
  importSnapshots(snapshots: readonly ProcessSnapshot[]): void {
    for (const snapshot of snapshots) {
      if (this.instances.has(snapshot.name)) {
        throw new ProcessRegistryError(`process instance '${snapshot.name}' already exists`, snapshot.name)
      }
      const options: { now?: () => Date } = {}
      if (this.now !== undefined) options.now = this.now
      this.instances.set(snapshot.name, ForgeProcessStateMachine.restore(snapshot, options))
    }
  }

  private machineOptions(name: string): ForgeProcessStateMachineOptions {
    return this.now === undefined ? { name } : { name, now: this.now }
  }
}
