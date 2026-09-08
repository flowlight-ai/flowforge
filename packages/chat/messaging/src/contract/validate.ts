/**
 * Plugin Messaging input admission.
 *
 * Public row structure, Unicode-scalar admission, numeric bounds, and payload
 * budgets come from the published contract validator. This Host adapter keeps
 * only the two semantics that depend on Host authority or persisted-message
 * ordering and therefore cannot live in the transport schema:
 * - draft cannot self-declare host provenance nor system audience (D-4 / INV-2);
 * - derivedFromElementId must reference an earlier element in the same draft.
 *
 * Ported from clowder-ai `domains/messaging/contract/validate.ts`.
 */

import type { AppendElementsRequest, MessageDraft, MessagingRowValidationError } from '@flowforge/plugin-contract'
import { validateMessagingRowInput } from '@flowforge/plugin-contract'
import { MessagingError } from './host-types.js'

function fail(message: string): never {
  throw new MessagingError('VALIDATION', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeContractErrors(errors: ReadonlyArray<MessagingRowValidationError>): string {
  return errors
    .map((error) => {
      const path = error.instancePath || 'input'
      if (error.keyword === 'additionalProperties') return `${path} contains unknown properties`
      if (error.keyword === 'uniqueItems') return `${path} contains duplicate values`
      return `${path} ${error.message ?? 'is invalid'}`
    })
    .join('; ')
}

function rejectHostAuthorityInDraft(input: unknown): void {
  if (!isRecord(input)) return
  if (isRecord(input.draftAudience) && input.draftAudience.kind === 'host') {
    fail('draftAudience kind "system" is host-only (INV-2)')
  }
  const payload = input.payload
  if (!isRecord(payload) || !isRecord(payload.provenance)) return
  if (isRecord(payload.provenance.origin) && payload.provenance.origin.kind === 'host') {
    fail('provenance.origin kind "host" cannot be declared by a draft (D-4)')
  }
}

function rejectDuplicateElementIds(elements: ReadonlyArray<{ readonly elementId: string }>): void {
  const seen = new Set<string>()
  for (const element of elements) {
    if (seen.has(element.elementId)) fail(`duplicate elementId "${element.elementId}"`)
    seen.add(element.elementId)
  }
}

/** Validate an untrusted draft against the contract plus Host-only semantics. */
export function validateDraft(input: unknown): MessageDraft {
  rejectHostAuthorityInDraft(input)
  const result = validateMessagingRowInput('messaging.send', input)
  if (!result.valid) fail(`messaging.send input failed contract validation: ${describeContractErrors(result.errors ?? [])}`)

  const draft = result.value as MessageDraft
  rejectDuplicateElementIds(draft.payload.elements)
  const persistedElementIds = new Set<string>()
  for (const element of draft.payload.elements) {
    if (element.derivedFromElementId !== undefined && !persistedElementIds.has(element.derivedFromElementId)) {
      fail(`derivedFromElementId "${element.derivedFromElementId}" must reference an earlier element in the draft`)
    }
    persistedElementIds.add(element.elementId)
  }
  return draft
}

/** Validate an untrusted appendElements input against the published contract. */
export function validateAppendInput(input: unknown): AppendElementsRequest {
  const result = validateMessagingRowInput('messaging.appendElements', input)
  if (!result.valid) {
    fail(`messaging.appendElements input failed contract validation: ${describeContractErrors(result.errors ?? [])}`)
  }
  const append = result.value as AppendElementsRequest
  rejectDuplicateElementIds(append.elements)
  return append
}