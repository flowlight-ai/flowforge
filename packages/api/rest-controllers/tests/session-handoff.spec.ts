/**
 * Session handoff controller + state-machine contract tests.
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { SessionHandoffController, MemoryHandoffStateMachine } from '../src/controllers/session-handoff.ts';
import { MemoryHandoffProposalStore, type NewHandoffProposal } from '../src/ports/stores.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';
import type { SessionHandoffProposal } from '../src/contract/session.ts';

function req(method: string, url: string, opts: { headers?: Record<string, string | undefined>; body?: unknown } = {}): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}) };
}

function make() {
  const proposalStore = new MemoryHandoffProposalStore();
  const controller = new SessionHandoffController({
    proposalStore,
    identity: new DefaultRequestContextResolver(),
    generateId: (seed) => `pid_${seed}`,
  });
  return { proposalStore, controller };
}

const AUTH = { 'x-cat-cafe-user': 'default-user' };

describe('propose handoff', () => {
  it('requires identity', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/propose', { body: { done: 'x', nextSteps: 'y' } }));
    expect(res.status).toBe(401);
  });
  it('rejects an incomplete proposal with 400', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/propose', { body: { done: 'x' }, headers: AUTH }));
    expect(res.status).toBe(400);
  });
  it('creates a pending proposal (201)', async () => {
    const { controller, proposalStore } = make();
    const res = await controller.handle(
      req('POST', '/api/threads/t1/sessions/cat1/handoff/propose', {
        body: { done: 'did work', nextSteps: 'do more', commits: ['abc'], clientRequestId: 'req-1', worktreeBranch: 'feat/x' },
        headers: AUTH,
      }),
    );
    expect(res.status).toBe(201);
    const proposal = res.body as SessionHandoffProposal;
    expect(proposal.status).toBe('pending');
    expect(proposal.threadId).toBe('t1');
    expect(proposal.catId).toBe('cat1');
    expect(proposal.commits).toEqual(['abc']);
    expect((proposal as { worktreeBranch: string }).worktreeBranch).toBe('feat/x');
    expect(proposalStore.listByThread('t1')).toHaveLength(1);
  });
  it('is idempotent by clientRequestId for non-rejected proposals', async () => {
    const { controller } = make();
    const body = { done: 'd', nextSteps: 'n', clientRequestId: 'req-2' };
    await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/propose', { body, headers: AUTH }));
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/propose', { body, headers: AUTH }));
    expect(res.status).toBe(200);
    expect((res.body as { idempotent: boolean }).idempotent).toBe(true);
  });
});

describe('approve handoff', () => {
  it('returns 404 for an unknown proposal', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/nope/approve', { headers: AUTH }));
    expect(res.status).toBe(404);
  });
  it('claims then commits a pending proposal to approved', async () => {
    const { controller, proposalStore } = make();
    const proposal = proposalStore.create({ proposalId: 'p1', catId: 'cat1', threadId: 't1', done: 'd', nextSteps: 'n' });
    void proposal;
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/p1/approve', { headers: AUTH }));
    expect(res.status).toBe(200);
    expect((res.body as SessionHandoffProposal).status).toBe('approved');
  });
  it('returns 409 busy when a proposal is already approving', async () => {
    const { controller, proposalStore } = make();
    proposalStore.create({ proposalId: 'p1', catId: 'cat1', threadId: 't1', done: 'd', nextSteps: 'n' });
    const stateMachine = new MemoryHandoffStateMachine(proposalStore);
    await stateMachine.claim('p1');
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/p1/approve', { headers: AUTH }));
    expect(res.status).toBe(409);
    expect((res.body as { proposalStatus: string }).proposalStatus).toBe('approving');
  });
});

describe('reject handoff', () => {
  const pending: NewHandoffProposal = { proposalId: 'p1', catId: 'cat1', threadId: 't1', done: 'd', nextSteps: 'n' };
  it('returns 404 for an unknown proposal', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/nope/reject', { headers: AUTH }));
    expect(res.status).toBe(404);
  });
  it('rejects a pending proposal (200)', async () => {
    const { controller, proposalStore } = make();
    proposalStore.create(pending);
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/p1/reject', { headers: AUTH }));
    expect(res.status).toBe(200);
    expect(proposalStore.get('p1')?.status).toBe('rejected');
  });
  it('returns 409 conflict when the proposal was already approved', async () => {
    const { controller, proposalStore } = make();
    proposalStore.create(pending);
    const sm = new MemoryHandoffStateMachine(proposalStore);
    await sm.claim('p1');
    await sm.commit('p1');
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/p1/reject', { headers: AUTH }));
    expect(res.status).toBe(409);
    expect((res.body as { proposalStatus: string }).proposalStatus).toBe('approved');
  });
  it('returns 409 busy while approving', async () => {
    const { controller, proposalStore } = make();
    proposalStore.create(pending);
    const sm = new MemoryHandoffStateMachine(proposalStore);
    await sm.claim('p1');
    const res = await controller.handle(req('POST', '/api/threads/t1/sessions/cat1/handoff/p1/reject', { headers: AUTH }));
    expect(res.status).toBe(409);
    expect((res.body as { proposalStatus: string }).proposalStatus).toBe('approving');
  });
});