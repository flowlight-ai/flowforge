import { CloudBridgeError } from './errors.ts'

/**
 * Registry of capabilities the local cat advertises. Used by routing to decide
 * whether a request can be served locally or must go to the cloud bridge.
 */
export interface ICapabilityRegistry {
  has(capability: string): boolean
  add(capability: string): void
  remove(capability: string): void
  list(): string[]
}

export class MemoryCapabilityRegistry implements ICapabilityRegistry {
  private capabilities = new Set<string>()

  constructor(initial: Iterable<string> = []) {
    for (const cap of initial) this.capabilities.add(cap)
  }

  has(capability: string): boolean {
    return this.capabilities.has(capability)
  }

  add(capability: string): void {
    if (!capability.trim()) throw new CloudBridgeError('empty_capability', 400)
    this.capabilities.add(capability)
  }

  remove(capability: string): void {
    this.capabilities.delete(capability)
  }

  list(): string[] {
    return Array.from(this.capabilities)
  }
}