/**
 * Assembly factory: compose the real in-memory ports, the runner, the timer
 * service and the inspect registry into a testable Client runtime base.
 *
 * Per the test iron rule (T9): every originally-cordis host service has a real
 * in-memory implementation here, so contract tests assemble it directly — no
 * `vi.mock`. `createCordisClientRuntime` wires `MemoryClientSlots`,
 * `MemoryServiceHost`, `MemoryLoaderModules`, `MemoryStyleDocument`,
 * `DynamicCordisPackageRunner` and (by default) publishes the `timer` service
 * and the Cordis inspect registry with the first-party providers.
 *
 * @module @flowforge/cordis-client-runner/memory
 */

import { MemoryClientSlots, createMemoryClientSlots } from './ports/slots.ts'
import { MemoryServiceHost, createMemoryServiceHost } from './ports/service-host.ts'
import { MemoryStyleDocument, createMemoryStyleDocument } from './ports/style.ts'
import { MemoryLoaderModules, createMemoryLoaderModules } from './ports/loader-modules.ts'
import { DynamicCordisPackageRunner } from './runtime.ts'
import type { CordisErrorDetails, DynamicCordisRenderFailure } from './runtime.ts'
import type {
  CordisDynamicPluginId, CordisDynamicPluginRunId, SessionId,
} from './types.ts'
import { ClientCordisInspectRegistry, provideClientCordisInspect } from './inspect-registry.ts'
import { clientInspectProviders } from './providers.ts'
import { provideClientTimer } from './timer.ts'
import type { ClientTimerService } from './timer.ts'

/** External transport verbs a page host must supply (host.call forwarding + attribution). */
export interface CordisClientRuntimeTransport {
  /** Route one `host.call` to the package's host half. */
  invoke(
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    method: string,
    args: unknown,
  ): Promise<unknown>
  /** Report a render-time crash back to the owning Agent. */
  reportRenderFailure(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): void
  /** Report a post-activation guard rejection to the owning Agent. */
  reportGuardFailure(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: CordisErrorDetails,
  ): void
}

/** Assembly options. */
export interface CordisClientRuntimeOptions {
  /** Transport verbs (host.call forwarding + crash/guard attribution). */
  transport: CordisClientRuntimeTransport
  /** Whether to publish the `timer` service and install it, default true. */
  installTimer?: boolean
  /** Whether to build the inspect registry with the first-party providers, default true. */
  installInspect?: boolean
}

/** Assembled Client runtime base handles. */
export interface CordisClientRuntime {
  readonly slots: MemoryClientSlots
  readonly host: MemoryServiceHost
  readonly styleDocument: MemoryStyleDocument
  readonly loader: MemoryLoaderModules
  readonly runner: DynamicCordisPackageRunner
  readonly timer?: ClientTimerService
  readonly inspect?: ClientCordisInspectRegistry
  /** Dispose every fiber effect registered on the host (context disposal). */
  readonly disposeContext: () => void
}

/** Assemble one in-memory Cordis Client runtime. */
export function createCordisClientRuntime(options: CordisClientRuntimeOptions): CordisClientRuntime {
  const slots = createMemoryClientSlots()
  const host = createMemoryServiceHost()
  const styleDocument = createMemoryStyleDocument()
  const loader = createMemoryLoaderModules()
  // The guard and the providers reach services through the host; the slot seat
  // is the page-local registry itself.
  host.provide('slots', slots)

  const runner = new DynamicCordisPackageRunner({
    host,
    slots,
    loader,
    styleDocument,
    invoke: options.transport.invoke,
    reportRenderFailure: options.transport.reportRenderFailure,
    reportGuardFailure: options.transport.reportGuardFailure,
  })

  let timer: ClientTimerService | undefined
  if (options.installTimer !== false) timer = provideClientTimer(host)

  let inspect: ClientCordisInspectRegistry | undefined
  if (options.installInspect !== false) {
    inspect = new ClientCordisInspectRegistry({ sync: async () => {}, resolve: async () => {} })
    provideClientCordisInspect(host, inspect)
    for (const registration of clientInspectProviders(host)) inspect.register(registration)
  }

  return {
    slots,
    host,
    styleDocument,
    loader,
    runner,
    ...timer === undefined ? {} : { timer },
    ...inspect === undefined ? {} : { inspect },
    disposeContext: () => host.disposeEffects(),
  }
}

/** Convenience single-test runtime with a no-op transport. */
export function memoryCordisClientRuntime(): CordisClientRuntime {
  return createCordisClientRuntime({
    transport: {
      invoke: () => Promise.resolve(null),
      reportRenderFailure: () => {},
      reportGuardFailure: () => {},
    },
    installTimer: false,
    installInspect: false,
  })
}

export default createCordisClientRuntime