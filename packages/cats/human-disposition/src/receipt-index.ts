/**
 * @flowforge/cats-human-disposition — F281 receipt 内存索引（replay/conflict 判定）。
 *
 * TS 移植自 clowder-ai `domains/human-disposition/InMemoryHumanDispositionReceiptIndex.ts`：
 * sourceRef-keyed canonical receipt 索引，append 返回 applied/replay/conflict。
 *
 * @module @flowforge/cats-human-disposition/receipt-index
 */

import { humanDispositionLedgerReceiptSchema } from './types.js';
import type { HumanDispositionLedgerReceipt } from './types.js';

export type InMemoryHumanDispositionReceiptAppendOutcome = 'applied' | 'replay' | 'conflict';

export class InMemoryHumanDispositionReceiptIndex {
  private readonly receipts = new Map<string, string>();

  append(
    ownerUserId: string,
    receiptInput: HumanDispositionLedgerReceipt,
  ): InMemoryHumanDispositionReceiptAppendOutcome {
    const receipt = humanDispositionLedgerReceiptSchema.parse(receiptInput);
    const key = this.key(ownerUserId, receipt.sourceRef);
    const canonical = JSON.stringify(receipt);
    const existing = this.receipts.get(key);
    if (existing !== undefined) return existing === canonical ? 'replay' : 'conflict';
    this.receipts.set(key, canonical);
    return 'applied';
  }

  get(ownerUserId: string, sourceRef: string): HumanDispositionLedgerReceipt | null {
    const raw = this.receipts.get(this.key(ownerUserId, sourceRef));
    return raw ? humanDispositionLedgerReceiptSchema.parse(JSON.parse(raw)) : null;
  }

  private key(ownerUserId: string, sourceRef: string): string {
    return `${ownerUserId}\u0000${sourceRef}`;
  }
}
