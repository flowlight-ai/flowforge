/**
 * Dotted-path resolution (`_resolve_path` in legacy `conditional_router.py`).
 *
 * Supports the forms the condition language uses:
 *   - `state.field`
 *   - `state.nested.field`
 *   - `state.list[0]`
 *   - `state.list[0].field`
 *
 * The Python source tolerated attribute access via `getattr`; since every
 * value here is plain JSON-shaped data, only property access is needed.
 */

/** Error raised when a path segment cannot be resolved. */
export class PathResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathResolutionError';
  }
}

type Segment = { readonly kind: 'name'; readonly value: string } | { readonly kind: 'index'; readonly value: number };

/**
 * Split a dotted path into object-key and array-index segments.
 * Mirrors the Python `re.split(r'\.', path)` + bracket scan.
 */
function parseSegments(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const part of path.split('.')) {
    if (part.length === 0) {
      throw new PathResolutionError(`Invalid empty segment in path: ${path}`);
    }
    // A part may be `name[0][1]` or bare `[0]`.
    const tokens = part.match(/[^[\]]+|\[\d+\]/g);
    if (tokens === null) {
      throw new PathResolutionError(`Invalid path segment: ${part}`);
    }
    for (const token of tokens) {
      if (token.startsWith('[')) {
        segments.push({ kind: 'index', value: Number.parseInt(token.slice(1, -1), 10) });
      } else {
        segments.push({ kind: 'name', value: token });
      }
    }
  }
  return segments;
}

/**
 * Resolve `path` against `context`, throwing {@link PathResolutionError} when
 * any segment is missing or the shape does not match.
 */
export function resolvePath(context: unknown, path: string): unknown {
  let current: unknown = context;
  for (const segment of parseSegments(path)) {
    if (segment.kind === 'name') {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        throw new PathResolutionError(
          `Cannot access '${segment.value}' on ${describe(current)}`,
        );
      }
      const record = current as Record<string, unknown>;
      if (!(segment.value in record)) {
        throw new PathResolutionError(`Missing key '${segment.value}' in path: ${path}`);
      }
      current = record[segment.value];
      continue;
    }
    if (!Array.isArray(current)) {
      throw new PathResolutionError(`Cannot index ${describe(current)} in path: ${path}`);
    }
    if (segment.value < 0 || segment.value >= current.length) {
      throw new PathResolutionError(`Index ${segment.value} out of range in path: ${path}`);
    }
    current = current[segment.value];
  }
  return current;
}

function describe(value: unknown): string {
  if (value === null) return 'none';
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

/** `exists` sugar: does `path` resolve at all? */
export function pathExists(context: unknown, path: string): boolean {
  try {
    resolvePath(context, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `not_empty` sugar: `path` resolves and holds a non-empty value.
 * `0` / `false` count as non-empty (Python checks length/None, not truthiness).
 */
export function pathNotEmpty(context: unknown, path: string): boolean {
  let value: unknown;
  try {
    value = resolvePath(context, path);
  } catch {
    return false;
  }
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0;
  if (value instanceof Set) return value.size > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}
