/**
 * Core Identity Layer (F093 layer 1) — the Forgekin's immutable identity.
 *
 * This layer **cannot be polluted by any episode**: even after playing
 * "孙悟空" a thousand times, the identity is still "写作 Forgekin".
 *
 * Design points carried over from `core_identity.py`:
 *   - **Fully immutable** — the Python model used `ConfigDict(frozen=True)`.
 *     Here the object is `Object.freeze`d *and* typed `readonly`, so the
 *     guarantee holds at runtime and at compile time (CL-007).
 *   - **Separate from any mutable profile** — this layer carries identity only,
 *     never task experience.
 *   - **SoulImprint anchor** — `soulImprintHash` references the soul imprint and
 *     is the lineage-tracking anchor.
 *
 * Key naming: the legacy `describe()` returned snake_case keys. Identifiers here
 * follow the TypeScript field names (camelCase) since no ported consumer reads
 * the dictionary yet.
 */

import { WorldEngineValidationError } from './errors.js';
import { assertKnownKeys, freeze, requireNonEmpty, requireUnique } from './validation.js';

/** The Forgekin's immutable identity anchor. */
export interface CoreIdentityLayer {
  readonly forgekinId: string;
  readonly name: string;
  /** ForgekinSpecies value, e.g. `'bio'` / `'virtual'`. */
  readonly species: string;
  readonly birthTimestamp: string;
  readonly corePersonality: readonly string[];
  readonly valueAnchors: readonly string[];
  readonly soulImprintHash: string;
}

const CORE_IDENTITY_FIELDS = [
  'forgekinId',
  'name',
  'species',
  'birthTimestamp',
  'corePersonality',
  'valueAnchors',
  'soulImprintHash',
] as const;

/**
 * Build a frozen core identity. Mirrors the pydantic validators: the four
 * scalar fields must be non-empty after trimming, and the two list fields must
 * contain no duplicates (CL-007).
 */
export function createCoreIdentity(input: {
  forgekinId: unknown;
  name: unknown;
  species: unknown;
  birthTimestamp: unknown;
  corePersonality?: unknown;
  valueAnchors?: unknown;
  soulImprintHash: unknown;
}): CoreIdentityLayer {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WorldEngineValidationError('CoreIdentityLayer must be an object');
  }
  const raw = input as Record<string, unknown>;
  assertKnownKeys(raw, CORE_IDENTITY_FIELDS, 'CoreIdentityLayer');
  return freeze({
    forgekinId: requireNonEmpty(raw['forgekinId'], 'forgekin_id', 'CoreIdentityLayer'),
    name: requireNonEmpty(raw['name'], 'name', 'CoreIdentityLayer'),
    species: requireNonEmpty(raw['species'], 'species', 'CoreIdentityLayer'),
    birthTimestamp: String(raw['birthTimestamp'] ?? ''),
    corePersonality: requireUnique(raw['corePersonality'] ?? [], 'core_personality', 'CoreIdentityLayer'),
    valueAnchors: requireUnique(raw['valueAnchors'] ?? [], 'value_anchors', 'CoreIdentityLayer'),
    soulImprintHash: requireNonEmpty(raw['soulImprintHash'], 'soul_imprint_hash', 'CoreIdentityLayer'),
  });
}

/** Description payload for logs / lineage tracking / UI. */
export interface CoreIdentityDescription {
  readonly forgekinId: string;
  readonly name: string;
  readonly species: string;
  readonly birthTimestamp: string;
  readonly corePersonality: readonly string[];
  readonly valueAnchors: readonly string[];
  readonly soulImprintHash: string;
  readonly layer: 'core_identity';
  readonly immutable: true;
}

export function describeCoreIdentity(identity: CoreIdentityLayer): CoreIdentityDescription {
  return {
    forgekinId: identity.forgekinId,
    name: identity.name,
    species: identity.species,
    birthTimestamp: identity.birthTimestamp,
    corePersonality: [...identity.corePersonality],
    valueAnchors: [...identity.valueAnchors],
    soulImprintHash: identity.soulImprintHash,
    layer: 'core_identity',
    immutable: true,
  };
}

/**
 * Cross-session / cross-generation identity check. `false` means the identity
 * and the presented soul imprint disagree.
 */
export function verifyImprint(identity: CoreIdentityLayer, soulImprintHash: string): boolean {
  return identity.soulImprintHash === soulImprintHash;
}
