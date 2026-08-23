/**
 * Contract suite: CheckpointConfig — unified checkpoint configuration with
 * ${config.xxx} path resolution and the five predefined templates.
 */

import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_TEMPLATE_NAMES,
  CheckpointConfig,
  checkpointConfigFromDict,
  getCheckpointConfig,
} from '../src/checkpoint-config.ts'

describe('CheckpointConfig defaults + validation', () => {
  it('applies Python defaults', () => {
    const config = new CheckpointConfig()
    expect(config.enabled).toBe(true)
    expect(config.backend).toBe('sqlite')
    expect(config.path).toBe('data/checkpoints.db')
    expect(config.everyNSteps).toBe(5)
    expect(config.keepLatest).toBe(10)
    expect(config.autoRestore).toBe(true)
    expect(config.compress).toBe(false)
  })

  it('validates bounds', () => {
    expect(() => new CheckpointConfig({ everyNSteps: 0 })).toThrow('every_n_steps must be >= 1')
    expect(() => new CheckpointConfig({ keepLatest: -1 })).toThrow('keep_latest must be >= 0')
  })
})

describe('resolvePath', () => {
  it('substitutes ${config.xxx} variables', () => {
    const config = getCheckpointConfig('production')
    expect(config.resolvePath({ data_dir: '/var/ff' })).toBe('/var/ff/checkpoints.db')
  })

  it('keeps unresolved variables verbatim', () => {
    const config = getCheckpointConfig('production')
    expect(config.resolvePath({})).toBe('${config.data_dir}/checkpoints.db')
    expect(config.resolvePath(null)).toBe('${config.data_dir}/checkpoints.db')
  })

  it('toManagerKwargs yields the resolved dbPath', () => {
    const config = new CheckpointConfig({ path: '${config.data_dir}/cp.db' })
    expect(config.toManagerKwargs({ data_dir: 'd:' })).toEqual({ dbPath: 'd:/cp.db' })
  })
})

describe('templates', () => {
  it('provides the five predefined templates', () => {
    expect(CHECKPOINT_TEMPLATE_NAMES).toEqual(['default', 'lightweight', 'durable', 'development', 'production'])
    expect(getCheckpointConfig('lightweight').backend).toBe('memory')
    expect(getCheckpointConfig('lightweight').everyNSteps).toBe(10)
    expect(getCheckpointConfig('durable').everyNSteps).toBe(3)
    expect(getCheckpointConfig('durable').keepLatest).toBe(20)
    expect(getCheckpointConfig('development').path).toBe('data/dev_checkpoints.db')
    expect(getCheckpointConfig('production').path).toBe('${config.data_dir}/checkpoints.db')
  })

  it('unknown template names fall back to default', () => {
    const config = getCheckpointConfig('nope')
    expect(config.backend).toBe('sqlite')
    expect(config.everyNSteps).toBe(5)
  })

  it('returns fresh copies (template mutation isolation)', () => {
    const a = getCheckpointConfig('durable')
    a.everyNSteps = 99
    expect(getCheckpointConfig('durable').everyNSteps).toBe(3)
  })
})

describe('checkpointConfigFromDict', () => {
  it('selects a template then applies snake_case overrides', () => {
    const config = checkpointConfigFromDict({ template: 'durable', every_n_steps: 7 })
    expect(config.backend).toBe('sqlite')
    expect(config.keepLatest).toBe(20)
    expect(config.everyNSteps).toBe(7)
  })

  it('ignores null/undefined values and tolerates extra keys', () => {
    const config = checkpointConfigFromDict({ every_n_steps: null, unknown_field: 42 })
    expect(config.everyNSteps).toBe(5)
  })

  it('missing template key uses default', () => {
    const config = checkpointConfigFromDict({ keep_latest: 3 })
    expect(config.backend).toBe('sqlite')
    expect(config.keepLatest).toBe(3)
  })
})
