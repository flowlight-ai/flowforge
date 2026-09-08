/**
 * 飞书妙记/云文档引用提取契约（本地自包含实现）。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { isValidFeishuArtifactId, isValidFeishuRevision, parseFeishuMinutesReference } from '../src/extract/minutes-reference.ts'

describe('parseFeishuMinutesReference — tokens', () => {
  it('parses bare minute and note tokens', () => {
    expect(parseFeishuMinutesReference('obcn1234567890')).toEqual({ kind: 'minute', artifactId: 'obcn1234567890' })
    expect(parseFeishuMinutesReference('doxcn1234567890')).toEqual({ kind: 'note', artifactId: 'doxcn1234567890' })
  })

  it('rejects garbage tokens and unsafe characters', () => {
    expect(() => parseFeishuMinutesReference('not a token!!')).toThrow(TypeError)
  })
})

describe('parseFeishuMinutesReference — URLs', () => {
  it('parses a Feishu minutes URL to a minute locator', () => {
    const parsed = parseFeishuMinutesReference('https://example.feishu.cn/minutes/obcn1234567890')
    expect(parsed.kind).toBe('minute')
    expect(parsed.artifactId).toBe('obcn1234567890')
  })

  it('parses a docs URL with an explicit revision', () => {
    const parsed = parseFeishuMinutesReference('https://example.feishu.cn/docx/doxcn1234567890?revision=v2')
    expect(parsed).toEqual({ kind: 'note', artifactId: 'doxcn1234567890', revision: 'v2' })
  })
})

describe('isValidFeishuArtifactId / isValidFeishuRevision', () => {
  it('bounds identifier length and character set', () => {
    expect(isValidFeishuArtifactId('obcn1234567890')).toBe(true)
    expect(isValidFeishuArtifactId('a b')).toBe(false)
    expect(isValidFeishuArtifactId('x'.repeat(129))).toBe(false)
    expect(isValidFeishuRevision('v2')).toBe(true)
    expect(isValidFeishuRevision('x'.repeat(65))).toBe(false)
  })
})