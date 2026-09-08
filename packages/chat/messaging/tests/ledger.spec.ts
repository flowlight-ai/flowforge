/**
 * Idempotent settlement ledger — contract tests (T-D1, AC-5 / §4a).
 */
import { describe, expect, it } from 'vitest'
import type { SendReceipt } from '@flowforge/plugin-contract'
import { MessagingLedger } from '../src/ledger.js'
import { MemoryLedgerStore } from '../src/stores/memory.js'

const receipt: SendReceipt = { messageId: 'm1', threadId: 't1', revision: 1 }

describe('MessagingLedger.send', () => {
  it('claims → settles → subsequent claim returns the settled receipt', async () => {
    const ledger = new MessagingLedger(new MemoryLedgerStore())

    const first = await ledger.claimSend('inst-1', 'k1')
    expect(first.status).toBe('new')
    if (first.status !== 'new') return

    const settled = await ledger.settleSend('inst-1', 'k1', first.claimToken, receipt)
    expect(settled.status).toBe('freshly_settled')

    const repeated = await ledger.claimSend('inst-1', 'k1')
    expect(repeated.status).toBe('settled')
    if (repeated.status === 'settled') {
      expect(repeated.receipt).toEqual(receipt)
    }
  })

  it('rejects a settle with a stale claim token', async () => {
    const ledger = new MessagingLedger(new MemoryLedgerStore())
    await ledger.claimSend('inst-1', 'k2')
    const result = await ledger.settleSend('inst-1', 'k2', 'wrong-token', receipt)
    expect(result.status).toBe('rejected')
  })

  it('release frees an inflight claim so it can be claimed again', async () => {
    const ledger = new MessagingLedger(new MemoryLedgerStore())
    const claim = await ledger.claimSend('inst-1', 'k3')
    expect(claim.status).toBe('new')
    if (claim.status !== 'new') return
    await ledger.releaseSend('inst-1', 'k3', claim.claimToken)
    const again = await ledger.claimSend('inst-1', 'k3')
    expect(again.status).toBe('new')
  })
})

describe('MessagingLedger.append', () => {
  it('uses a key space distinct from send (URI-encoded)', async () => {
    const store = new MemoryLedgerStore()
    const ledger = new MessagingLedger(store)
    const claim = await ledger.claimAppend('inst-1', 'm1', 'op-1')
    expect(claim.status).toBe('new')
    if (claim.status !== 'new') return
    // A send with the same ids must not collide.
    const sendClaim = await ledger.claimSend('inst-1', 'm1')
    expect(sendClaim.status).toBe('new')
  })
})