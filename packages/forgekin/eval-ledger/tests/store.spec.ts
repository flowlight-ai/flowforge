/**
 * store — EvalLedgerStore 存储/查询/统计契约验证（对齐 Python）。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import { RuleBasedJudge } from '../src/judge.js';
import { EvalLedger, DEFAULT_MIN_NET_GAIN } from '../src/models.js';
import { EvalLedgerStore } from '../src/store.js';

function makeLedger(evalId: string, opts: Partial<{ method_id: string; proposal_id: string; merged: boolean; smoke: boolean; promotion: boolean }> = {}): EvalLedger {
  return new EvalLedger({
    eval_id: evalId,
    method_id: opts.method_id ?? 'm1',
    proposal_id: opts.proposal_id ?? 'p1',
    merged: opts.merged ?? false,
    smoke_gate_passed: opts.smoke ?? false,
    promotion_gate_passed: opts.promotion ?? false,
  });
}

describe('EvalLedgerStore', () => {
  it('默认 judge=RuleBasedJudge / minNetGain=0.05', () => {
    const store = new EvalLedgerStore();
    expect(store.judge).toBeInstanceOf(RuleBasedJudge);
    expect(store.minNetGain).toBe(DEFAULT_MIN_NET_GAIN);
  });

  it('save 返回 eval_id；get 命中/未命中', () => {
    const store = new EvalLedgerStore();
    expect(store.save(makeLedger('e1'))).toBe('e1');
    expect(store.get('e1')?.method_id).toBe('m1');
    expect(store.get('nope')).toBeUndefined();
  });

  it('listByMethod / listByProposal / listMerged / listRejected', () => {
    const store = new EvalLedgerStore();
    store.save(makeLedger('e1', { method_id: 'mA', proposal_id: 'pX', merged: true, smoke: true, promotion: true }));
    store.save(makeLedger('e2', { method_id: 'mA', proposal_id: 'pY' }));
    store.save(makeLedger('e3', { method_id: 'mB', proposal_id: 'pX' }));
    expect(store.listByMethod('mA').map((l) => l.eval_id)).toEqual(['e1', 'e2']);
    expect(store.listByProposal('pX').map((l) => l.eval_id)).toEqual(['e1', 'e3']);
    expect(store.listMerged().map((l) => l.eval_id)).toEqual(['e1']);
    expect(store.listRejected().map((l) => l.eval_id)).toEqual(['e2', 'e3']);
  });

  it('getStats 五指标', () => {
    const store = new EvalLedgerStore();
    store.save(makeLedger('e1', { merged: true, smoke: true, promotion: true }));
    store.save(makeLedger('e2', { smoke: true }));
    store.save(makeLedger('e3'));
    expect(store.getStats()).toEqual({
      total: 3,
      merged: 1,
      rejected: 2,
      smoke_passed: 2,
      promotion_passed: 1,
    });
  });
});
