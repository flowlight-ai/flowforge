/**
 * Dynamic catId Zod schema — defers validation to request time.
 *
 * Cannot use z.enum() because modules are imported at startup
 * before the registry is populated. z.string().refine() evaluates
 * the predicate lazily at validation time.
 *
 * In flowforge the registry is a Cordis Service (`ctx.cats`); callers pass
 * the live instance so the schema validates against the current revision.
 */

import { z } from 'zod';
import type { CatRegistry } from './CatRegistry.ts';

/**
 * Zod schema for catId fields in route schemas.
 * Returns z.string() refined against the live registry.
 */
export function catIdSchema(registry: CatRegistry) {
  return z.string().refine(
    (id) => registry.has(id),
    {
      error: issue => `Unknown cat ID: "${issue.input}". Valid: ${registry.getAllIds().join(', ')}`,
    },
  );
}
