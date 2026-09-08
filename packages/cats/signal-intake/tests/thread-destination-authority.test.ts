/**
 * 线程目标权威契约：私有线程句柄解析与授权。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemoryMeetingThreadStore, parsePrivateThreadHandle, ThreadDestinationAuthority } from '../src/ThreadDestinationAuthority.ts'

describe('parsePrivateThreadHandle', () => {
  it('parses a canonical private thread handle', () => {
    expect(parsePrivateThreadHandle('host:private-thread:thread-abc')).toBe('thread-abc')
  })

  it('rejects non-thread handles and out-of-pattern ids', () => {
    expect(parsePrivateThreadHandle('host:channel:foo')).toBeNull()
    expect(parsePrivateThreadHandle('host:private-thread:')).toBeNull()
    expect(parsePrivateThreadHandle('host:private-thread:bad id!')).toBeNull()
  })
})

describe('ThreadDestinationAuthority.resolve', () => {
  it('resolves an owned live thread', async () => {
    const threads = new MemoryMeetingThreadStore()
    threads.put({ id: 'thread-abc', createdBy: 'owner-1', preferredCats: ['cat-a'], participants: ['cat-a'] })
    const authority = new ThreadDestinationAuthority(threads)
    const record = await authority.resolve('host:private-thread:thread-abc', 'owner-1')
    expect(record?.kind).toBe('private-thread')
    expect(record?.targetId).toBe('thread-abc')
  })

  it('rejects a thread owned by someone else or deleted', async () => {
    const threads = new MemoryMeetingThreadStore()
    threads.put({ id: 'thread-abc', createdBy: 'owner-1', preferredCats: [], participants: [] })
    const authority = new ThreadDestinationAuthority(threads)
    expect(await authority.resolve('host:private-thread:thread-abc', 'owner-2')).toBeNull()
  })
})