/**
 * Cloud-bridge error taxonomy. Errors carry a stable `code` usable by callers
 * and by the runtime-diagnostics invariants layer.
 */

export class CloudBridgeError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message = code,
  ) {
    super(message)
    this.name = 'CloudBridgeError'
  }
}

export class CloudDispatchRejectedError extends CloudBridgeError {
  constructor(code: string, statusCode: number, message = code) {
    super(code, statusCode, message)
    this.name = 'CloudDispatchRejectedError'
  }
}

export class ReturnBindingConflictError extends CloudBridgeError {
  constructor(message = 'return_binding_conflict') {
    super('return_binding_conflict', 409, message)
    this.name = 'ReturnBindingConflictError'
  }
}