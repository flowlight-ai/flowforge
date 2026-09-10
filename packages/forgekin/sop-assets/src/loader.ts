import type { SopAsset } from './sop-asset-model.ts'
import { parseAndValidateSopAsset } from './validate-sop-asset.ts'

/**
 * Loader seam: `parse` turns a raw blob (string/object) into a SopAsset via
 * `parseAndValidateSopAsset`. This keeps the package free of a hard I/O or YAML
 * dependency — hosts supply their own parse function (e.g. a YAML frontmatter
 * reader) while this package owns the schema contract & validation.
 */
export interface SopAssetParse {
  parse(raw: unknown, source?: string): SopAsset
}

/** Default string parser targeting JSON payloads. */
export const jsonSopAssetParser: SopAssetParse = {
  parse(raw: unknown, _source?: string): SopAsset {
    const payload: unknown = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
    return parseAndValidateSopAsset(toObject(payload))
  },
}

export function loadSopAsset(raw: unknown, parser: SopAssetParse = jsonSopAssetParser, source?: string): SopAsset {
  return parser.parse(raw, source)
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Re-export for convenience at the loader site. */
export type { SopAsset } from './sop-asset-model.ts'