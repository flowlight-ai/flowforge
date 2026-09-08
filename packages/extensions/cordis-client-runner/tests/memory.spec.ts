import { describe, expect, it } from 'vitest'
import { createCordisClientRuntime, memoryCordisClientRuntime } from '../src/memory.ts'

describe('createCordisClientRuntime (memory assembly)', () => {
  it('assembles all ports and disposes fiber effects on disposeContext', () => {
    const runtime = createCordisClientRuntime({
      transport: {
        invoke: () => Promise.resolve(null),
        reportRenderFailure: () => {},
        reportGuardFailure: () => {},
      },
      installTimer: true,
      installInspect: true,
    })
    // every gate is a real in-memory implementation, present after assembly
    expect(runtime.slots).toBeDefined()
    expect(runtime.host).toBeDefined()
    expect(runtime.styleDocument).toBeDefined()
    expect(runtime.loader).toBeDefined()
    expect(runtime.runner).toBeDefined()
    expect(runtime.timer).toBeDefined()
    expect(runtime.inspect).toBeDefined()

    // host provides the slots seat so guarded dynamic packages can reach it
    expect(runtime.host.get('slots')).toBe(runtime.slots)

    let cleaned = 0
    runtime.host.registerEffect(() => { cleaned += 1 })
    runtime.disposeContext()
    expect(cleaned).toBe(1)
  })

  it('omits timer and inspect when requested', () => {
    const runtime = memoryCordisClientRuntime()
    expect(runtime.timer).toBeUndefined()
    expect(runtime.inspect).toBeUndefined()
  })
})