import type { CloudInvokeRequest, CloudInvokeResponse, CloudSegment } from './cloud-bridge-types.ts'
import type { IConversationHostAdapter } from './conversation-host-adapter.ts'
import type { IReturnBinding } from './return-binding.ts'
import type { ICloudBridgeStore } from './store.ts'
import type { ICapabilityRegistry } from './capabilities.ts'
import { resolveRouting, type RoutingDecision } from './routing.ts'
import { deriveSummary } from './summary.ts'
import { CloudBridgeError } from './errors.ts'

export interface CloudInvokeBridgeDeps {
  capabilityRegistry: ICapabilityRegistry
  hostAdapter: IConversationHostAdapter
  returnBinding: IReturnBinding
  store: ICloudBridgeStore
  now?: () => number
}

export interface CloudInvokeBridgeResult {
  route: RoutingDecision['outcome']
  invocationId: string
  threadId: string
  status: CloudInvokeResponse['status']
  bound?: { appendedSegments: CloudSegment[]; summary?: string; committedAt: number }
}

/**
 * Cloud-invoke bridge orchestration:
 *   1. route the request (local vs cloud) based on advertised capabilities;
 *   2. if cloud, push context to the host, stream deltas, then bind the
 *      resulting output back onto the local thread via return-binding;
 *   3. record the round-trip in the bridge store.
 */
export async function invokeThroughCloudBridge(
  request: CloudInvokeRequest,
  deps: CloudInvokeBridgeDeps,
): Promise<CloudInvokeBridgeResult> {
  const routing = resolveRouting(request, deps.capabilityRegistry.list())

  if (routing.outcome === 'local') {
    return {
      route: 'local',
      invocationId: request.invocationId,
      threadId: request.threadId,
      status: 'completed',
    }
  }

  const now = deps.now?.() ?? Date.now()
  await deps.store.create({
    invocationId: request.invocationId,
    threadId: request.threadId,
    catId: request.catId,
    userId: request.userId,
    dispatchedAt: now,
  })

  try {
    await deps.hostAdapter.sendContext(request.threadId, request.contextMessages)
    const priorSnapshot = await deps.hostAdapter.getSnapshot(request.threadId)
    const previousSegments = await deps.returnBinding.getLocalBase(request.threadId)
    const response = await streamFullResponse(deps, request.threadId)

    const bound = await deps.returnBinding.bind({
      invocationId: request.invocationId,
      threadId: request.threadId,
      response,
      snapshot: priorSnapshot,
      previousSegments,
      committedAt: now,
    })

    await deps.store.markBound(request.invocationId, response.invocationId, bound.appendedSegments.length, now)

    return {
      route: 'cloud',
      invocationId: request.invocationId,
      threadId: request.threadId,
      status: response.status,
      bound: {
        appendedSegments: bound.appendedSegments,
        ...(bound.summary !== undefined ? { summary: bound.summary } : {}),
        committedAt: bound.committedAt,
      },
    }
  } catch (err) {
    await deps.store.markFailed(request.invocationId)
    if (err instanceof CloudBridgeError) throw err
    if (err instanceof Error) throw new CloudBridgeError('cloud_bridge_invoke_failed', 502, err.message)
    throw err
  }
}

async function streamFullResponse(deps: CloudInvokeBridgeDeps, threadId: string): Promise<CloudInvokeResponse> {
  const response = await deps.hostAdapter.streamDeltas(threadId, async () => undefined)
  if (response.status === 'failed') {
    throw new CloudBridgeError('cloud_dispatch_failed', 502, response.errorMessage ?? response.errorCode ?? 'cloud_dispatch_failed')
  }
  if (response.summary === undefined) {
    return { ...response, summary: deriveSummary(response.segments) }
  }
  return response
}