/**
 * Game identity headers (S5-4 宿主接线：身份 header 注入共享端口)。
 *
 * S5-3 的两个游戏控制器都从请求头解析调用方身份（`x-cat-id` + 用户身份
 * `x-cat-cafe-user` / `x-user-id`），语义重复且各自硬编码。本模块把"读出"和
 * "注入"收拢成唯一纯函数端口：
 *
 * - {@link readGameIdentity}：从请求头解析 {@link GameIdentity}（MCP transport
 *   已注入的前提下）。catId / userId 必须二选一存在，否则返回 null（调用方返回 401）。
 * - {@link injectGameIdentity}：把 {@link GameIdentity} 写回 header 记录，供真实
 *   MCP streamable-http transport（`mcp-client` 的 `config.headers`）注入出站请求，
 *   使 `game-action` 回调路由能通过身份校验（见 game-action.ts completion criteria）。
 *
 * 纯函数、可离线单测；不在本模块内 import 任何传输层。
 * @module @flowforge/api-rest-controllers/host/game-identity
 */

/** 权威游戏身份 header 键名（唯一名，避免拼写漂移）。 */
export const GAME_IDENTITY_HEADERS = ['x-cat-id', 'x-cat-cafe-user', 'x-user-id'] as const

/** 一个解析出的调用方身份（cat 或人，至少一个）。 */
export interface GameIdentity {
  /** 发起动作的 cat（MCP 回调必带：identity 门控键）。 */
  catId: string
  /** 发起动作的用户（游戏/座次归属校验用）。 */
  userId: string
}

/**
 * 从请求头解析调用方身份。catId 优先取 `x-cat-id`；userId 允许
 * `x-cat-cafe-user` / `x-user-id` 任一（前者优先）。
 * @param headers - 请求头（键名视为小写；{{@link HeaderBag}} 弱类型）。
 * @returns 解析出的身份；catId 或 userId 缺失返回 null。
 */
export function readGameIdentity(headers: HeaderBag): GameIdentity | null {
  const catId = getHeader(headers, 'x-cat-id')
  if (!catId) return null
  const userId = readUserId(headers)
  if (!userId) return null
  return { catId, userId }
}

/**
 * 仅解析调用方用户（高层 REST 路由：`x-cat-cafe-user` / `x-user-id`）。
 * 不含 `x-cat-id` 门控——游戏 start/view 走的是非 MCP 的高层入口，历史上只要求
 * 用户身份；低层 MCP 回调（{@link readGameIdentity}）才要求 catId。
 * @param headers - 请求头。
 * @returns 用户 id；缺失返回 undefined。
 */
export function readUserId(headers: HeaderBag): string | undefined {
  return getHeader(headers, 'x-cat-cafe-user') ?? getHeader(headers, 'x-user-id')
}

/**
 * 把 {@link GameIdentity} 注入 header 记录（真实 MCP streamable-http transport
 * 出站请求的身份注入面）。不会改动传入对象；缺失的身份键不写入。
 * @param base - 既有 header 记录（可能为 undefined/只读，返回时复制）。
 * @param identity - 待注入的身份。
 * @returns 新的 header 记录（已合并身份）。
 */
export function injectGameIdentity(base: HeaderBag | undefined, identity: GameIdentity): Record<string, string> {
  const out: Record<string, string> = {}
  if (base) {
    for (const [key, value] of Object.entries(base)) {
      if (typeof value === 'string') out[key] = value
    }
  }
  if (identity.catId) out['x-cat-id'] = identity.catId
  if (identity.userId) out['x-cat-cafe-user'] = identity.userId
  return out
}

/** 请求/配置 header 的弱类型（键名不区分大小写）。 */
export type HeaderBag = { readonly [key: string]: string | string[] | undefined }

function getHeader(headers: HeaderBag, key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()]
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
}