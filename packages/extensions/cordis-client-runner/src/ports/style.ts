/**
 * Style-document seam + real in-memory implementation.
 *
 * The dsh evaluator's `DynamicCordisStyles` wrote `<style>` tags straight into
 * `document.head`. To keep `@flowforge/cordis-client-runner` framework- and
 * DOM-free, `DynamicCordisStyles` now writes through this package-local port;
 * the real in-memory implementation keeps plain style-tag records a test can
 * assert, and a browser host supplies a thin adapter to real DOM.
 *
 * @module @flowforge/cordis-client-runner/ports/style
 */

/** One inserted stylesheet as the seam records and removes it. */
export interface StyleNode {
  readonly datasetDyn: string
  textContent: string
  attached: boolean
}

/** The DOM surface `styles.insert` needs — a port + a memory implementation. */
export interface StyleDocumentPort {
  /** Create a fresh empty style node owned by a plugin id. */
  createStyleNode(pluginId: string): StyleNode
  /** Attach the node to the document head (or the materialized equivalent). */
  attach(node: StyleNode): void
  /** Detach the node from the head. */
  detach(node: StyleNode): void
}

/** Real in-memory style document: keeps every node in an inspected array. */
export class MemoryStyleDocument implements StyleDocumentPort {
  readonly attachedNodes: StyleNode[] = []
  private id = 0

  createStyleNode(pluginId: string): StyleNode {
    return { datasetDyn: pluginId, textContent: '', attached: false }
  }

  attach(node: StyleNode): void {
    if (node.attached) return
    node.attached = true
    this.attachedNodes.push(node)
  }

  detach(node: StyleNode): void {
    if (!node.attached) return
    node.attached = false
    const index = this.attachedNodes.indexOf(node)
    if (index !== -1) this.attachedNodes.splice(index, 1)
  }

  /** Throwaway discriminator for diagnostics. */
  stamp(): string {
    this.id += 1
    return `node-${this.id}`
  }
}

export function createMemoryStyleDocument(): MemoryStyleDocument {
  return new MemoryStyleDocument()
}

export default MemoryStyleDocument