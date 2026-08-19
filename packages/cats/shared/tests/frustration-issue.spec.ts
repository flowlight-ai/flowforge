import { describe, expect, it } from 'vitest';
import { createCatId, type CatId } from '../src/types/ids.ts';
import type { CreateFrustrationIssueInput } from '../src/types/frustration-issue.ts';

describe('F222: FrustrationIssue types', () => {
  describe('generateFrustrationIssueId', () => {
    it('generates ID with fi_ prefix', async () => {
      const { generateFrustrationIssueId } = await import('../src/types/frustration-issue.ts');
      const id = generateFrustrationIssueId();
      expect(id.startsWith('fi_')).toBeTruthy();
    });

    it('generates unique IDs', async () => {
      const { generateFrustrationIssueId } = await import('../src/types/frustration-issue.ts');
      const id1 = generateFrustrationIssueId();
      const id2 = generateFrustrationIssueId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('createFrustrationIssue', () => {
    const validInput: CreateFrustrationIssueInput = {
      threadId: 'thread_abc123',
      userId: 'user_xyz',
      catId: createCatId('cat-test'),
      signalType: 'cli_error',
      signalDetail: { reasonCode: 'auth_failed', publicSummary: 'Auth failed' },
      context: {
        recentMessages: [{ role: 'user', content: 'help me', timestamp: 1000 }],
        errorLogs: 'Error: auth failed',
      },
    };

    it('creates issue with status=draft', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      const issue = createFrustrationIssue(validInput);
      expect(issue.status).toBe('draft');
    });

    it('generates issueId with fi_ prefix', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      const issue = createFrustrationIssue(validInput);
      expect(issue.issueId.startsWith('fi_')).toBeTruthy();
    });

    it('copies all input fields', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      const issue = createFrustrationIssue(validInput);
      expect(issue.threadId).toBe('thread_abc123');
      expect(issue.userId).toBe('user_xyz');
      expect(issue.catId).toBe('cat-test');
      expect(issue.signalType).toBe('cli_error');
      expect(issue.signalDetail).toEqual(validInput.signalDetail);
      expect(issue.context.recentMessages.length).toBe(1);
      expect(issue.context.errorLogs).toBe('Error: auth failed');
    });

    it('sets createdAt timestamp', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      const before = Date.now();
      const issue = createFrustrationIssue(validInput);
      const after = Date.now();
      expect(issue.createdAt >= before && issue.createdAt <= after).toBeTruthy();
    });

    it('leaves confirmedAt and skippedAt undefined', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      const issue = createFrustrationIssue(validInput);
      expect(issue.confirmedAt).toBe(undefined);
      expect(issue.skippedAt).toBe(undefined);
    });

    it('preserves optional invocationId', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      const issue = createFrustrationIssue({ ...validInput, invocationId: 'inv_123' });
      expect(issue.invocationId).toBe('inv_123');
    });

    it('rejects missing threadId', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      expect(() => createFrustrationIssue({ ...validInput, threadId: '' })).toThrow(/threadId.*required/i);
    });

    it('rejects missing userId', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      expect(() => createFrustrationIssue({ ...validInput, userId: '' })).toThrow(/userId.*required/i);
    });

    it('rejects missing catId', async () => {
      const { createFrustrationIssue } = await import('../src/types/frustration-issue.ts');
      // 测试便利性: 空字符串用于触发工厂校验，createCatId 会先行抛错，故用 as 断言绕过品牌类型
      expect(() => createFrustrationIssue({ ...validInput, catId: '' as CatId })).toThrow(/catId.*required/i);
    });
  });
});
