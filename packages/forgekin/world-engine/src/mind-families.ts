/**
 * Four Mind Families guardrails (CL-026).
 *
 * Classifies Forgekins by risk appetite + autonomy level and installs the
 * matching pre/post-action guardrail:
 *
 * | family      | risk    | autonomy | typical work              | guardrail |
 * |-------------|---------|----------|---------------------------|-----------|
 * | ragdoll     | low     | E1-E2    | controlled execution      | strong    |
 * | maine_coon  | medium  | E2-E3    | collaborative exploration | medium    |
 * | siamese     | high    | E3-E4    | autonomous decisions      | weak      |
 * | hotfix      | urgent  | E5+      | production emergencies    | minimal   |
 *
 * Ported from `mind_families.py`. Three deliberate notes:
 *   - Logging is injected (`Logger`) instead of the module-level `get_logger`
 *     singleton (design D3); the default is silent.
 *   - `route()` no longer mutates the caller's context object — the source wrote
 *     `forgekin_id` / `awakening_stage` into the caller's dict; a copy is used
 *     here so callers do not observe side effects.
 *   - `FAMILY_AWAKENING_RANGE` is transcribed verbatim, including the fact that
 *     it disagrees with `selectFamily` at the boundaries (see the review notes).
 */

import { silentLogger, type Logger } from './logger.js';

export const MIND_FAMILIES = ['ragdoll', 'maine_coon', 'siamese', 'hotfix'] as const;
export type MindFamily = (typeof MIND_FAMILIES)[number];

/** Awakening-stage window declared for each family (verbatim from the source). */
export const FAMILY_AWAKENING_RANGE: Readonly<Record<MindFamily, readonly [string, string]>> = {
  ragdoll: ['E1', 'E2'],
  maine_coon: ['E2', 'E3'],
  siamese: ['E3', 'E4'],
  hotfix: ['E5', 'E6'],
};

/** Default guardrail strength per family (0 = permissive, 1 = strict). */
export const FAMILY_GUARDRAIL_STRENGTH: Readonly<Record<MindFamily, number>> = {
  ragdoll: 0.9,
  maine_coon: 0.6,
  siamese: 0.3,
  hotfix: 0.1,
};

/** Action types each family may perform without escalation. */
export const FAMILY_ALLOWED_ACTIONS: Readonly<Record<MindFamily, ReadonlySet<string>>> = {
  ragdoll: new Set(['read', 'query', 'write_doc', 'format', 'validate']),
  maine_coon: new Set(['read', 'query', 'write_doc', 'write_code', 'review', 'test', 'format', 'validate', 'plan']),
  siamese: new Set([
    'read', 'query', 'write_doc', 'write_code', 'review', 'test',
    'format', 'validate', 'plan', 'deploy', 'merge', 'refactor', 'delete',
  ]),
  // hotfix may attempt anything — the situation is already an emergency.
  hotfix: new Set([
    'read', 'query', 'write_doc', 'write_code', 'review', 'test',
    'format', 'validate', 'plan', 'deploy', 'merge', 'refactor', 'delete',
    'hotfix', 'rollback', 'force_push',
  ]),
};

export const GUARDRAIL_DECISIONS = ['allow', 'deny', 'require_approval', 'defer'] as const;
export type GuardrailDecision = (typeof GUARDRAIL_DECISIONS)[number];

/** Action context passed to guardrails (e.g. `forgekinId`, `target`, `reason`). */
export type GuardrailContext = Readonly<Record<string, unknown>>;

/** Pre/post-action guardrail for one mind family. */
export interface GuardrailHook {
  readonly family: MindFamily;
  preAction(action: string, context: GuardrailContext): GuardrailDecision;
  postAction(action: string, context: GuardrailContext, result: GuardrailContext): void;
}

/** ragdoll — low risk, controlled execution. Strictest guardrail. */
export class RagdollGuardrail implements GuardrailHook {
  readonly family: MindFamily = 'ragdoll';
  constructor(private readonly logger: Logger = silentLogger) {}

  preAction(action: string, context: GuardrailContext): GuardrailDecision {
    if (!FAMILY_ALLOWED_ACTIONS.ragdoll.has(action)) {
      this.logger.warn(`RagdollGuardrail DENY: action=${action} not allowed for ragdoll`);
      return 'deny';
    }
    if (action === 'write_doc') {
      this.logger.info(
        `RagdollGuardrail REQUIRE_APPROVAL: action=${action} forgekin=${String(context['forgekinId'] ?? 'unknown')}`,
      );
      return 'require_approval';
    }
    return 'allow';
  }

  postAction(action: string, _context: GuardrailContext, result: GuardrailContext): void {
    this.logger.info(`RagdollGuardrail post_action: action=${action} success=${String(result['success'] ?? false)}`);
  }
}

/** maine_coon — medium risk, collaborative exploration. */
export class MaineCoonGuardrail implements GuardrailHook {
  readonly family: MindFamily = 'maine_coon';
  constructor(private readonly logger: Logger = silentLogger) {}

  preAction(action: string, _context: GuardrailContext): GuardrailDecision {
    if (!FAMILY_ALLOWED_ACTIONS.maine_coon.has(action)) {
      this.logger.warn(`MaineCoonGuardrail DENY: action=${action} not allowed for maine_coon`);
      return 'deny';
    }
    return 'allow';
  }

  postAction(action: string, _context: GuardrailContext, result: GuardrailContext): void {
    this.logger.info(`MaineCoonGuardrail post_action: action=${action} success=${String(result['success'] ?? false)}`);
  }
}

/** siamese — high risk, autonomous decisions. Trusts first, audits after. */
export class SiameseGuardrail implements GuardrailHook {
  readonly family: MindFamily = 'siamese';
  constructor(private readonly logger: Logger = silentLogger) {}

  preAction(action: string, _context: GuardrailContext): GuardrailDecision {
    if (!FAMILY_ALLOWED_ACTIONS.siamese.has(action)) {
      this.logger.info(`SiameseGuardrail REQUIRE_APPROVAL: action=${action} requires operator approval`);
      return 'require_approval';
    }
    return 'allow';
  }

  postAction(action: string, context: GuardrailContext, result: GuardrailContext): void {
    this.logger.info(
      `SiameseGuardrail post_action (事后审核): action=${action} forgekin=${String(context['forgekinId'] ?? 'unknown')} success=${String(result['success'] ?? false)}`,
    );
  }
}

/** hotfix — emergencies; defers everything to a post-mortem. */
export class HotfixGuardrail implements GuardrailHook {
  readonly family: MindFamily = 'hotfix';
  constructor(private readonly logger: Logger = silentLogger) {}

  preAction(action: string, context: GuardrailContext): GuardrailDecision {
    this.logger.warn(
      `HotfixGuardrail DEFER (事后追审): action=${action} forgekin=${String(context['forgekinId'] ?? 'unknown')} reason=${String(context['reason'] ?? 'emergency')}`,
    );
    return 'defer';
  }

  postAction(action: string, context: GuardrailContext, result: GuardrailContext): void {
    this.logger.warn(
      `HotfixGuardrail post_action (追审记录): action=${action} forgekin=${String(context['forgekinId'] ?? 'unknown')} reason=${String(context['reason'] ?? 'emergency')} success=${String(result['success'] ?? false)}`,
    );
  }
}

/** Family → guardrail instances, sharing one logger. */
export function defaultFamilyHooks(logger: Logger = silentLogger): Record<MindFamily, GuardrailHook> {
  return {
    ragdoll: new RagdollGuardrail(logger),
    maine_coon: new MaineCoonGuardrail(logger),
    siamese: new SiameseGuardrail(logger),
    hotfix: new HotfixGuardrail(logger),
  };
}

/** Actions that force the hotfix family at E5+ (emergency tooling). */
const EMERGENCY_ACTIONS: ReadonlySet<string> = new Set(['hotfix', 'rollback', 'force_push']);

const STAGE_ORDER: readonly string[] = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

export interface MindFamilyRouterOptions {
  readonly hooks?: Record<MindFamily, GuardrailHook>;
  readonly logger?: Logger;
}

/** Result of a pre-action routing decision. */
export interface RouteOutcome {
  readonly family: MindFamily;
  readonly decision: GuardrailDecision;
}

/**
 * Picks a mind family from the awakening stage / action / context, then runs the
 * family's pre-action guardrail.
 */
export class MindFamilyRouter {
  private readonly hooks: Record<MindFamily, GuardrailHook>;
  private readonly logger: Logger;

  constructor(options: MindFamilyRouterOptions = {}) {
    this.logger = options.logger ?? silentLogger;
    this.hooks = options.hooks ?? defaultFamilyHooks(this.logger);
  }

  /** `context.emergency` always wins; an unknown stage falls back to E1. */
  selectFamily(awakeningStage: string, action: string, context: GuardrailContext = {}): MindFamily {
    if (context['emergency']) return 'hotfix';

    const index = STAGE_ORDER.indexOf(awakeningStage);
    const stageIndex = index < 0 ? 0 : index;

    if (stageIndex <= 1) return 'ragdoll';
    if (stageIndex <= 2) return 'maine_coon';
    if (stageIndex <= 3) return 'siamese';
    return EMERGENCY_ACTIONS.has(action) ? 'hotfix' : 'siamese';
  }

  /**
   * Select a family and run its pre-action guardrail. The caller's `context` is
   * not mutated; `forgekinId` / `awakeningStage` are added to a copy.
   */
  route(
    forgekinId: string,
    awakeningStage: string,
    action: string,
    context: GuardrailContext = {},
  ): RouteOutcome {
    const enriched: GuardrailContext = { ...context, forgekinId, awakeningStage };
    const family = this.selectFamily(awakeningStage, action, enriched);
    const decision = this.hooks[family].preAction(action, enriched);
    this.logger.info(
      `MindFamilyRouter: forgekin=${forgekinId} stage=${awakeningStage} action=${action} family=${family} decision=${decision}`,
    );
    return { family, decision };
  }

  /** Run the matching family's post-action guardrail. */
  postRoute(
    family: MindFamily,
    action: string,
    context: GuardrailContext,
    result: GuardrailContext,
  ): void {
    this.hooks[family].postAction(action, context, result);
  }
}
