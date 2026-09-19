/**
 * Canonical static avatar catalog (B21 assets; ported surface from clowder-ai
 * `packages/web/public/avatars/*.png`).
 *
 * flowforge bundles avatar front-end assets as plugin packaging (R13 一切皆插件)
 * rather than committing multi-megabyte PNGs into the contract layer. This module
 * defines the *surface* — the canonical set of persona avatar names the host may
 * serve from `frontend-static` or its own assets directory. `GET /api/avatars`
 * (see `AvatarsController`) exposes this manifest so any client can discover the
 * bundled static avatars without hard-coded names.
 */

/** Canonical static persona-avatar asset names (basename minus extension). */
export const STATIC_AVATAR_NAMES: readonly string[] = [
  'antig-opus',
  'antigravity',
  'claude-fable-5',
  'codex-kawaii',
  'codex',
  'codex_box',
  'codex_iquid',
  'default',
  'gemini-kawaii',
  'gemini',
  'gemini25',
  'glm52',
  'gpt-pro',
  'gpt52',
  'keeper',
  'kimi',
  'opencode',
  'opus-45',
  'opus-47',
  'opus-kawaii',
  'opus',
  'sonnet',
];

/** Names that resolve to byte-cheap assets bundled by default (acceptable to inline). */
export const MINIMAL_AVATAR_NAMES: readonly string[] = ['default'];

/** Reject path-traversal / unsafe segments before resolving a static asset name. */
export function isSafeAvatarName(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return false;
  if (name.includes('..')) return false;
  return true;
}

/** Resolve a safe static avatar asset path (`.png`), or null when unsafe. */
export function staticAvatarAssetPath(name: string): string | null {
  if (!isSafeAvatarName(name)) return null;
  return `/avatar-assets/${name}.png`;
}

/** The canonical `.png` basenames discoverable via `/api/avatars`. */
export function staticAvatarAssetNames(): readonly string[] {
  return STATIC_AVATAR_NAMES;
}