/**
 * S2 stretch：RSS 聚合服务配置探测面（对齐 S1 feishu-config 先例）。
 *
 * 覆盖（docs/refactor/36-stage-stretch-remaining.md §4 决策）：
 * - resolveRssConfig：env 探测 → serviceUrl/apiKey 映射
 * - isRssConfigured：端点（RSS_SERVICE_URL）有值才启用真实聚合（显式地址门控）
 * - rssConfigGap：缺端点诊断
 * @module @flowforge/chat-stretch/tests
 */

import { describe, expect, it } from 'vitest'
import { resolveRssConfig, isRssConfigured, rssConfigGap, RSS_CONFIG_ENV_KEYS } from '../src/index.ts'

describe('rss-config 配置探测', () => {
  it('权威环境键命名清单不含拼写漂移', () => {
    expect(RSS_CONFIG_ENV_KEYS).toEqual(['RSS_SERVICE_URL', 'RSS_API_KEY'])
  })

  it('空环境 → 未配置（端点缺失）', () => {
    const cfg = resolveRssConfig({})
    expect(cfg.serviceUrl).toBeUndefined()
    expect(cfg.apiKey).toBeUndefined()
    expect(isRssConfigured(cfg)).toBe(false)
    expect(rssConfigGap(cfg)).toContain('RSS_SERVICE_URL')
  })

  it('端点与密钥齐备 → 已配置（显式地址门控启用）', () => {
    const cfg = resolveRssConfig({ RSS_SERVICE_URL: 'https://rss.example/agg', RSS_API_KEY: 'k' })
    expect(cfg.serviceUrl).toBe('https://rss.example/agg')
    expect(cfg.apiKey).toBe('k')
    expect(isRssConfigured(cfg)).toBe(true)
    expect(rssConfigGap(cfg)).toBe('')
  })

  it('仅端点（无密钥）→ 已配置（密钥可选，门控只看端点）', () => {
    const cfg = resolveRssConfig({ RSS_SERVICE_URL: 'https://rss.example/agg' })
    expect(isRssConfigured(cfg)).toBe(true)
    expect(cfg.apiKey).toBeUndefined()
  })
})