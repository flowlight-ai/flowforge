/** `pure/zip.ts` 纯路径函数的契约测试。 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  fileZipEntryPath,
  mediaZipEntryPath,
  safeSessionIdSegment,
} from '../src/pure/zip.ts'

describe('mediaZipEntryPath', () => {
  it('按媒体类型映射扩展名', () => {
    expect(mediaZipEntryPath({ attachmentId: 'a', mediaType: 'image/png' })).toBe('media/a.png')
    expect(mediaZipEntryPath({ attachmentId: 'b', mediaType: 'image/jpeg' })).toBe('media/b.jpg')
    expect(mediaZipEntryPath({ attachmentId: 'c', mediaType: 'image/webp' })).toBe('media/c.webp')
    expect(mediaZipEntryPath({ attachmentId: 'd', mediaType: 'image/gif' })).toBe('media/d.gif')
  })

  it('附件 id 以字符串形式加入路径', () => {
    expect(mediaZipEntryPath({ attachmentId: 'img-9', mediaType: 'image/webp' })).toBe('media/img-9.webp')
  })
})

describe('fileZipEntryPath', () => {
  it('剥离 sha256 前缀并按摘要两级目录组织', () => {
    expect(fileZipEntryPath({ attachmentId: 'sha256:abcdef', name: 'a.txt' })).toBe('files/ab/abcdef/a.txt')
  })

  it('中和名字中的路径分隔与控制字符', () => {
    expect(fileZipEntryPath({ attachmentId: 'sha256:x', name: '../up.txt' })).toBe('files/x/x/_.._up.txt')
  })

  it('空名、点段与反斜杠名回退到 file', () => {
    expect(fileZipEntryPath({ attachmentId: 'sha256:x', name: '' })).toBe('files/x/x/file')
    expect(fileZipEntryPath({ attachmentId: 'sha256:x', name: '..' })).toBe('files/x/x/file')
    expect(fileZipEntryPath({ attachmentId: 'sha256:x', name: '.' })).toBe('files/x/x/file')
  })
})

describe('safeSessionIdSegment', () => {
  it('保留字母数字与下划线连字符', () => {
    expect(safeSessionIdSegment('abc-123_XY')).toBe('abc-123_XY')
  })

  it('中和路径分隔符与点段', () => {
    expect(safeSessionIdSegment('../evil')).toBe('__evil')
  })
})

describe('DEFAULT_SESSION_LOG_COMPRESSION_LEVEL', () => {
  it('平衡缺省为 6', () => {
    expect(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL).toBe(6)
  })
})