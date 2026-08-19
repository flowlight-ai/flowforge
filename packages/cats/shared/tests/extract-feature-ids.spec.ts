import { describe, expect, it } from 'vitest';
import { extractFeatureIds } from '../src/types/cross-thread-affordance.ts';

describe('extractFeatureIds (F193 Phase E)', () => {
  it('extracts F-IDs from text', () => {
    expect(extractFeatureIds('Fix F193 bug in F209')).toEqual(['F193', 'F209']);
  });

  it('deduplicates', () => {
    expect(extractFeatureIds('F193 and F193 again')).toEqual(['F193']);
  });

  it('returns sorted', () => {
    expect(extractFeatureIds('F209 then F042')).toEqual(['F042', 'F209']);
  });

  it('returns empty for no matches', () => {
    expect(extractFeatureIds('no feature ids here')).toEqual([]);
  });

  it('ignores partial matches', () => {
    // "F1" is too short (< 2 digits), "F12345" has 5 digits (> 4)
    expect(extractFeatureIds('F1 and F12345')).toEqual([]);
  });

  it('extracts from mixed text with feature IDs', () => {
    expect(extractFeatureIds('Task: fix F193 cross-thread bug, relates to F128 propose_thread')).toEqual([
      'F128',
      'F193',
    ]);
  });

  it('handles word boundaries correctly', () => {
    // "STUFF42" should not match, but "F42" should
    expect(extractFeatureIds('STUFF42 vs F42')).toEqual(['F42']);
  });

  // P1-1 fix: lowercase f support
  it('extracts lowercase f-IDs and normalizes to uppercase', () => {
    expect(extractFeatureIds('fix f209 bug')).toEqual(['F209']);
  });

  it('handles mixed case F/f IDs', () => {
    expect(extractFeatureIds('F193 and f209')).toEqual(['F193', 'F209']);
  });

  it('deduplicates across case variants', () => {
    expect(extractFeatureIds('F193 and f193')).toEqual(['F193']);
  });
});
