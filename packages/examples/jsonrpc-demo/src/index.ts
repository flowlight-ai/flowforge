/**
 * @flowforge/jsonrpc-demo — a minimal runnable JSON-RPC 2.0 example. It shows:
 *  1. the *types* of request/response/error messages,
 *  2. a *assembly* (a pure dispatcher with handler lookup),
 *  3. *usage* wiring a few methods and dispatching a request.
 *
 * Usage:
 * ```ts
 * import { buildHandler, dispatch, ok, err } from '@flowforge/jsonrpc-demo'
 *
 * const handler = buildHandler({
 *   add: (a: number, b: number) => a + b,
 * })
 * console.log(await handler({ jsonrpc: '2.0', id: 1, method: 'add', params: [1, 2] }))
 * // -> { jsonrpc: '2.0', id: 1, result: 3 }
 * ```
 * @module @flowforge/jsonrpc-demo
 */

import {
  JsonRpcErrorCode,
} from './types.ts'
import type {
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcSuccess,
} from './types.ts'

export {
  JsonRpcErrorCode,
} from './types.ts'
export type {
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcSuccess,
} from './types.ts'

/** A method implementation registered on a handler. */
export type JsonRpcMethod = (params: unknown) => unknown | Promise<unknown>

/** Compose a successful response for the matched request. */
export function ok(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

/** Compose an error response for the matched request. */
export function err(id: JsonRpcId, error: JsonRpcError): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error }
}

/** The dispatcher's verdict over one inbound request. */
export type JsonRpcDispatched = JsonRpcSuccess | JsonRpcErrorResponse

/** Validate and dispatch a JSON-RPC request against a method table. */
export function dispatch(request: JsonRpcRequest, methods: Readonly<Record<string, JsonRpcMethod>>): Promise<JsonRpcDispatched> {
  return (async () => {
    const method = methods[request.method]
    if (method === undefined) {
      return err(request.id, { code: JsonRpcErrorCode.MethodNotFound, message: `Method not found: ${request.method}` })
    }
    try {
      return ok(request.id, await method(request.params))
    } catch (cause) {
      return err(request.id, {
        code: JsonRpcErrorCode.InternalError,
        message: 'Internal error',
        data: cause instanceof Error ? cause.message : String(cause),
      })
    }
  })()
}

/**
 * Assemble a sendable request object from application inputs.
 * @param method - the method name.
 * @param params - positional or named parameters (optional).
 * @param id - request id; omit/null to build a notification.
 * @returns a well-formed JsonRpcRequest.
 */
export function buildRequest(method: string, params?: unknown, id: JsonRpcId = null): JsonRpcRequest {
  const request: JsonRpcRequest = { jsonrpc: '2.0', method, id }
  return params === undefined ? request : { ...request, params }
}

/**
 * Assemble a handler ready to serve requests: wraps {@link dispatch}.
 * @param methods - the method table to route to.
 * @returns an async request → response function.
 */
export function buildHandler(methods: Readonly<Record<string, JsonRpcMethod>>): (
  request: JsonRpcRequest,
) => Promise<JsonRpcDispatched> {
  return (request: JsonRpcRequest) => dispatch(request, methods)
}