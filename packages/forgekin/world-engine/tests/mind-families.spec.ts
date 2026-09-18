import { describe, expect, it, vi } from 'vitest';

import {
  FAMILY_ALLOWED_ACTIONS,
  FAMILY_AWAKENING_RANGE,
  FAMILY_GUARDRAIL_STRENGTH,
  MIND_FAMILIES,
  MindFamilyRouter,
  defaultFamilyHooks,
} from '../src/mind-families.js';
import type { Logger } from '../src/logger.js';

function spyLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('mind family constants', () => {
  it('declares four families with the documented tables', () => {
    expect(MIND_FAMILIES).toEqual(['ragdoll', 'maine_coon', 'siamese', 'hotfix']);
    expect(FAMILY_AWAKENING_RANGE.ragdoll).toEqual(['E1', 'E2']);
    expect(FAMILY_AWAKENING_RANGE.hotfix).toEqual(['E5', 'E6']);
    // guardrail strength decreases as autonomy rises
    expect(FAMILY_GUARDRAIL_STRENGTH.ragdoll).toBeGreaterThan(FAMILY_GUARDRAIL_STRENGTH.maine_coon);
    expect(FAMILY_GUARDRAIL_STRENGTH.maine_coon).toBeGreaterThan(FAMILY_GUARDRAIL_STRENGTH.siamese);
    expect(FAMILY_GUARDRAIL_STRENGTH.siamese).toBeGreaterThan(FAMILY_GUARDRAIL_STRENGTH.hotfix);
    expect(FAMILY_ALLOWED_ACTIONS.ragdoll.has('deploy')).toBe(false);
    expect(FAMILY_ALLOWED_ACTIONS.hotfix.has('force_push')).toBe(true);
  });
});

describe('family guardrails', () => {
  it('ragdoll denies out-of-scope actions and escalates write_doc', () => {
    const router = new MindFamilyRouter();
    expect(router.route('f1', 'E1', 'read').decision).toBe('allow');
    expect(router.route('f1', 'E1', 'write_doc').decision).toBe('require_approval');
    expect(router.route('f1', 'E1', 'deploy').decision).toBe('deny');
    expect(router.route('f1', 'E1', 'write_code').decision).toBe('deny');
  });

  it('maine coon denies what it may not do and allows the rest', () => {
    const router = new MindFamilyRouter();
    expect(router.route('f1', 'E3', 'plan').decision).toBe('allow');
    expect(router.route('f1', 'E3', 'write_code').decision).toBe('allow');
    expect(router.route('f1', 'E3', 'deploy').decision).toBe('deny');
    expect(router.route('f1', 'E3', 'delete').decision).toBe('deny');
  });

  it('siamese escalates out-of-scope actions instead of denying', () => {
    const router = new MindFamilyRouter();
    expect(router.route('f1', 'E4', 'deploy').decision).toBe('allow');
    expect(router.route('f1', 'E4', 'unknown_action').decision).toBe('require_approval');
  });

  it('hotfix defers whenever it is the selected family', () => {
    const router = new MindFamilyRouter();
    expect(router.route('f1', 'E6', 'hotfix').decision).toBe('defer');
    expect(router.route('f1', 'E6', 'rollback').decision).toBe('defer');
    expect(router.route('f1', 'E1', 'deploy', { emergency: true }).decision).toBe('defer');
    // E6 + a non-emergency action selects siamese, not hotfix (source parity)
    expect(router.route('f1', 'E6', 'read').decision).toBe('allow');
    expect(router.selectFamily('E6', 'read')).toBe('siamese');
  });
});

describe('MindFamilyRouter.selectFamily', () => {
  it('maps awakening stages to families', () => {
    const router = new MindFamilyRouter();
    expect(router.selectFamily('E1', 'read')).toBe('ragdoll');
    expect(router.selectFamily('E2', 'read')).toBe('ragdoll');
    expect(router.selectFamily('E3', 'write_code')).toBe('maine_coon');
    expect(router.selectFamily('E4', 'deploy')).toBe('siamese');
    expect(router.selectFamily('E5', 'deploy')).toBe('siamese');
    expect(router.selectFamily('E6', 'read')).toBe('siamese');
  });

  it('routes E5+ emergency actions to hotfix', () => {
    const router = new MindFamilyRouter();
    expect(router.selectFamily('E5', 'rollback')).toBe('hotfix');
    expect(router.selectFamily('E6', 'force_push')).toBe('hotfix');
    expect(router.selectFamily('E6', 'hotfix')).toBe('hotfix');
  });

  it('lets the emergency flag override the stage', () => {
    const router = new MindFamilyRouter();
    expect(router.selectFamily('E1', 'read', { emergency: true })).toBe('hotfix');
  });

  it('falls back to ragdoll for an unknown stage', () => {
    const router = new MindFamilyRouter();
    expect(router.selectFamily('E99', 'read')).toBe('ragdoll');
    expect(router.selectFamily('', 'read')).toBe('ragdoll');
  });
});

describe('MindFamilyRouter routing and logging', () => {
  it('enriches a copy of the context without mutating the caller object', () => {
    const router = new MindFamilyRouter();
    const context = { target: 'main' };
    const outcome = router.route('f1', 'E1', 'read', context);
    expect(outcome).toEqual({ family: 'ragdoll', decision: 'allow' });
    expect(context).toEqual({ target: 'main' });
  });

  it('logs the routing decision through the injected logger', () => {
    const logger = spyLogger();
    const router = new MindFamilyRouter({ logger });
    router.route('f1', 'E1', 'read');
    expect(logger.info).toHaveBeenCalledOnce();
    expect(String((logger.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('family=ragdoll');
  });

  it('is silent by default', () => {
    const router = new MindFamilyRouter();
    expect(() => router.route('f1', 'E1', 'read')).not.toThrow();
  });

  it('runs the matching post-action hook', () => {
    const logger = spyLogger();
    const router = new MindFamilyRouter({ logger });
    router.postRoute('siamese', 'deploy', { forgekinId: 'f1' }, { success: true });
    expect(logger.info).toHaveBeenCalledOnce();
    expect(String((logger.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('事后审核');
  });

  it('shares one logger across the default hooks', () => {
    const logger = spyLogger();
    const hooks = defaultFamilyHooks(logger);
    hooks.ragdoll.preAction('deploy', {});
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('accepts injected hooks', () => {
    const preAction = vi.fn(() => 'allow' as const);
    const postAction = vi.fn();
    const router = new MindFamilyRouter({
      hooks: {
        ragdoll: { family: 'ragdoll', preAction, postAction },
        maine_coon: { family: 'maine_coon', preAction, postAction },
        siamese: { family: 'siamese', preAction, postAction },
        hotfix: { family: 'hotfix', preAction, postAction },
      },
    });
    expect(router.route('f1', 'E1', 'read').decision).toBe('allow');
    expect(preAction).toHaveBeenCalledWith('read', expect.objectContaining({ forgekinId: 'f1', awakeningStage: 'E1' }));
  });
});
