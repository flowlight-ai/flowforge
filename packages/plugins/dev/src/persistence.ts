/**
 * @flowforge/plugin-dev — instance persistence (EP0-3).
 *
 * The process state contract (33-stage §1): state lives in repo files under
 * `docs/process/instances/<name>.json`, so any AI tool — flowforge-hosted
 * (scenario 1) or external (scenario 2) — resumes from the same file after a
 * model/tool/session switch.
 *
 * @module @flowforge/plugin-dev/persistence
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ForgeProcessStateMachine, type ProcessSnapshot } from './state-machine.ts'
import { getWorkflowProfile, type WorkflowKind } from './workflows.ts'

/** On-disk shape of one process instance. */
export interface PersistedInstance {
  readonly schemaVersion: 1
  readonly name: string
  readonly workflow: WorkflowKind
  readonly snapshot: ProcessSnapshot
  readonly updatedAt: string
}

/** Error type for store operations (missing/invalid files). */
export class InstanceStoreError extends Error {
  constructor(
    message: string,
    readonly instanceName: string,
  ) {
    super(message)
    this.name = 'InstanceStoreError'
  }
}

/** Default instance directory inside a repo. */
export function instancesDir(repoRoot: string): string {
  return join(repoRoot, 'docs', 'process', 'instances')
}

/**
 * File-backed instance store. One JSON file per instance under
 * `docs/process/instances/`; committed with the repo (decision D3).
 */
export class InstanceStore {
  private readonly dir: string

  constructor(repoRoot: string) {
    this.dir = instancesDir(resolve(repoRoot))
  }

  /** Absolute path of an instance file. */
  pathOf(name: string): string {
    return join(this.dir, `${name}.json`)
  }

  /** Persist (create or overwrite) an instance; returns the file path. */
  save(instance: PersistedInstance): string {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    const path = this.pathOf(instance.name)
    writeFileSync(path, `${JSON.stringify(instance, null, 2)}\n`, 'utf8')
    return path
  }

  /** Persist a live machine under a workflow kind (convenience wrapper). */
  saveMachine(
    name: string,
    workflow: WorkflowKind,
    machine: ForgeProcessStateMachine,
    now: () => Date = () => new Date(),
  ): string {
    return this.save({
      schemaVersion: 1,
      name,
      workflow,
      snapshot: machine.snapshot(),
      updatedAt: now().toISOString(),
    })
  }

  /** Load one instance; `undefined` when the file does not exist. */
  load(name: string): PersistedInstance | undefined {
    const path = this.pathOf(name)
    if (!existsSync(path)) return undefined
    return this.parse(readFileSync(path, 'utf8'), name)
  }

  /** Load or throw (CLI paths want a hard error on missing instances). */
  loadOrThrow(name: string): PersistedInstance {
    const instance = this.load(name)
    if (instance === undefined) {
      throw new InstanceStoreError(
        `instance '${name}' not found under ${this.dir} (ff_dev init ${name} first)`,
        name,
      )
    }
    return instance
  }

  /** All persisted instances (sorted by file name; newest activity NOT guaranteed). */
  list(): PersistedInstance[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter(file => file.endsWith('.json'))
      .sort()
      .map(file => this.parse(readFileSync(join(this.dir, file), 'utf8'), file.replace(/\.json$/, '')))
  }

  /** Instances that have not reached the terminal phase yet. */
  active(): PersistedInstance[] {
    return this.list().filter(instance => instance.snapshot.phase !== 'finish')
  }

  /** Rebuild a live state machine from a persisted instance. */
  restoreMachine(instance: PersistedInstance): ForgeProcessStateMachine {
    return ForgeProcessStateMachine.restore(instance.snapshot)
  }

  private parse(raw: string, name: string): PersistedInstance {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new InstanceStoreError(
        `instance '${name}' is not valid JSON: ${(error as Error).message}`,
        name,
      )
    }
    const record = parsed as Partial<PersistedInstance>
    if (
      record.schemaVersion !== 1 ||
      typeof record.name !== 'string' ||
      typeof record.workflow !== 'string' ||
      record.snapshot === undefined ||
      typeof record.updatedAt !== 'string'
    ) {
      throw new InstanceStoreError(`instance '${name}' has an invalid schema`, name)
    }
    // Validate the workflow kind eagerly — a typo'd kind must fail at load, not later.
    getWorkflowProfile(record.workflow)
    return {
      schemaVersion: 1,
      name: record.name,
      workflow: record.workflow,
      snapshot: record.snapshot as ProcessSnapshot,
      updatedAt: record.updatedAt,
    }
  }
}
