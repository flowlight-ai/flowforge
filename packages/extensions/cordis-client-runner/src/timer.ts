/**
 * Browser implementation of the Cordis timer Service (seam port of the dsh
 * `timer.ts`). The original extended the cordis `Service` base and mixed helpers
 * onto `Context` via `ctx.mixin`; here the cordis feathers are gone and the
 * service rides the package-local `ServiceHostPort` — `effect` becomes
 * `host.registerEffect` and `provide('timer', …)` publishes the service to the
 * guarded context.
 *
 * The browser Service preserves the vendored Host TimerService's erased callback
 * tuples and arbitrary async-iterator return and rejection values, so these
 * positions stay un-narrowed (exact Host TimerService API compatibility).
 *
 * @module @flowforge/cordis-client-runner/timer
 */

import type { ServiceHostPort } from './ports/service-host.ts'

type WithDispose<T> = T & { dispose: () => void }

/** Browser timer Service with the same public API as the Host Cordis TimerService. */
export class ClientTimerService {
  /** @param host - package-local service host (declares and provides `timer`). */
  constructor(private readonly host: ServiceHostPort) {}

  /**
   * Run a callback once through {@link timeout}.
   * @param callback - Work to run after the delay.
   * @param delay - Delay in milliseconds.
   * @returns Disposer that cancels the pending callback early.
   * @deprecated Use `ctx.timeout()` instead.
   */
  setTimeout(callback: () => void, delay: number): () => void {
    return this.timeout(callback, delay)
  }

  /**
   * Run a callback repeatedly through {@link interval}.
   * @param callback - Work to run on each tick.
   * @param delay - Interval in milliseconds.
   * @returns Disposer that stops the interval early.
   * @deprecated Use `ctx.interval()` instead.
   */
  setInterval(callback: () => void, delay: number): () => void {
    return this.interval(callback, delay)
  }

  /** Run a callback once after a delay; returns a disposer that cancels it. */
  timeout(callback: () => void, delay: number): () => void
  /** Wait for a delay; the returned promise resolves after the delay. */
  timeout(delay: number): Promise<void>
  timeout(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() as () => void : undefined
    const delay = args[0] as number
    if (callback !== undefined) {
      const dispose = this.host.registerEffect(() => {
        const timer = globalThis.setTimeout(() => {
          void dispose()
          callback()
        }, delay)
        return () => { globalThis.clearTimeout(timer) }
      }, 'ctx.timeout()')
      return dispose
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const dispose = this.host.registerEffect(() => {
      const timer = globalThis.setTimeout(resolve, delay)
      return () => {
        globalThis.clearTimeout(timer)
        reject(new Error('Context has been disposed'))
      }
    }, 'ctx.timeout()')
    return promise.finally(() => { void dispose() })
  }

  /** Run a callback repeatedly; returns a disposer that stops the interval. */
  interval(callback: () => void, delay: number): () => void
  /** Iterate over timer ticks (async iterator of ticks). */
  interval<R = any>(delay: number): AsyncIterableIterator<void, R, void>
  interval(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() as () => void : undefined
    const delay = args[0] as number
    if (callback !== undefined) {
      return this.host.registerEffect(() => {
        const timer = globalThis.setInterval(callback, delay)
        return () => { globalThis.clearInterval(timer) }
      }, 'ctx.interval()')
    }

    let done: { kind: 'return'; value: any } | { kind: 'throw'; reason: any } | undefined
    let nextTask: PromiseWithResolvers<IteratorResult<void>> | undefined
    const dispose = this.host.registerEffect(() => {
      const timer = globalThis.setInterval(() => {
        nextTask?.resolve({ done: false, value: undefined })
      }, delay)
      return () => {
        globalThis.clearInterval(timer)
        if (done !== undefined) return
        done = { kind: 'throw', reason: new Error('Context has been disposed') }
        nextTask?.reject(done.reason)
      }
    }, 'ctx.interval()')
    return {
      next: () => {
        if (done === undefined) return (nextTask = Promise.withResolvers()).promise
        if (done.kind === 'return') return Promise.resolve({ done: true, value: done.value })
        return Promise.reject(done.reason)
      },
      return: (value: any) => {
        if (done === undefined) done = { kind: 'return', value }
        nextTask?.resolve({ done: true, value })
        void dispose()
        return Promise.resolve({ done: true, value })
      },
      throw: (reason: any) => {
        if (done === undefined) done = { kind: 'throw', reason }
        nextTask?.reject(reason)
        void dispose()
        return Promise.resolve({ done: true, value: undefined })
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } satisfies AsyncIterableIterator<void>
  }

  /** Build a delayed wrapper whose pending callback belongs to the calling Fiber. */
  private schedule(label: string, trigger: (args: any[], disposed: boolean) => number | undefined, disposed = false): any {
    let timer: number | undefined
    const dispose = this.host.registerEffect(() => () => {
      disposed = true
      globalThis.clearTimeout(timer)
    }, label)
    const wrapper: any = (...args: any[]): void => {
      globalThis.clearTimeout(timer)
      timer = trigger(args, disposed)
    }
    wrapper.dispose = dispose
    return wrapper
  }

  /** Return a throttled function whose timer is disposed with the calling Fiber. */
  throttle<F extends (...args: any[]) => void>(callback: F, delay: number, noTrailing?: boolean): WithDispose<F> {
    let lastCall = -Infinity
    const execute = (...args: Parameters<F>): void => {
      lastCall = Date.now()
      callback(...args)
    }
    return this.schedule('ctx.throttle()', (args, disposed) => {
      const remaining = delay - Date.now() + lastCall
      if (remaining <= 0) {
        execute(...args as Parameters<F>)
      } else if (!disposed) {
        return globalThis.setTimeout(execute, remaining, ...args)
      }
    }, noTrailing)
  }

  /** Return a debounced function whose timer is disposed with the calling Fiber. */
  debounce<F extends (...args: any[]) => void>(callback: F, delay: number): WithDispose<F> {
    return this.schedule('ctx.debounce()', (args, disposed) => {
      if (disposed) return
      return globalThis.setTimeout(callback, delay, ...args) as unknown as number
    })
  }
}

/**
 * Install the browser timer Service on one Client composition.
 * @param host - package-local service host that owns the Service.
 * @returns the installed service.
 */
export function provideClientTimer(host: ServiceHostPort): ClientTimerService {
  const service = new ClientTimerService(host)
  host.provide('timer', service)
  return service
}