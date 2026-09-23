/**
 * S5-4 宿主接线：身份 header 注入共享端口单测。
 *
 * 覆盖：
 * - readGameIdentity：x-cat-id + 用户身份齐备 / 缺 catId / 缺 userId / 数组值取首
 * - readUserId：仅按用户身份；x-cat-cafe-user 优先于 x-user-id
 * - injectGameIdentity：写回 x-cat-id/x-cat-cafe-user，不污染既有 header、不写缺失键
 * @module @flowforge/api-rest-controllers/tests
 */

import { describe, expect, it } from 'vitest'
import {
  GAME_IDENTITY_HEADERS,
  injectGameIdentity,
  readGameIdentity,
  readUserId,
} from '../src/index.ts'

describe('game-identity 身份 header 注入端口', () => {
  it('权威 header 键名清单', () => {
    expect(GAME_IDENTITY_HEADERS).toEqual(['x-cat-id', 'x-cat-cafe-user', 'x-user-id'])
  })

  it('readGameIdentity：catId + x-cat-cafe-user 齐备 → 解析成功', () => {
    const id = readGameIdentity({ 'x-cat-id': 'cat1', 'x-cat-cafe-user': 'user1' })
    expect(id).toEqual({ catId: 'cat1', userId: 'user1' })
  })

  it('readGameIdentity：catId + x-user-id 兜底 → 解析成功', () => {
    expect(readGameIdentity({ 'x-cat-id': 'cat1', 'x-user-id': 'user2' })).toEqual({
      catId: 'cat1',
      userId: 'user2',
    })
  })

  it('readGameIdentity：缺 catId → null（MCP 回调门控键）', () => {
    expect(readGameIdentity({ 'x-cat-cafe-user': 'user1' })).toBeNull()
  })

  it('readGameIdentity：缺用户 → null', () => {
    expect(readGameIdentity({ 'x-cat-id': 'cat1' })).toBeNull()
  })

  it('readUserId：x-cat-cafe-user 优先，兼容数组头取首值', () => {
    expect(readUserId({ 'x-cat-cafe-user': 'u', 'x-user-id': 'v' })).toBe('u')
    expect(readUserId({ 'x-cat-cafe-user': ['a', 'b'] })).toBe('a')
    expect(readUserId({ 'x-user-id': 'v' })).toBe('v')
    expect(readUserId({})).toBeUndefined()
  })

  it('injectGameIdentity：合并到既有 header，不污染传入对象', () => {
    const base = { authorization: 'Bearer t' }
    const out = injectGameIdentity(base, { catId: 'cat1', userId: 'user1' })
    expect(out).toEqual({ authorization: 'Bearer t', 'x-cat-id': 'cat1', 'x-cat-cafe-user': 'user1' })
    expect(base).toEqual({ authorization: 'Bearer t' })
  })

  it('injectGameIdentity：缺失的身份键不写入', () => {
    expect(injectGameIdentity({}, { catId: '', userId: 'user1' })).toEqual({
      'x-cat-cafe-user': 'user1',
    })
    expect(injectGameIdentity(undefined, { catId: 'cat1', userId: '' })).toEqual({ 'x-cat-id': 'cat1' })
  })
})