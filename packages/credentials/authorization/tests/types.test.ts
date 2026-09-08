/**
 * @flowforge/credentials-authorization 契约测试（B）— wire-safe 类型契型面。
 *
 * 覆盖无 Host 依赖的类型出口：CredentialKey 品牌、AuthorizationPrompt 三种 kind 的
 * 判别形态、AuthorisizationalSettlement 三值联合与 AuthorizationEntry 结构。
 */

import { describe, expect, it } from 'vitest'
import {
  credentialKey,
  createAuthorizationRuntime,
} from '../src/index.ts'
import type {
  AuthorizationEntry,
  AuthorizationOutcome,
  AuthorizationPrompt,
  AuthorizationSettlement,
  CredentialKey,
  AuthorizationStatus,
} from '../src/index.ts'
import { key } from './helpers.ts'

describe('Wire-safe 类型契型', () => {
  it('CredentialKey 是字符串品牌，可在运行期比较', () => {
    const a: CredentialKey = credentialKey('p', 'c')
    const b: CredentialKey = credentialKey('p', 'c')
    expect(a).toBe(b)
    expect(typeof a).toBe('string')
  })

  it('三种 prompt kind 携带各自承载字段', () => {
    const text: AuthorizationPrompt = { kind: 'text', message: 'm', placeholder: 'x' }
    const secret: AuthorizationPrompt = { kind: 'secret', message: 'm' }
    const select: AuthorizationPrompt = { kind: 'select', message: 'm', options: [{ id: 'a', label: 'A' }] }
    expect(text.kind).toBe('text')
    expect(secret.kind).toBe('secret')
    expect(select.kind).toBe('select')
    // 判别：非 select 的 prompt 不应携带 options（此处仅做结构断言）。
    if (select.kind === 'select') expect(select.options[0]?.id).toBe('a')
  })

  it('AuthorizationSettlement 是 authorized|cancelled|failed 的并集', () => {
    const all: AuthorizationSettlement[] = ['authorized', 'cancelled', 'failed']
    expect(all).toHaveLength(3)
    expect(all).toContain('failed') // failed 只存在于 settle 事件流，不出现在 outcome
  })

  it('AuthorizationStatus 只含 authorized|cancelled（outcome 的 status）', () => {
    const statuses: AuthorizationStatus[] = ['authorized', 'cancelled']
    expect(statuses).toHaveLength(2)
    const outcome: AuthorizationOutcome = { status: 'authorized' }
    expect(outcome.status).toBe('authorized')
  })

  it('AuthorizationEntry 反映注册 flow 的公开字段', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({ key: k, label: 'L', methods: [{ id: 'o', label: 'O' }], run: async () => { /* 无 */ } })
    const entry: AuthorizationEntry = rt.service.describe(k)!
    expect(entry).toMatchObject({ key: k, label: 'L', inFlight: false })
    expect(entry.methods[0]?.id).toBe('o')
  })
})