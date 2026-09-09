/** `contract/config.ts` 的 zod 配置校验契约测试。 */

import { describe, it, expect } from 'vitest'
import {
  SessionLogExportConfigSchema,
  parseSessionLogExportConfig,
  resolveCompression,
} from '../src/contract/config.ts'
import { DEFAULT_SESSION_LOG_COMPRESSION_LEVEL } from '../src/pure/zip.ts'

describe('SessionLogExportConfig z 校验', () => {
  it('缺省 compressionLevel 为 6（平衡缺省）', () => {
    expect(parseSessionLogExportConfig({}).compressionLevel).toBe(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL)
    expect(parseSessionLogExportConfig({}).compressionLevel).toBe(6)
  })

  it('接受 0 到 9 的整数', () => {
    expect(parseSessionLogExportConfig({ compressionLevel: 0 }).compressionLevel).toBe(0)
    expect(parseSessionLogExportConfig({ compressionLevel: 9 }).compressionLevel).toBe(9)
    expect(SessionLogExportConfigSchema.parse({ compressionLevel: 5 }).compressionLevel).toBe(5)
  })

  it('拒绝越界值 10', () => {
    expect(() => SessionLogExportConfigSchema.parse({ compressionLevel: 10 })).toThrow()
  })

  it('拒绝负数', () => {
    expect(() => SessionLogExportConfigSchema.parse({ compressionLevel: -1 })).toThrow()
  })

  it('拒绝非整数', () => {
    expect(() => SessionLogExportConfigSchema.parse({ compressionLevel: 2.5 })).toThrow()
  })

  it('拒绝非数值', () => {
    expect(() => SessionLogExportConfigSchema.parse({ compressionLevel: 'high' })).toThrow()
  })

  it('resolveCompression 收敛任意输入', () => {
    expect(resolveCompression({})).toBe(6)
    expect(resolveCompression({ compressionLevel: 3 })).toBe(3)
    expect(() => resolveCompression({ compressionLevel: 42 })).toThrow()
  })
})