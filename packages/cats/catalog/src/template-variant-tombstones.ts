/**
 * 模板变体墓碑（tombstone）— 纯函数（C37）。
 *
 * 移植自 clowder-ai `config/template-variant-tombstones.ts`：用户删除的模板
 * 变体记录在 catalog 的 `templateVariantTombstones` 段，阻止后续升级回填复活。
 */

import type { RecordOf } from './types.js';

export const TEMPLATE_VARIANT_TOMBSTONES_KEY = 'templateVariantTombstones';

export interface TemplateVariantTombstoneInput {
  breedId: string;
  variantId: string;
  catId: string;
}

interface TemplateVariantTombstoneRecord extends TemplateVariantTombstoneInput {
  deletedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tombstoneKey({ breedId, variantId, catId }: TemplateVariantTombstoneInput): string {
  return `${breedId}\u001f${variantId}\u001f${catId}`;
}

function readTombstoneRecords(catalog: RecordOf): Record<string, unknown> {
  const records = catalog[TEMPLATE_VARIANT_TOMBSTONES_KEY];
  return isRecord(records) ? records : {};
}

export function isTemplateVariantTombstoned(
  catalog: RecordOf,
  input: TemplateVariantTombstoneInput,
): boolean {
  return Object.hasOwn(readTombstoneRecords(catalog), tombstoneKey(input));
}

export function addTemplateVariantTombstone(
  catalog: RecordOf,
  input: TemplateVariantTombstoneInput,
): void {
  const records = readTombstoneRecords(catalog);
  const key = tombstoneKey(input);
  const existing = records[key];
  records[key] = isRecord(existing)
    ? existing
    : ({
        ...input,
        deletedAt: new Date().toISOString(),
      } satisfies TemplateVariantTombstoneRecord);
  catalog[TEMPLATE_VARIANT_TOMBSTONES_KEY] = records;
}

export function collectTemplateVariantTombstoneCatIds(catalog: RecordOf): Set<string> {
  const catIds = new Set<string>();
  for (const value of Object.values(readTombstoneRecords(catalog))) {
    if (!isRecord(value)) continue;
    if (typeof value.catId === 'string') catIds.add(value.catId);
  }
  return catIds;
}
