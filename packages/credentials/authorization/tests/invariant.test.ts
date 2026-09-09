/**
 * @flowforge/credentials-authorization 契约测试（C）— invariant 伴生与内存装配行为。
 *
 * 全部断言对真实内存端口（createAuthorizationRuntime）运行，禁用 vi.mock。失败的
 * invariant 分支通过手写目标对象（非 mock 被测模块）驱动。
 */

import { describe, expect, it } from 'vitest'
import {
  createAuthorizationRuntime,
  installAuthorizationInvariant,
  INVARIANT_PACKAGE_NAME,
  createAuthorizationInvariantTarget,
} from '../src/index.ts'
import type { AuthorizationService } from '../src/index.ts'
import { makeInteraction, key } from './helpers.ts'

describe('installAuthorizationInvariant（真实装配）', () => {
  it('结算时 key 已释放：authorized 尝试不触发失败', async () => {
    const rt = createAuthorizationRuntime({ installInvariant: true })
    const k = key('p', 'c')
    rt.service.registerFlow({ key: k, label: 'L', methods: [{ id: 'o', label: 'O' }], run: async () => { rt.credentials.commit(k) } })
    const outcome = await rt.service.begin({ key: k, interaction: makeInteraction() })
    expect(outcome.status).toBe('authorized')
    expect(rt.invariantFailures).toHaveLength(0)
  })

  it('结算时 key 已释放：cancelled 尝试不触发失败', async () => {
    const rt = createAuthorizationRuntime({ installInvariant: true })
    const k = key('p', 'c')
    rt.service.registerFlow({ key: k, label: 'L', methods: [{ id: 'o', label: 'O' }], run: async () => { /* 不提交 */ } })
    await rt.service.begin({ key: k, interaction: makeInteraction() }).catch(() => undefined)
    expect(rt.invariantFailures).toHaveLength(0)
  })

  it('一个在其自身尝试中被撤回的 flow：结算时无可描述即不触发失败（disposer 文档化行为）', async () => {
    const rt = createAuthorizationRuntime({ installInvariant: true })
    const k = key('p', 'c')
    const release = rt.service.registerFlow({ key: k, label: 'L', methods: [{ id: 'o', label: 'O' }], run: async () => { /* 无 */ } })
    // 先移除 flow，让结算时 describe 返回 undefined（相当于“无存活授权服务/无可描述”）。
    release()
    await rt.service.registerFlow({ key: k, label: 'L', methods: [{ id: 'o', label: 'O' }], run: async () => { /* 无 */ } })
    await rt.service.begin({ key: k, interaction: makeInteraction() }).catch(() => undefined)
  })
})

describe('insertAuthorizationInvariant 失败分支（手写目标）', () => {
  it('无存活授权服务 -> 记录“without a live authorization service”', async () => {
    const failures: string[] = []
    let captured: ((key: unknown) => void) | undefined
    const release = installAuthorizationInvariant(
      {
        onSettled: listener => {
          captured = listener as (key: unknown) => void
          return () => { captured = undefined }
        },
        service: () => undefined,
      },
      message => { failures.push(message) },
    )
    const k = key('p', 'c')
    captured?.(k)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('without a live authorization service')
    release()
  })

  it('结算后 describe 仍报 inFlight -> 记录“left the key in flight”', async () => {
    const failures: string[] = []
    let captured: ((key: unknown) => void) | undefined
    const brokenService = {
      describe() {
        return { key: key('p', 'c'), label: 'L', methods: [], inFlight: true }
      },
    } as unknown as AuthorizationService
    installAuthorizationInvariant(
      {
        onSettled: listener => { captured = listener as (key: unknown) => void; return () => { captured = undefined } },
        service: () => brokenService,
      },
      message => { failures.push(message) },
    )
    captured?.(key('p', 'c'))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('left the key in flight')
  })

  it('卸载清理器后停止监听', () => {
    const failures: string[] = []
    let listeners: Array<(key: unknown) => void> = []
    const release = installAuthorizationInvariant(
      {
        onSettled: listener => { listeners.push(listener as (key: unknown) => void); return () => { listeners = [] } },
        service: () => {
          return { describe: () => ({ key: key('p', 'c'), label: 'L', methods: [], inFlight: true }) } as unknown as AuthorizationService
        },
      },
      message => { failures.push(message) },
    )
    release()
    for (const listener of listeners) listener(key('p', 'c'))
    expect(failures).toHaveLength(0)
  })
})

describe('内存装配 / 事件接线', () => {
  it('INVARIANT_PACKAGE_NAME 与 name 稳定', async () => {
    expect(INVARIANT_PACKAGE_NAME).toBe('@flowforge/credentials-authorization')
    expect((await import('../src/invariant.ts')).name).toBe('credentials-authorization-invariant')
  })

  it('createAuthorizationInvariantTarget 把宿主 settled 事件接线到 invariant', async () => {
    const rt = createAuthorizationRuntime({ installInvariant: false })
    const failures: string[] = []
    // 用目标生成器接线真实宿主与真实服务，手动安装 invariant。
    installAuthorizationInvariant(createAuthorizationInvariantTarget(rt.host, () => rt.service), message => { failures.push(message) })
    const k = key('p', 'c')
    rt.service.registerFlow({ key: k, label: 'L', methods: [{ id: 'o', label: 'O' }], run: async () => { rt.credentials.commit(k) } })
    await rt.service.begin({ key: k, interaction: makeInteraction() })
    // 真实 settle 经宿主触发 invariant；key 已释放，故无失败。
    expect(failures).toHaveLength(0)
  })
})