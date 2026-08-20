/**
 * 投影/门控纯函数验证（阶段5 批次1）：
 * - sanitizeThreadForResponse：internal.* 元数据剥离（防御性投影）
 * - projectThreadForListView：sidebar 视图剥离 metadata
 * - parseOptionalBoolean：宽松布尔查询解析
 * - gateForDurableSlot / isV2CursorActive：#1269 v2 游标门控
 *   （存量 v2 恒 v2 推进；开关 ON 发起 v2；开关 OFF 提取 raw id）
 *
 * @module @flowforge/chat-threads/tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredThread } from '@flowforge/cats-stores'
import {
  gateForDurableSlot,
  isV2CursorActive,
  parseOptionalBoolean,
  projectThreadForListView,
  sanitizeThreadForResponse,
} from '../src/index.ts'

function thread(metadata?: Record<string, unknown>): StoredThread {
  return {
    id: 'th_1',
    userId: 'alice',
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    ...(metadata !== undefined ? { metadata } : {}),
  } as StoredThread
}

describe('sanitizeThreadForResponse', () => {
  it('strips internal.* keys and keeps public ones', () => {
    const sanitized = sanitizeThreadForResponse(
      thread({ 'internal.custody': 'secret', pinned: true }),
    )
    expect(sanitized.metadata).toEqual({ pinned: true })
  })

  it('returns threads without internal keys unchanged (same reference)', () => {
    const clean = thread({ pinned: true })
    expect(sanitizeThreadForResponse(clean)).toBe(clean)
  })

  it('passes metadata-less threads through', () => {
    const bare = thread()
    expect(sanitizeThreadForResponse(bare)).toBe(bare)
  })
})

describe('projectThreadForListView', () => {
  it('drops the metadata blob in the sidebar view', () => {
    const projected = projectThreadForListView(thread({ pinned: true }), 'sidebar')
    expect('metadata' in projected).toBe(false)
  })

  it('keeps the full shape outside the sidebar view', () => {
    const full = thread({ pinned: true })
    expect(projectThreadForListView(full, undefined)).toBe(full)
  })
})

describe('parseOptionalBoolean', () => {
  it('accepts booleans and loose string forms', () => {
    expect(parseOptionalBoolean(true)).toBe(true)
    expect(parseOptionalBoolean('true')).toBe(true)
    expect(parseOptionalBoolean('1')).toBe(true)
    expect(parseOptionalBoolean(false)).toBe(false)
    expect(parseOptionalBoolean('false')).toBe(false)
    expect(parseOptionalBoolean('0')).toBe(false)
  })

  it('treats garbage and absence as undefined', () => {
    expect(parseOptionalBoolean('yes')).toBeUndefined()
    expect(parseOptionalBoolean(undefined)).toBeUndefined()
  })
})

describe('gateForDurableSlot (#1269)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps an existing v2 slot in v2 (rollback-safe)', () => {
    vi.stubEnv('VISIBILITY_CURSOR_V2', 'off')
    expect(gateForDurableSlot('v2:0000000000000015:msg_9', 'v2:0000000000000007:msg_3'))
      .toBe('v2:0000000000000015:msg_9')
  })

  it('initiates v2 when the gate is on', () => {
    vi.stubEnv('VISIBILITY_CURSOR_V2', 'on')
    expect(isV2CursorActive()).toBe(true)
    expect(gateForDurableSlot('v2:0000000000000015:msg_9', null))
      .toBe('v2:0000000000000015:msg_9')
    expect(gateForDurableSlot('v2:0000000000000015:msg_9', 'msg_3'))
      .toBe('v2:0000000000000015:msg_9')
  })

  it('extracts the raw id from a v2 canonical when the gate is off', () => {
    vi.stubEnv('VISIBILITY_CURSOR_V2', 'off')
    expect(isV2CursorActive()).toBe(false)
    expect(gateForDurableSlot('v2:0000000000000015:msg_9', null)).toBe('msg_9')
    expect(gateForDurableSlot('v2:0000000000000015:msg_9', 'msg_3')).toBe('msg_9')
  })

  it('passes v1 cursors through unchanged', () => {
    vi.stubEnv('VISIBILITY_CURSOR_V2', 'off')
    expect(gateForDurableSlot('msg_9', null)).toBe('msg_9')
    expect(gateForDurableSlot('msg_9', 'msg_3')).toBe('msg_9')
  })

  it('tolerates a malformed v2 token without a second colon', () => {
    vi.stubEnv('VISIBILITY_CURSOR_V2', 'off')
    expect(gateForDurableSlot('v2:onlyprefix', null)).toBe('v2:onlyprefix')
  })
})
