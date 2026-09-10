import { describe, expect, it } from 'vitest'
import {
  API_SERVICE_ENABLED_ENV_VARS,
  LEGACY_SERVICE_ENABLED_ENV_VARS,
  deriveLegacyServiceConfig,
  getServiceManifest,
  maskServiceEndpoint,
  parseServicePort,
  resolveEffectiveServiceConfig,
  resolveServiceEndpoint,
  resolveServiceEndpointMap,
  resolveServiceHealthUrl,
  resolveServiceState,
  resolveServiceStates,
  SERVICE_MANIFESTS,
  serviceHealthIdentityMatches,
  type FetchServiceHealth,
  type ServiceConfig,
  type ServiceManifest,
} from '../src/service-manifest.ts'

const whisper = getServiceManifest('whisper-stt') as ServiceManifest
const tts = getServiceManifest('mlx-tts') as ServiceManifest
const embedding = getServiceManifest('embedding-model') as ServiceManifest

describe('SERVICE_MANIFESTS / getServiceManifest', () => {
  it('registers the five scripted services', () => {
    expect(SERVICE_MANIFESTS.map((s) => s.id)).toEqual([
      'whisper-stt',
      'mlx-tts',
      'embedding-model',
      'llm-postprocess',
      'audio-capture',
    ])
  })

  it('returns null for unknown ids', () => {
    expect(getServiceManifest('nope')).toBeNull()
  })

  it('exposes env-var registries for every service', () => {
    expect(LEGACY_SERVICE_ENABLED_ENV_VARS['whisper-stt']).toBe('ASR_ENABLED')
    expect(API_SERVICE_ENABLED_ENV_VARS['audio-capture']).toBe('CAT_CAFE_SERVICE_AUDIO_ENABLED')
  })
})

describe('parseServicePort', () => {
  it('accepts valid in-range ports', () => {
    expect(parseServicePort('9876')).toBe(9876)
    expect(parseServicePort('1')).toBe(1)
    expect(parseServicePort('65535')).toBe(65535)
  })

  it('rejects out-of-range / malformed / empty values', () => {
    expect(parseServicePort('0')).toBeNull()
    expect(parseServicePort('65536')).toBeNull()
    expect(parseServicePort('abc')).toBeNull()
    expect(parseServicePort('12 34')).toBeNull()
    expect(parseServicePort('')).toBeNull()
    expect(parseServicePort(undefined)).toBeNull()
  })
})

describe('deriveLegacyServiceConfig', () => {
  it('returns undefined without any enabled flag', () => {
    expect(deriveLegacyServiceConfig(whisper, {})).toBeUndefined()
  })

  it('enables via legacy *_ENABLED flag with manifest default model', () => {
    const config = deriveLegacyServiceConfig(whisper, { ASR_ENABLED: 'true' })
    expect(config).toEqual({ installed: true, enabled: true, selectedModel: 'mlx-community/whisper-large-v3-turbo' })
  })

  it('honours an explicit model env var', () => {
    const config = deriveLegacyServiceConfig(whisper, {
      ASR_ENABLED: '1',
      WHISPER_MODEL: 'mlx-community/whisper-small-mlx',
    })
    expect(config?.selectedModel).toBe('mlx-community/whisper-small-mlx')
  })

  it('enables via API-scoped CAT_CAFE_SERVICE_* flag even under a profile', () => {
    const config = deriveLegacyServiceConfig(whisper, { CAT_CAFE_SERVICE_ASR_ENABLED: 'on', CAT_CAFE_PROFILE: 'x' })
    expect(config?.enabled).toBe(true)
  })

  it('ignores raw *_ENABLED legacy flags when a profile is active', () => {
    expect(deriveLegacyServiceConfig(whisper, { ASR_ENABLED: 'true', CAT_CAFE_PROFILE: 'default' })).toBeUndefined()
  })

  it('bridges merged-service fallback env (QWEN3_ASR_ENABLED → whisper-stt)', () => {
    const config = deriveLegacyServiceConfig(whisper, { QWEN3_ASR_ENABLED: 'true' })
    expect(config?.selectedModel).toBe('mlx-community/Qwen3-ASR-1.7B-8bit')
  })

  it('does not let a stale fallback override an explicit disable', () => {
    expect(deriveLegacyServiceConfig(whisper, { ASR_ENABLED: '0', QWEN3_ASR_ENABLED: 'true' })).toBeUndefined()
  })

  it('parses an explicit port env', () => {
    const config = deriveLegacyServiceConfig(whisper, { ASR_ENABLED: 'true', WHISPER_PORT: '9999' })
    expect(config?.port).toBe(9999)
  })

  it('picks per-service default model for other services', () => {
    expect(deriveLegacyServiceConfig(tts, { TTS_ENABLED: 'yes' })?.selectedModel).toBe(
      'mlx-community/Kokoro-82M-bf16',
    )
  })
})

describe('resolveEffectiveServiceConfig', () => {
  it('returns undefined when neither config nor legacy env exists', () => {
    expect(resolveEffectiveServiceConfig(whisper, undefined, {})).toBeUndefined()
  })

  it('projects the manifest default model into an unselected persisted config', () => {
    const effective = resolveEffectiveServiceConfig(whisper, { enabled: true }, {})
    expect(effective?.selectedModel).toBe('mlx-community/whisper-large-v3-turbo')
  })

  it('keeps an explicit selected model untouched', () => {
    const config: ServiceConfig = { enabled: true, selectedModel: 'mlx-community/whisper-large-v3-mlx' }
    expect(resolveEffectiveServiceConfig(whisper, config, {})?.selectedModel).toBe(
      'mlx-community/whisper-large-v3-mlx',
    )
  })

  it('lets an active Qwen3-ASR legacy contract win over stale persisted identity', () => {
    const config: ServiceConfig = { enabled: true, selectedModel: 'mlx-community/whisper-large-v3-mlx' }
    const effective = resolveEffectiveServiceConfig(whisper, config, { QWEN3_ASR_ENABLED: 'true' })
    expect(effective).toEqual({ enabled: true, selectedModel: 'mlx-community/Qwen3-ASR-1.7B-8bit' })
  })
})

describe('resolveServiceEndpoint', () => {
  it('uses the default endpoint when nothing is configured', () => {
    expect(resolveServiceEndpoint(whisper, {}, { enabled: true })).toBe('http://127.0.0.1:9876')
  })

  it('prefers an explicit endpoint env var (localhost normalized to 127.0.0.1)', () => {
    expect(resolveServiceEndpoint(whisper, { WHISPER_URL: 'http://localhost:9999' }, { enabled: true })).toBe(
      'http://127.0.0.1:9999',
    )
  })

  it('applies a persisted user-chosen port', () => {
    expect(resolveServiceEndpoint(whisper, {}, { enabled: true, port: 9800 })).toBe('http://127.0.0.1:9800')
  })

  it('uses portFallback host for embedding-model', () => {
    expect(resolveServiceEndpoint(embedding, {}, { enabled: true, port: 9100 })).toBe('http://127.0.0.1:9100')
    expect(resolveServiceEndpoint(embedding, { EMBED_PORT: '9000' }, { enabled: true })).toBe(
      'http://127.0.0.1:9000',
    )
  })

  it('prefers the persisted port over a static env port', () => {
    expect(resolveServiceEndpoint(embedding, { EMBED_PORT: '9000' }, { enabled: true, port: 9100 })).toBe(
      'http://127.0.0.1:9100',
    )
  })
})

describe('resolveServiceHealthUrl', () => {
  it('appends the manifest healthPath', () => {
    expect(resolveServiceHealthUrl(whisper, 'http://127.0.0.1:9876')).toBe('http://127.0.0.1:9876/health')
  })

  it('uses /status for audio-capture', () => {
    const audio = getServiceManifest('audio-capture') as ServiceManifest
    expect(resolveServiceHealthUrl(audio, 'http://127.0.0.1:9881')).toBe('http://127.0.0.1:9881/status')
  })

  it('does not duplicate an existing health path', () => {
    expect(resolveServiceHealthUrl(whisper, 'http://127.0.0.1:9876/health')).toBe('http://127.0.0.1:9876/health')
  })

  it('handles trailing-slash endpoints', () => {
    expect(resolveServiceHealthUrl(whisper, 'http://127.0.0.1:9876/')).toBe('http://127.0.0.1:9876/health')
  })
})

describe('serviceHealthIdentityMatches', () => {
  it('passes trivially for services without a health identity', () => {
    expect(serviceHealthIdentityMatches(embedding, undefined, { ok: true })).toEqual({ matches: true })
  })

  it('requires the tts-stream-route-v1 capability for mlx-tts', () => {
    expect(
      serviceHealthIdentityMatches(tts, undefined, { ok: true, details: { capabilities: ['speech-stream-route-v1'] } }),
    ).toEqual({ matches: true })
    const result = serviceHealthIdentityMatches(tts, undefined, { ok: true, details: { capabilities: [] } })
    expect(result.matches).toBe(false)
    expect(result.reason).toContain('speech-stream-route-v1')
  })

  it('checks model/backend identity for asr services', () => {
    const config: ServiceConfig = { enabled: true, selectedModel: 'mlx-community/Qwen3-ASR-1.7B-8bit' }
    expect(
      serviceHealthIdentityMatches(whisper, config, {
        ok: true,
        details: { model: 'mlx-community/Qwen3-ASR-1.7B-8bit', backend: 'mlx-audio' },
      }),
    ).toEqual({ matches: true })
    const mismatch = serviceHealthIdentityMatches(whisper, config, {
      ok: true,
      details: { model: 'mlx-community/Qwen3-ASR-1.7B-8bit', backend: 'faster-whisper' },
    })
    expect(mismatch.matches).toBe(false)
    expect(mismatch.reason).toContain('backend')
  })

  it('fails closed when the desired model is not configured', () => {
    const result = serviceHealthIdentityMatches(whisper, undefined, { ok: true })
    expect(result.matches).toBe(false)
    expect(result.reason).toContain('not configured')
  })
})

describe('resolveServiceState', () => {
  it('reports not_configured when not installed/enabled despite a reachable endpoint', async () => {
    const state = await resolveServiceState(whisper, { env: {} })
    expect(state.status).toBe('not_configured')
    expect(state.configured).toBe(true)
    expect(state.installed).toBe(false)
    expect(state.enabled).toBe(false)
    expect(state.endpoint).toBe('http://127.0.0.1:9876')
    expect(state.installable).toBe(true)
  })

  it('reports healthy when installed+enabled and the health probe passes', async () => {
    const urls: string[] = []
    const fetchHealth: FetchServiceHealth = async (url) => {
      urls.push(url)
      return { ok: true, status: 200 }
    }
    const state = await resolveServiceState(whisper, {
      env: {},
      config: { installed: true, enabled: true },
      fetchHealth,
    })
    expect(state.status).toBe('healthy')
    expect(state.httpStatus).toBe(200)
    expect(state.error).toBeNull()
    expect(state.selectedModel).toBeUndefined()
    expect(urls).toEqual(['http://127.0.0.1:9876/health'])
  })

  it('reports unhealthy with the probe error', async () => {
    const fetchHealth: FetchServiceHealth = async () => ({ ok: false, error: 'ECONNREFUSED' })
    const state = await resolveServiceState(whisper, {
      env: {},
      config: { installed: true, enabled: true },
      fetchHealth,
    })
    expect(state.status).toBe('unhealthy')
    expect(state.httpStatus).toBeNull()
    expect(state.error).toBe('ECONNREFUSED')
  })

  it('surfaces lifecycle actions without probing health', async () => {
    let probed = false
    const fetchHealth: FetchServiceHealth = async () => {
      probed = true
      return { ok: true, status: 200 }
    }
    const installing = await resolveServiceState(whisper, {
      env: {},
      fetchHealth,
      lifecycleAction: 'install',
    })
    expect(installing.status).toBe('installing')
    expect(installing.installed).toBe(false)
    const starting = await resolveServiceState(whisper, {
      env: {},
      config: { installed: true, enabled: true },
      fetchHealth,
      lifecycleAction: 'start',
    })
    expect(starting.status).toBe('starting')
    expect(starting.installed).toBe(true)
    expect(starting.enabled).toBe(true)
    expect(probed).toBe(false)
  })

  it('keeps the persisted port on the client state', async () => {
    const state = await resolveServiceState(whisper, {
      env: {},
      config: { enabled: true, port: 9800, selectedModel: 'mlx-community/whisper-small-mlx' },
    })
    expect(state.port).toBe(9800)
    expect(state.selectedModel).toBe('mlx-community/whisper-small-mlx')
  })

  it('resolves all states together', async () => {
    const states = await resolveServiceStates({
      env: {},
      fetchHealth: async () => ({ ok: true, status: 200 }),
      getConfig: () => ({ installed: true, enabled: true }),
      getLifecycleAction: () => null,
    })
    expect(states).toHaveLength(5)
    expect(states[0]?.id).toBe('whisper-stt')
    expect(states.every((s) => s.status === 'healthy')).toBe(true)
  })
})

describe('resolveServiceEndpointMap', () => {
  it('returns masked default endpoints by default', () => {
    const map = resolveServiceEndpointMap({}, () => undefined)
    expect(Object.keys(map)).toHaveLength(5)
    expect(map['whisper-stt']).toBe('http://127.0.0.1:9876')
  })

  it('masks URL credentials unless mask: false', () => {
    const env = { WHISPER_URL: 'http://user:pass@localhost:9876' }
    expect(resolveServiceEndpointMap(env, () => undefined)['whisper-stt']).toBe('http://***@127.0.0.1:9876')
    expect(resolveServiceEndpointMap(env, () => undefined, { mask: false })['whisper-stt']).toBe(
      'http://user:pass@127.0.0.1:9876',
    )
  })
})

describe('maskServiceEndpoint', () => {
  it('masks credentials and preserves host/port', () => {
    expect(maskServiceEndpoint('http://user:pass@host:1234/')).toBe('http://***@host:1234')
  })

  it('returns *** for invalid URLs and null for null', () => {
    expect(maskServiceEndpoint('not a url')).toBe('***')
    expect(maskServiceEndpoint(null)).toBeNull()
  })
})
