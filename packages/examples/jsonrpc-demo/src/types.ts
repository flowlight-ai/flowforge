/**
 * Type model for a JSON-RPC 2.0 message. This example keeps the wire shapes so
 * any transport can carry them; only two special ids are reserved per spec.
 * @module @flowforge/jsonrpc-demo/types
 */

/** A JSON-RPC request id: a number or string, or `null` for notifications. */
export type JsonRpcId = number | string | null

/** A JSON-RPC request (or notification when `id` is null). */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

/** A successful JSON-RPC response. */
export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0'
  readonly id: JsonRpcId
  readonly result: unknown
}

/** A JSON-RPC error object. */
export interface JsonRpcError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

/** A failed JSON-RPC response. */
export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0'
  readonly id: JsonRpcId
  readonly error: JsonRpcError
}

/** The by-the-spec standard error codes. */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const