import { describe, expect, it } from 'vitest';

import { EvaluationError, ExpressionError } from '../src/errors.js';
import { evaluateCondition } from '../src/expression.js';

const context = {
  state: {
    score: 0.9,
    audit_score: 0.4,
    urgency: 'high',
    intent: 'deep_research',
    topic_list: ['ai', 'infra'],
    audit_result: { score: 0.7, verdict: 'pass' },
    errors: ['boom'],
    retry_count: 2,
    empty_reason: '',
    reason: 'because',
  },
  event: { kind: 'tick' },
};

describe('literals and comparisons', () => {
  it('compares scalars', () => {
    expect(evaluateCondition('state.score >= 0.8', context)).toBe(true);
    expect(evaluateCondition('state.score < 0.8', context)).toBe(false);
    expect(evaluateCondition("state.urgency == 'high'", context)).toBe(true);
    expect(evaluateCondition("state.urgency != 'low'", context)).toBe(true);
    expect(evaluateCondition('state.score == none', { state: {} })).toBe(true);
  });

  it('supports chained comparisons', () => {
    expect(evaluateCondition('0 < state.score < 1', context)).toBe(true);
    expect(evaluateCondition('0 < state.score < 0.5', context)).toBe(false);
  });

  it('supports is / is not and boolean literals', () => {
    expect(evaluateCondition('state.reason is not none', context)).toBe(true);
    expect(evaluateCondition('true', context)).toBe(true);
    expect(evaluateCondition('false', context)).toBe(false);
  });

  it('treats a missing member as none, like Python dict.get', () => {
    expect(evaluateCondition('state.absent == none', context)).toBe(true);
  });
});

describe('nested field access', () => {
  it('resolves dotted paths', () => {
    expect(evaluateCondition('state.audit_result.score == 0.7', context)).toBe(true);
    expect(evaluateCondition("state.audit_result.verdict == 'pass'", context)).toBe(true);
  });

  it('resolves index paths', () => {
    expect(evaluateCondition("state.topic_list[0] == 'ai'", context)).toBe(true);
    expect(evaluateCondition('state.topic_list[1] == "infra"', context)).toBe(true);
  });

  it('raises on an out-of-range index (source KeyError parity)', () => {
    expect(() => evaluateCondition('state.topic_list[9] == "x"', context)).toThrow(ExpressionError);
  });
});

describe('existence / containment / emptiness sugar', () => {
  it('handles `exists`', () => {
    expect(evaluateCondition('state.urgency exists', context)).toBe(true);
    expect(evaluateCondition('state.absent exists', context)).toBe(false);
    expect(evaluateCondition('state.audit_result.score exists', context)).toBe(true);
    expect(evaluateCondition('state.topic_list[0] exists', context)).toBe(true);
  });

  it('handles `not_empty`', () => {
    expect(evaluateCondition('state.reason not_empty', context)).toBe(true);
    expect(evaluateCondition('state.empty_reason not_empty', context)).toBe(false);
    expect(evaluateCondition('state.absent not_empty', context)).toBe(false);
  });

  it('handles `contains` and `in`', () => {
    expect(evaluateCondition('state.topic_list contains "ai"', context)).toBe(true);
    expect(evaluateCondition('state.topic_list contains "zzz"', context)).toBe(false);
    expect(evaluateCondition('"infra" in state.topic_list', context)).toBe(true);
    expect(evaluateCondition('"nope" not in state.topic_list', context)).toBe(true);
    expect(evaluateCondition("'high' in state.urgency", context)).toBe(true);
  });

  it('rejects a non-literal right side for `contains`', () => {
    expect(() => evaluateCondition('state.topic_list contains state.reason', context)).toThrow(
      ExpressionError,
    );
  });

  it('restricts exists/not_empty to paths', () => {
    expect(() => evaluateCondition('(state.score) exists', context)).toThrow(ExpressionError);
  });
});

describe('logic', () => {
  it('combines conditions with and / or / not', () => {
    expect(evaluateCondition("state.score > 0.5 and state.urgency == 'high'", context)).toBe(true);
    expect(evaluateCondition("state.score > 0.95 or state.urgency == 'high'", context)).toBe(true);
    expect(evaluateCondition("not state.score > 0.95", context)).toBe(true);
    expect(evaluateCondition("state.urgency == 'low' or state.intent == 'none'", context)).toBe(
      false,
    );
  });

  it('evaluates every operand like the source (no short-circuit)', () => {
    // The first operand is false; an eager evaluator still touches the second,
    // which raises. (A short-circuiting evaluator would return false instead.)
    expect(() => evaluateCondition("state.score > 5 and state.topic_list[9] == 'x'", context)).toThrow(
      ExpressionError,
    );
  });
});

describe('built-ins', () => {
  it('supports len / type', () => {
    expect(evaluateCondition('len(state.topic_list) >= 3', context)).toBe(false);
    expect(evaluateCondition('len(state.topic_list) >= 2', context)).toBe(true);
    expect(evaluateCondition('type(state.topic_list) == "list"', context)).toBe(true);
    expect(evaluateCondition('type(state.score) == "float"', context)).toBe(true);
    expect(evaluateCondition('type(state.errors) == "list"', context)).toBe(true);
  });

  it('supports has_error / retry_count / score_above', () => {
    expect(evaluateCondition('has_error()', context)).toBe(true);
    expect(evaluateCondition('has_error()', { state: { errors: [] } })).toBe(false);
    expect(evaluateCondition('retry_count() > 1', context)).toBe(true);
    expect(evaluateCondition('retry_count() > 5', context)).toBe(false);
    expect(evaluateCondition('score_above(0.5)', context)).toBe(true);
    expect(evaluateCondition('score_above(0.95)', { state: { audit_score: 0.4 } })).toBe(false);
  });

  it('enforces built-in arity', () => {
    expect(() => evaluateCondition('len(state.topic_list, 2)', context)).toThrow(ExpressionError);
    expect(() => evaluateCondition('score_above()', context)).toThrow(ExpressionError);
  });
});

describe('safety', () => {
  it('rejects non-whitelisted functions', () => {
    expect(() => evaluateCondition("__import__('os')", context)).toThrow(ExpressionError);
    expect(() => evaluateCondition("eval('1')", context)).toThrow(ExpressionError);
    expect(() => evaluateCondition('open("x")', context)).toThrow(ExpressionError);
  });

  it('rejects method calls on values', () => {
    expect(() => evaluateCondition("state.urgency.upper() == 'HIGH'", context)).toThrow(
      ExpressionError,
    );
  });

  it('rejects keyword arguments', () => {
    expect(() => evaluateCondition('len(x=1)', context)).toThrow(ExpressionError);
  });

  it('rejects binary arithmetic (unsupported in the source)', () => {
    expect(() => evaluateCondition('1 + 2 > 1', context)).toThrow(ExpressionError);
    expect(() => evaluateCondition('state.score * 2 > 1', context)).toThrow(ExpressionError);
  });

  it('rejects slices', () => {
    expect(() => evaluateCondition('state.topic_list[0:2] exists', context)).toThrow(
      ExpressionError,
    );
  });

  it('rejects undefined variables and malformed expressions', () => {
    // A missing *root* variable is an error; a missing *member* is `none`
    // (Python `dict.get` parity — asserted separately above).
    expect(() => evaluateCondition('missing_root == 1', context)).toThrow(ExpressionError);
    // `exists` swallows the lookup failure instead (source `_exists` parity).
    expect(evaluateCondition('missing_root exists', context)).toBe(false);
    expect(() => evaluateCondition('state.score >', context)).toThrow(ExpressionError);
    expect(() => evaluateCondition('', context)).toThrow(ExpressionError);
    expect(() => evaluateCondition("state.urgency = 'high'", context)).toThrow(ExpressionError);
  });

  it('raises EvaluationError (not ExpressionError) on type mismatch', () => {
    expect(() => evaluateCondition('state.score < "a"', context)).toThrow(EvaluationError);
    expect(() => evaluateCondition('state.score < "a"', context)).not.toThrow(ExpressionError);
  });
});
