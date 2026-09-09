/**
 * Package-local observable seam standing in for the dsh `@deepseek-ai/dsh-client-ui-slots`
 * `HostObservable` that the inventory source, the run-card index and the panel
 * faces consumed. A minimal `getSnapshot()` / `subscribe()` contract the real
 * in-memory sources in this package implement directly — no external dependency,
 * no mocks.
 *
 * @module @flowforge/ui-cordis/observable
 */

/** A render-stable observable cursor (the `useSyncExternalStore` source shape). */
export interface HostObservable<T> {
  /** Current value; the reference is stable between mutations. */
  getSnapshot(): T
  /** Observe mutations; returns unsubscribe. */
  subscribe(fn: () => void): () => void
}

export default HostObservable