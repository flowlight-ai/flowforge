import { expect, test } from 'vitest';
import { builtinAccountFamilyForClient, builtinAccountIdForClient, protocolForClient } from '../src/index.ts';

test('catagent shares anthropic builtin account family', () => {
  expect(builtinAccountFamilyForClient('catagent')).toBe('anthropic');
  expect(builtinAccountIdForClient('catagent')).toBe('claude');
});

test('protocolForClient normalizes provider family routing', () => {
  expect(protocolForClient('catagent')).toBe('anthropic');
  expect(protocolForClient('opencode')).toBe('anthropic');
  expect(protocolForClient('antigravity')).toBe(null);
});
