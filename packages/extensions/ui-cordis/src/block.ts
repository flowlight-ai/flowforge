/**
 * Package-local Tool-call view model seam standing in for the dsh
 * `@deepseek-ai/dsh-client-ui-tool/client` `ToolCallViewProps['block']` that the
 * card models (`cordisDefineCard` / `cordisRunCard` / `cordisActionCard`) derive
 * from. Only the fields the models read are retained; everything else the paint
 * layer used is out of scope for this pure-logic port.
 *
 * @module @flowforge/ui-cordis/block
 */

/** One content item inside a settled tool-result body. */
export interface ToolCallContentItem {
  readonly type?: string
  readonly text?: string
}

/** A settled (non-`running`) block: a result, or an interrupted/error outcome. */
export interface ToolCallViewModelBlockSettled {
  /** Present on any settled block; missing on an in-flight block. */
  readonly kind: string
  /** Log sequence, present on a settled tool-result. */
  readonly seq?: number
  /** The call snapshot as frozen for display. */
  readonly call?: { readonly argsRaw?: string }
  /** Result body text items. */
  readonly content?: readonly ToolCallContentItem[]
  readonly error?: { readonly name: string; readonly code: string }
  readonly isError?: boolean
  readonly meta?: unknown
}

/** An in-flight (`running`) block: the raw args are still streaming. */
export interface ToolCallViewModelBlockRunning {
  readonly argsRaw?: string
}

/** The union the card models accept. */
export type ToolCallViewModelBlock = ToolCallViewModelBlockSettled | ToolCallViewModelBlockRunning

export default ToolCallViewModelBlock