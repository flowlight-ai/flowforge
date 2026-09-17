import { describe, expect, it } from 'vitest';

import { EvaluationError } from '../src/errors.js';
import { PathResolutionError, pathExists, pathNotEmpty, resolvePath } from '../src/path.js';
import {
  pythonCompare,
  pythonEquals,
  pythonIs,
  pythonLength,
  pythonTruthy,
  pythonTypeName,
} from '../src/py-semantics.js';

describe('pythonTypeName', () => {
  it('maps JS values to the Python type names conditions rely on', () => {
    expect(pythonTypeName('x')).toBe('str');
    expect(pythonTypeName(1)).toBe('int');
    expect(pythonTypeName(1.5)).toBe('float');
    expect(pythonTypeName(true)).toBe('bool');
    expect(pythonTypeName([1, 2])).toBe('list');
    expect(pythonTypeName({ a: 1 })).toBe('dict');
    expect(pythonTypeName(null)).toBe('none');
    expect(pythonTypeName(undefined)).toBe('none');
  });
});

describe('pythonEquals', () => {
  it('compares containers structurally, unlike JS ===', () => {
    expect(pythonEquals([1, 2], [1, 2])).toBe(true);
    expect(pythonEquals([1, 2], [2, 1])).toBe(false);
    expect(pythonEquals({ a: 1 }, { a: 1 })).toBe(true);
    expect(pythonEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('keeps Python scalar semantics', () => {
    expect(pythonEquals(1, 1.0)).toBe(true);
    expect(pythonEquals('1', 1)).toBe(false);
    expect(pythonEquals(null, null)).toBe(true);
    expect(pythonEquals(true, 1)).toBe(true);
    expect(pythonEquals(false, 0)).toBe(true);
  });
});

describe('pythonCompare', () => {
  it('orders numbers and strings', () => {
    expect(pythonCompare(0.9, 0.8, '>')).toBe(true);
    expect(pythonCompare('a', 'b', '<')).toBe(true);
    expect(pythonCompare(3, 3, '>=')).toBe(true);
  });

  it('raises EvaluationError for cross-type ordering (Python TypeError)', () => {
    expect(() => pythonCompare(1, 'a', '<')).toThrow(EvaluationError);
    expect(() => pythonCompare(null, 1, '>')).toThrow(EvaluationError);
  });
});

describe('pythonIs / pythonTruthy / pythonLength', () => {
  it('treats none identity consistently', () => {
    expect(pythonIs(null, undefined)).toBe(true);
    expect(pythonIs('a', 'a')).toBe(true);
    expect(pythonIs(1, '1')).toBe(false);
  });

  it('follows Python truthiness for empty containers', () => {
    expect(pythonTruthy([])).toBe(false);
    expect(pythonTruthy({})).toBe(false);
    expect(pythonTruthy('')).toBe(false);
    expect(pythonTruthy(0)).toBe(false);
    expect(pythonTruthy([0])).toBe(true);
  });

  it('measures len() for strings and containers, rejecting scalars', () => {
    expect(pythonLength('abc')).toBe(3);
    expect(pythonLength([1, 2])).toBe(2);
    expect(pythonLength({ a: 1 })).toBe(1);
    expect(() => pythonLength(3)).toThrow(EvaluationError);
  });
});

describe('resolvePath', () => {
  const context = {
    state: {
      audit_result: { score: 0.7 },
      topic_list: [{ name: 'a' }, { name: 'b' }],
      retry_count: 0,
    },
  };

  it('resolves dotted and indexed paths', () => {
    expect(resolvePath(context, 'state.audit_result.score')).toBe(0.7);
    expect(resolvePath(context, 'state.topic_list[1].name')).toBe('b');
  });

  it('throws PathResolutionError on missing segments', () => {
    expect(() => resolvePath(context, 'state.missing')).toThrow(PathResolutionError);
    expect(() => resolvePath(context, 'state.topic_list[5]')).toThrow(PathResolutionError);
    expect(() => resolvePath(context, 'state.audit_result.score.deep')).toThrow(PathResolutionError);
  });

  it('feeds pathExists / pathNotEmpty without throwing', () => {
    expect(pathExists(context, 'state.audit_result.score')).toBe(true);
    expect(pathExists(context, 'state.missing')).toBe(false);
    expect(pathNotEmpty(context, 'state.topic_list')).toBe(true);
    expect(pathNotEmpty(context, 'state.missing')).toBe(false);
    // 0 and false are "not empty" in Python semantics (only length/None count).
    expect(pathNotEmpty(context, 'state.retry_count')).toBe(true);
  });
});
