import { describe, expect, it } from 'vitest';

describe('Meeting types', () => {
  describe('MeetingSession', () => {
    it('createMeetingSession produces valid session with required fields', async () => {
      const { createMeetingSession } = await import('../src/types/meeting.ts');
      const session = createMeetingSession({
        threadId: 'thread_abc123',
        participants: [{ id: 'p1', name: 'Alice' }],
      });

      expect(session.meetingId).toBeTruthy();
      expect(session.meetingId.startsWith('mtg_')).toBeTruthy();
      expect(session.threadId).toBe('thread_abc123');
      expect(session.status).toBe('active');
      expect(session.participants.length).toBe(1);
      expect(session.participants[0]?.name).toBe('Alice');
      expect(session.startedAt > 0).toBeTruthy();
    });

    it('createMeetingSession rejects empty threadId', async () => {
      const { createMeetingSession } = await import('../src/types/meeting.ts');
      expect(() => createMeetingSession({ threadId: '', participants: [] })).toThrow(/threadId.*required/i);
    });

    it('two sessions get different meetingIds', async () => {
      const { createMeetingSession } = await import('../src/types/meeting.ts');
      const s1 = createMeetingSession({ threadId: 't1', participants: [] });
      const s2 = createMeetingSession({ threadId: 't2', participants: [] });
      expect(s1.meetingId).not.toBe(s2.meetingId);
    });
  });

  describe('MeetingParticipant validation', () => {
    it('validates participant with minimal fields', async () => {
      const { validateParticipant } = await import('../src/types/meeting.ts');
      const p = validateParticipant({ id: 'p1', name: 'Bob' });
      expect(p.id).toBe('p1');
      expect(p.name).toBe('Bob');
      expect(p.role).toBe(undefined);
    });

    it('accepts optional role and speakerEmbeddingId', async () => {
      const { validateParticipant } = await import('../src/types/meeting.ts');
      const p = validateParticipant({
        id: 'p2',
        name: 'Carol',
        role: 'host',
        speakerEmbeddingId: 'emb_xyz',
      });
      expect(p.role).toBe('host');
      expect(p.speakerEmbeddingId).toBe('emb_xyz');
    });

    it('rejects participant with empty name', async () => {
      const { validateParticipant } = await import('../src/types/meeting.ts');
      expect(() => validateParticipant({ id: 'p3', name: '' })).toThrow(/name.*required/i);
    });

    it('rejects invalid role', async () => {
      const { validateParticipant } = await import('../src/types/meeting.ts');
      expect(() => validateParticipant({ id: 'p4', name: 'Dan', role: 'admin' })).toThrow(/role/i);
    });
  });

  describe('MeetingSession status transitions', () => {
    it('transitionMeetingStatus active → paused', async () => {
      const { createMeetingSession, transitionMeetingStatus } = await import('../src/types/meeting.ts');
      const session = createMeetingSession({ threadId: 't1', participants: [] });
      const paused = transitionMeetingStatus(session, 'paused');
      expect(paused.status).toBe('paused');
    });

    it('transitionMeetingStatus active → ended', async () => {
      const { createMeetingSession, transitionMeetingStatus } = await import('../src/types/meeting.ts');
      const session = createMeetingSession({ threadId: 't1', participants: [] });
      const ended = transitionMeetingStatus(session, 'ended');
      expect(ended.status).toBe('ended');
    });

    it('rejects ended → active (no resurrection)', async () => {
      const { createMeetingSession, transitionMeetingStatus } = await import('../src/types/meeting.ts');
      const session = createMeetingSession({ threadId: 't1', participants: [] });
      const ended = transitionMeetingStatus(session, 'ended');
      expect(() => transitionMeetingStatus(ended, 'active')).toThrow(/cannot transition.*ended/i);
    });
  });
});
