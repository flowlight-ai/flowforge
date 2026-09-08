/**
 * 飞书妙记/云文档引用提取（本地自包含实现）。
 *
 * clowder-ai 原实现依赖外部发布包 `@clowder-ai/feishu-meeting-intake`
 * 的 `parseFeishuMinutesReference`；为消除该运行时依赖，本包在
 * `extract/minutes-reference.ts` 本地实现等价语义：从飞书妙记/文档
 * URL 或 token 提取规范 locator（kind / artifactId / revision?）。
 *
 * 语义约定（与 `LarkCliFeishuSourceResolver` 的 canonical 句柄一致）：
 * - `kind`：`minute`（妙记）或 `note`（云文档/妙记子代）；
 * - `artifactId`：妙记 token（如 `obcn...`）或文档 token（如 `doxcn...`）；
 * - `revision?`：可选的版本标识，缺省由调用方回退为 `latest`。
 *
 * @flowforge/cats-signal-intake — extract/minutes-reference
 */

export interface FeishuMinutesReference {
  readonly kind: 'minute' | 'note'
  readonly artifactId: string
  readonly revision?: string
}

const MINUTE_TOKEN = /^(ob[cnst][a-zA-Z0-9_-]{6,120})$/u
const NOTE_TOKEN = /^(dox?c?n?x?[a-zA-Z0-9_-]{6,120})$/u
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/u
const SAFE_REVISION = /^[A-Za-z0-9._-]{1,64}$/u

function isMinuteToken(value: string): boolean {
  return MINUTE_TOKEN.test(value)
}

function isNoteToken(value: string): boolean {
  return NOTE_TOKEN.test(value)
}

function parseMinutePath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean)
  // 常见形态：/minutes/{token} 或 /minutes/recordings/.../{token}
  const index = segments.indexOf('minutes')
  if (index < 0) return undefined
  const candidate = segments[index + 1]
  if (candidate && isMinuteToken(candidate)) return candidate
  // 回退：取最后一个妙记形态段
  return [...segments].reverse().find((segment) => isMinuteToken(segment))
}

function parseDocPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean)
  return segments.find((segment) => isNoteToken(segment))
}

/**
 * Parse a human Feishu Minutes/Doc URL or bare token onto the canonical
 * `{ kind, artifactId, revision? }` locator.
 * @throws TypeError when the reference cannot be recognized.
 */
export function parseFeishuMinutesReference(reference: string): FeishuMinutesReference {
  const value = reference.trim()
  if (isMinuteToken(value)) return { kind: 'minute', artifactId: value }
  if (isNoteToken(value)) return { kind: 'note', artifactId: value }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Feishu minutes reference is not a canonical token or URL')
  }
  const host = url.hostname.toLowerCase()
  const pathname = url.pathname
  const token = url.searchParams.get('token') ?? undefined

  const markerMatchesMinute = /minute|meeting|recording/i.test(host + pathname)
  if (markerMatchesMinute) {
    const artifactId = parseMinutePath(pathname) ?? (token && isMinuteToken(token) ? token : undefined)
    if (artifactId) {
      const revision = url.searchParams.get('revision') ?? url.searchParams.get('v')
      return {
        kind: 'minute',
        artifactId,
        ...(revision && revision.length > 0 ? { revision } : {}),
      }
    }
  }
  const docId = parseDocPath(pathname) ?? (token && isNoteToken(token) ? token : undefined)
  if (docId) {
    const revision = url.searchParams.get('revision')
    return {
      kind: 'note',
      artifactId: docId,
      ...(revision && revision.length > 0 ? { revision } : {}),
    }
  }
  throw new TypeError('Feishu minutes reference is not a recognizable minutes/doc URL or token')
}

/**
 * Strict validation helpers shared with LarkCliFeishuSourceResolver's canonical handle.
 * Kept here so both the URL/token recovery path and the canonical parser agree on
 * the same bounded identifier rules.
 */
export function isValidFeishuArtifactId(value: string): boolean {
  return SAFE_ID.test(value)
}

export function isValidFeishuRevision(value: string): boolean {
  return SAFE_REVISION.test(value)
}