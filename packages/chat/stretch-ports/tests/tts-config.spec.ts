/**
 * S2 stretch：TTS 合成服务配置探测面（对齐 S1 feishu-config 先例）。
 *
 * 覆盖（docs/refactor/36-stage-stretch-remaining.md §4 决策）：
 * - resolveTtsConfig：env 探测 → serviceUrl/apiKey/voice 映射，缺省音色
 * - isTtsConfigured：端点（TTS_SERVICE_URL）有值才启用真实合成（显式地址门控）
 * - ttsConfigGap：缺端点诊断
 * @module @flowforge/chat-stretch/tests
 */

import { describe, expect, it } from 'vitest'
import {
  RSS_CONFIG_ENV_KEYS,
  resolveTtsConfig,
  isTtsConfigured,
  ttsConfigGap,
  TTS_CONFIG_ENV_KEYS,
  TTS_DEFAULT_VOICE,
} from '../src/index.ts'

describe('tts-config 配置探测', () => {
  it('权威环境键命名清单不含拼写漂移', () => {
    expect(TTS_CONFIG_ENV_KEYS).toEqual(['TTS_SERVICE_URL', 'TTS_API_KEY', 'TTS_VOICE'])
    expect(TTS_CONFIG_ENV_KEYS.includes('TTS_SERVICE_URL')).toBe(true)
    // RSS 键与该清单独立并列，互不混淆（跨清单比较统一放宽到 string，避免字面量并集不匹配）
    expect(RSS_CONFIG_ENV_KEYS.some((k: string) => TTS_CONFIG_ENV_KEYS.includes(k as typeof TTS_CONFIG_ENV_KEYS[number]))).toBe(false)
  })

  it('空环境 → 未配置（端点缺失），缺省音色', () => {
    const cfg = resolveTtsConfig({})
    expect(cfg.serviceUrl).toBeUndefined()
    expect(cfg.apiKey).toBeUndefined()
    expect(cfg.voice).toBe(TTS_DEFAULT_VOICE)
    expect(isTtsConfigured(cfg)).toBe(false)
    expect(ttsConfigGap(cfg)).toContain('TTS_SERVICE_URL')
  })

  it('端点与密钥齐备 → 已配置（显式地址门控启用）', () => {
    const cfg = resolveTtsConfig({ TTS_SERVICE_URL: 'https://tts.example/gate', TTS_API_KEY: 'k' })
    expect(cfg.serviceUrl).toBe('https://tts.example/gate')
    expect(cfg.apiKey).toBe('k')
    expect(isTtsConfigured(cfg)).toBe(true)
    expect(ttsConfigGap(cfg)).toBe('')
  })

  it('无密钥但端点到场 → 仍已配置（密钥可选，门控只看端点）', () => {
    const cfg = resolveTtsConfig({ TTS_SERVICE_URL: 'https://tts.example/gate' })
    expect(isTtsConfigured(cfg)).toBe(true)
    expect(cfg.apiKey).toBeUndefined()
  })

  it('显式音色覆盖缺省', () => {
    const cfg = resolveTtsConfig({ TTS_VOICE: 'neon' })
    expect(cfg.voice).toBe('neon')
  })
})