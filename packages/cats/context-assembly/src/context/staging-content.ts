/**
 * L0 staging protocol (self-contained port of clowder `StagingContent.ts`,
 * ADR-038). Loads `l0-staging-content.md` frontmatter manifest + body and renders
 * the staging block as a system-prompt prepend for each cat invocation.
 *
 * File access goes through the injected `FileSystemSeam`; cat config lookup goes
 * through the injected `CatContextPort`. Runtime port placeholders
 * (`{{FRONTEND_PORT}}` / `{{API_SERVER_PORT}}`) are injected via options.
 */

import type { FileSystemSeam } from '../ports/file-system.ts';
import type { CatContextPort } from '../ports/cat-context.ts';

export const STAGING_CONTENT_RELPATH = 'cat-cafe-skills/refs/l0-staging-content.md';

export const HARD_CAP_STAGING = 2000;

const EMPTY_MANIFEST: StagingManifest = {
  staging_version: 1,
  schema_doc: '',
  hard_cap_tokens: HARD_CAP_STAGING,
  soft_margin_tokens: 200,
  items: [],
};

interface FirstPrinciplesCheck {
  single_round_complete: boolean;
  compress_gap_harmful: boolean;
  referenced_by_l0: boolean;
  verdict: string;
}

export interface StagingItem {
  id: string;
  title: string;
  /** "shared" or a breed name. */
  family: string;
  source: string;
  added_at: string;
  estimated_tokens: number;
  first_principles_check: FirstPrinciplesCheck;
  trigger_rate_method?: string;
  trigger_rate_window?: string;
  trigger_rate_note?: string;
  cvo_signoff?: string;
}

export interface StagingManifest {
  staging_version: number;
  schema_doc: string;
  hard_cap_tokens: number;
  soft_margin_tokens: number;
  items: readonly StagingItem[];
}

interface ParsedStagingContent {
  manifest: StagingManifest;
  body: string;
}

export interface StagingRuntimePorts {
  frontendPort?: string;
  apiServerPort?: string;
}

function parseFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(
      '[L0 staging] frontmatter not found — l0-staging-content.md must begin with `---` frontmatter block',
    );
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

/** Minimal YAML parser for the manifest schema (no general YAML support). */
function parseManifest(yaml: string): StagingManifest {
  const lines = yaml.split('\n');
  const top: Record<string, unknown> = {};
  const items: StagingItem[] = [];
  let mode: 'top' | 'item' | 'check' = 'top';
  let currentItem: Partial<StagingItem> & { first_principles_check?: Partial<FirstPrinciplesCheck> } = {};
  let currentCheck: Partial<FirstPrinciplesCheck> = {};

  const flushItem = () => {
    if (currentItem.id) {
      if (Object.keys(currentCheck).length > 0) {
        currentItem.first_principles_check = currentCheck as FirstPrinciplesCheck;
      }
      items.push(currentItem as StagingItem);
    }
    currentItem = {};
    currentCheck = {};
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    if (mode === 'top' && /^[a-z_0-9]+:/.test(line)) {
      const m = line.match(/^([a-z_0-9]+):\s*(.*)$/);
      if (m) {
        const [, key, value] = m;
        if (key === 'items') {
          mode = 'item';
        } else if (key && value !== undefined) {
          const num = Number(value);
          top[key] = Number.isNaN(num) || value.trim() === '' ? value.trim() : num;
        }
      }
      continue;
    }
    if (line.startsWith('  - ')) {
      flushItem();
      mode = 'item';
      const m = line.match(/^\s*-\s*([a-z_0-9]+):\s*(.*)$/);
      if (m) {
        const [, key, value] = m;
        if (key === 'id' && value) currentItem.id = value.trim();
      }
      continue;
    }
    if (mode === 'item' && /^\s{4}[a-z_0-9]+:/.test(line) && !line.startsWith('      ')) {
      const m = line.match(/^\s{4}([a-z_0-9]+):\s*(.*)$/);
      if (m) {
        const [, key, value] = m;
        if (key === 'first_principles_check') {
          mode = 'check';
        } else if (key && value !== undefined) {
          const num = Number(value);
          const coerced = Number.isNaN(num) || value.trim() === '' ? value.trim() : num;
          (currentItem as Record<string, unknown>)[key] = coerced;
        }
      }
      continue;
    }
    if (mode === 'check' && line.startsWith('      ')) {
      const m = line.match(/^\s{6}([a-z_0-9]+):\s*(.*)$/);
      if (m) {
        const [, key, value] = m;
        if (key && value !== undefined) {
          const v = value.trim();
          if (v === 'true') (currentCheck as Record<string, unknown>)[key] = true;
          else if (v === 'false') (currentCheck as Record<string, unknown>)[key] = false;
          else (currentCheck as Record<string, unknown>)[key] = v;
        }
      }
      continue;
    }
    if (mode === 'check' && /^\s{4}[a-z_0-9]+:/.test(line)) {
      mode = 'item';
      const m = line.match(/^\s{4}([a-z_0-9]+):\s*(.*)$/);
      if (m) {
        const [, key, value] = m;
        if (key && value !== undefined) {
          (currentItem as Record<string, unknown>)[key] = value.trim();
        }
      }
    }
  }
  flushItem();

  return {
    staging_version: (top.staging_version as number) ?? 1,
    schema_doc: (top.schema_doc as string) ?? '',
    hard_cap_tokens: (top.hard_cap_tokens as number) ?? HARD_CAP_STAGING,
    soft_margin_tokens: (top.soft_margin_tokens as number) ?? 200,
    items,
  };
}

const _cacheByRoot = new Map<string, ParsedStagingContent>();

function loadStagingContent(
  fileSystem: FileSystemSeam,
): { manifest: StagingManifest; body: string } | null {
  const cacheKey = fileSystem.rootDir;
  const cached = _cacheByRoot.get(cacheKey);
  if (cached) return cached;
  const raw = fileSystem.readFileSync(STAGING_CONTENT_RELPATH);
  if (raw === null) {
    _cacheByRoot.set(cacheKey, { manifest: EMPTY_MANIFEST, body: '' });
    return { manifest: EMPTY_MANIFEST, body: '' };
  }
  const { frontmatter, body } = parseFrontmatter(raw);
  const parsed = { manifest: parseManifest(frontmatter), body };
  _cacheByRoot.set(cacheKey, parsed);
  return parsed;
}

/** Test-only: reset the cache so tests can re-load a mutated file. */
export function _resetStagingCache(): void {
  _cacheByRoot.clear();
}

function renderRuntimePlaceholders(body: string, ports: StagingRuntimePorts): string {
  return body
    .replaceAll('{{FRONTEND_PORT}}', ports.frontendPort ?? '3003')
    .replaceAll('{{API_SERVER_PORT}}', ports.apiServerPort ?? '3004');
}

/**
 * Returns staging content prepend text for `catId`, or empty string if no
 * applicable shared staging items exist.
 */
export function buildStagingPrepend(
  catId: string,
  deps: { fileSystem: FileSystemSeam; catContext: Pick<CatContextPort, 'getConfig'>; ports?: StagingRuntimePorts },
): string {
  const config = deps.catContext.getConfig(catId);
  if (!config) return '';
  const loaded = loadStagingContent(deps.fileSystem);
  if (!loaded) return '';
  const { manifest, body } = loaded;
  const sharedItems = manifest.items.filter((item) => item.family === 'shared');
  if (sharedItems.length === 0) return '';
  const header = `> L0 Staging Layer (ADR-038, ${sharedItems.length} shared items, ~${sharedItems.reduce(
    (sum, it) => sum + it.estimated_tokens,
    0,
  )} tokens — outside L0 ${manifest.hard_cap_tokens}-cap)`;
  return `${header}\n\n${renderRuntimePlaceholders(body, deps.ports ?? {}).trim()}`;
}

/** Returns the parsed manifest for guard tests / token budget invariants. */
export function loadStagingManifest(fileSystem: FileSystemSeam): StagingManifest {
  return loadStagingContent(fileSystem)?.manifest ?? EMPTY_MANIFEST;
}

/** Shared source text for consumers needing staging semantics without a header. */
export function loadStagingBody(fileSystem: FileSystemSeam, ports?: StagingRuntimePorts): string {
  return renderRuntimePlaceholders(loadStagingContent(fileSystem)?.body ?? '', ports ?? {});
}