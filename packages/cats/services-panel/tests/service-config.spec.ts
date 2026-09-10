import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getServiceConfig, setServiceConfig } from '../src/service-config.ts'

let savedEnv: string | undefined
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CAT_CAFE_SERVICES_CONFIG
  else process.env.CAT_CAFE_SERVICES_CONFIG = savedEnv
})

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'services-panel-config-'))
  const path = join(dir, 'services.json')
  process.env.CAT_CAFE_SERVICES_CONFIG = path
  savedEnv = path
  return path
}

describe('service-config', () => {
  it('returns undefined when no config file exists', () => {
    tempConfigPath()
    expect(getServiceConfig('whisper-stt')).toBeUndefined()
  })

  it('writes a persisted config and reads it back', () => {
    const path = tempConfigPath()
    const updated = setServiceConfig('whisper-stt', { enabled: true, selectedModel: 'mlx-community/whisper-small-mlx' })
    expect(updated.enabled).toBe(true)
    expect(getServiceConfig('whisper-stt')).toEqual({
      enabled: true,
      selectedModel: 'mlx-community/whisper-small-mlx',
    })
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toContain('"whisper-stt"')
  })

  it('merges patches over an existing config', () => {
    tempConfigPath()
    setServiceConfig('mlx-tts', { enabled: true })
    setServiceConfig('mlx-tts', { port: 9797 })
    expect(getServiceConfig('mlx-tts')).toEqual({ enabled: true, port: 9797 })
  })

  it('migrates legacy qwen3-asr config to whisper-stt with forced reinstall', () => {
    const path = tempConfigPath()
    writeFileSync(path, JSON.stringify({ 'qwen3-asr': { enabled: true } }))
    const migrated = getServiceConfig('whisper-stt')
    expect(migrated).toEqual({
      enabled: true,
      installed: false,
      selectedModel: 'mlx-community/Qwen3-ASR-1.7B-8bit',
    })
    expect(getServiceConfig('qwen3-asr')).toBeUndefined()
    // Migration is persisted back to disk.
    expect(readFileSync(path, 'utf-8')).toContain('"whisper-stt"')
  })

  it('preserves an explicit model during legacy migration', () => {
    const path = tempConfigPath()
    writeFileSync(path, JSON.stringify({ 'qwen3-asr': { enabled: true, selectedModel: 'custom/model' } }))
    expect(getServiceConfig('whisper-stt')?.selectedModel).toBe('custom/model')
  })

  it('leaves an existing new-id config untouched during migration', () => {
    const path = tempConfigPath()
    writeFileSync(
      path,
      JSON.stringify({ 'qwen3-asr': { enabled: true }, 'whisper-stt': { enabled: true, selectedModel: 'mine' } }),
    )
    expect(getServiceConfig('whisper-stt')).toEqual({ enabled: true, selectedModel: 'mine' })
    expect(getServiceConfig('qwen3-asr')).toBeUndefined()
  })

  it('recovers from a corrupt config file', () => {
    const path = tempConfigPath()
    writeFileSync(path, '{ not json')
    expect(getServiceConfig('whisper-stt')).toBeUndefined()
  })
})
