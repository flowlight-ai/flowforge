/**
 * Thread store port (self-contained).
 *
 * Bounded subset of clowder `stores/ports/ThreadStore.ts` that the
 * context-assembly domain consumes: `IThreadStore.get(threadId)` plus the
 * `Thread` shape fields used by access checks / carrier resolution. Satisfied in
 * tests by `MemoryThreadStore` and in EP2 by the cats-stores host implementation.
 */

export interface Thread {
  id: string;
  projectPath: string;
  title: string | null;
  createdBy: string;
  /** null/undefined = not deleted. */
  deletedAt?: number | null;
}

export interface IThreadStore {
  get(threadId: string): Thread | null | Promise<Thread | null>;
}

/**
 * In-memory contract implementation used by vitest (real store, no mocks).
 */
export class MemoryThreadStore implements IThreadStore {
  private threads = new Map<string, Thread>();

  constructor(seed: readonly Thread[] = []) {
    for (const t of seed) this.threads.set(t.id, t);
  }

  get(threadId: string): Thread | null {
    return this.threads.get(threadId) ?? null;
  }

  put(thread: Thread): void {
    this.threads.set(thread.id, thread);
  }

  clear(): void {
    this.threads.clear();
  }
}