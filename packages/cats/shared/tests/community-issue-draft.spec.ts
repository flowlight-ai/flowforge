import { describe, expect, it } from 'vitest';

describe('F235: CommunityIssueDraft types', () => {
  describe('generateCommunityIssueDraftId', () => {
    it('generates ID with cid_ prefix', async () => {
      const { generateCommunityIssueDraftId } = await import('../src/types/community-issue-draft.ts');
      const id = generateCommunityIssueDraftId();
      expect(id.startsWith('cid_')).toBeTruthy();
    });

    it('generates unique IDs', async () => {
      const { generateCommunityIssueDraftId } = await import('../src/types/community-issue-draft.ts');
      const id1 = generateCommunityIssueDraftId();
      const id2 = generateCommunityIssueDraftId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('createCommunityIssueDraft', () => {
    const validInput = {
      sourceType: 'frustration_issue',
      sourceId: 'fi_abc123',
      title: 'Permission prompts too frequent',
      bodyMarkdown: '## Problem\nUser cancelled 4 times in 60s.',
      targetRepo: 'clowder-ai/cat-cafe',
      labels: ['bug', 'user-reported'],
      threadId: 'thread_xyz',
      userId: 'usr_test',
    } as const;

    it('creates draft with status=draft', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      const draft = createCommunityIssueDraft(validInput);
      expect(draft.status).toBe('draft');
    });

    it('generates draftId with cid_ prefix', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      const draft = createCommunityIssueDraft(validInput);
      expect(draft.draftId.startsWith('cid_')).toBeTruthy();
    });

    it('copies all input fields', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      const draft = createCommunityIssueDraft(validInput);
      expect(draft.sourceType).toBe('frustration_issue');
      expect(draft.sourceId).toBe('fi_abc123');
      expect(draft.title).toBe('Permission prompts too frequent');
      expect(draft.bodyMarkdown).toBe('## Problem\nUser cancelled 4 times in 60s.');
      expect(draft.targetRepo).toBe('clowder-ai/cat-cafe');
      expect(draft.labels).toEqual(['bug', 'user-reported']);
      expect(draft.threadId).toBe('thread_xyz');
      expect(draft.userId).toBe('usr_test');
    });

    it('sets createdAt timestamp', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      const before = Date.now();
      const draft = createCommunityIssueDraft(validInput);
      const after = Date.now();
      expect(draft.createdAt >= before && draft.createdAt <= after).toBeTruthy();
    });

    it('leaves publish/cancel fields undefined', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      const draft = createCommunityIssueDraft(validInput);
      expect(draft.githubIssueNumber).toBe(undefined);
      expect(draft.githubIssueUrl).toBe(undefined);
      expect(draft.publishedAt).toBe(undefined);
      expect(draft.cancelledAt).toBe(undefined);
    });

    it('rejects empty title', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      expect(() => createCommunityIssueDraft({ ...validInput, title: '' })).toThrow(/title.*required/i);
    });

    it('rejects empty sourceId', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      expect(() => createCommunityIssueDraft({ ...validInput, sourceId: '' })).toThrow(/sourceId.*required/i);
    });

    it('rejects empty targetRepo', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      expect(() => createCommunityIssueDraft({ ...validInput, targetRepo: '' })).toThrow(/targetRepo.*required/i);
    });
  });

  describe('Phase B: cat_initiated sourceType', () => {
    it('accepts cat_initiated as sourceType', async () => {
      const { createCommunityIssueDraft } = await import('../src/types/community-issue-draft.ts');
      const draft = createCommunityIssueDraft({
        sourceType: 'cat_initiated',
        sourceId: 'conv_test_123',
        title: 'Test issue from cat',
        bodyMarkdown: 'Cat drafted this issue',
        targetRepo: 'clowder-ai/cat-cafe',
        labels: ['user-reported'],
        threadId: 'thread_test',
        userId: 'user_test',
      });
      expect(draft.sourceType).toBe('cat_initiated');
      expect(draft.status).toBe('draft');
      expect(draft.draftId.startsWith('cid_')).toBeTruthy();
    });
  });
});
