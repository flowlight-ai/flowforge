/**
 * CheckpointConfig — unified cross-project checkpoint configuration.
 *
 * Faithful map of flowforge Python legacy core/checkpoint_config.py (F23):
 * backend enum, `${config.xxx}` path variable resolution and the five
 * predefined templates (default / lightweight / durable / development /
 * production). Storage stays host-owned: toManagerKwargs() yields the
 * resolved dbPath for whatever CheckpointStore the host binds.
 */

export type CheckpointBackend = 'sqlite' | 'memory' | 'file'

export interface CheckpointConfigInit {
  enabled?: boolean | undefined
  backend?: CheckpointBackend | undefined
  /** Storage path; supports `${config.xxx}` variable references. */
  path?: string | undefined
  /** Auto-save every N steps (>= 1). */
  everyNSteps?: number | undefined
  /** Keep the newest N versions; 0 keeps everything (>= 0). */
  keepLatest?: number | undefined
  autoRestore?: boolean | undefined
  /** Compress storage (file backend only). */
  compress?: boolean | undefined
}

export class CheckpointConfig {
  enabled: boolean
  backend: CheckpointBackend
  path: string
  everyNSteps: number
  keepLatest: number
  autoRestore: boolean
  compress: boolean

  constructor(init: CheckpointConfigInit = {}) {
    this.enabled = init.enabled ?? true
    this.backend = init.backend ?? 'sqlite'
    this.path = init.path ?? 'data/checkpoints.db'
    this.everyNSteps = init.everyNSteps ?? 5
    this.keepLatest = init.keepLatest ?? 10
    this.autoRestore = init.autoRestore ?? true
    this.compress = init.compress ?? false
    if (this.everyNSteps < 1) throw new Error('every_n_steps must be >= 1')
    if (this.keepLatest < 0) throw new Error('keep_latest must be >= 0')
  }

  copy(update: CheckpointConfigInit = {}): CheckpointConfig {
    return new CheckpointConfig({
      enabled: this.enabled,
      backend: this.backend,
      path: this.path,
      everyNSteps: this.everyNSteps,
      keepLatest: this.keepLatest,
      autoRestore: this.autoRestore,
      compress: this.compress,
      ...stripUndefined(update),
    })
  }

  /** Resolve `${config.xxx}` references against a system config dict. */
  resolvePath(config: Record<string, unknown> | null = null): string {
    let resolved = this.path
    if (config && resolved.includes('${config.')) {
      resolved = resolved.replace(/\$\{config\.(\w+)\}/g, (match, key: string) => {
        const value = config[key]
        return value === undefined ? match : String(value)
      })
    }
    return resolved
  }

  /** Constructor kwargs for a host-built CheckpointManager. */
  toManagerKwargs(config: Record<string, unknown> | null = null): { dbPath: string } {
    return { dbPath: this.resolvePath(config) }
  }
}

function stripUndefined(init: CheckpointConfigInit): CheckpointConfigInit {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(init)) {
    if (value !== undefined && value !== null) out[key] = value
  }
  return out as CheckpointConfigInit
}

// ---------------------------------------------------------------------------
// Predefined templates
// ---------------------------------------------------------------------------

export const CHECKPOINT_TEMPLATE_NAMES: readonly string[] = [
  'default',
  'lightweight',
  'durable',
  'development',
  'production',
]

function buildTemplate(name: string): CheckpointConfig {
  switch (name) {
    case 'lightweight':
      return new CheckpointConfig({ backend: 'memory', everyNSteps: 10, keepLatest: 5 })
    case 'durable':
      return new CheckpointConfig({ backend: 'sqlite', everyNSteps: 3, keepLatest: 20, autoRestore: true })
    case 'development':
      return new CheckpointConfig({
        path: 'data/dev_checkpoints.db',
        everyNSteps: 1,
        keepLatest: 50,
        autoRestore: true,
      })
    case 'production':
      return new CheckpointConfig({
        path: '${config.data_dir}/checkpoints.db',
        everyNSteps: 5,
        keepLatest: 10,
        autoRestore: true,
      })
    default:
      return new CheckpointConfig()
  }
}

/** Get a predefined template copy; unknown names fall back to 'default'. */
export function getCheckpointConfig(name = 'default'): CheckpointConfig {
  if (!CHECKPOINT_TEMPLATE_NAMES.includes(name)) return buildTemplate('default')
  return buildTemplate(name)
}

/**
 * Build a config from a dict; `template` selects the base template and the
 * remaining snake_case keys override its fields.
 */
export function checkpointConfigFromDict(config: Record<string, unknown>): CheckpointConfig {
  const { template, ...rest } = config
  const base = getCheckpointConfig(typeof template === 'string' ? template : 'default')
  const init: CheckpointConfigInit = {}
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue
    switch (key) {
      case 'enabled':
        init.enabled = Boolean(value)
        break
      case 'backend':
        init.backend = value as CheckpointBackend
        break
      case 'path':
        init.path = String(value)
        break
      case 'every_n_steps':
        init.everyNSteps = Number(value)
        break
      case 'keep_latest':
        init.keepLatest = Number(value)
        break
      case 'auto_restore':
        init.autoRestore = Boolean(value)
        break
      case 'compress':
        init.compress = Boolean(value)
        break
      default:
        break // extra keys tolerated (Python model extra='allow')
    }
  }
  return base.copy(init)
}
