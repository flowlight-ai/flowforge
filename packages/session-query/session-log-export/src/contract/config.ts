/**
 * 用 zod 重建配置构型，并承担解包入口处的参数校验。
 *
 * 对应 dsh 用 schemastery 表达的 `Session-log archive policy`。这里改用本仓库
 * 既有的 zod 版本（workspace peer，^4.4.3），语义与 dsh 一致：`compressionLevel`
 * 必须是 0-9 的整数，缺省取平衡值 `DEFAULT_SESSION_LOG_COMPRESSION_LEVEL`（=6）。
 */

import { z } from 'zod'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  type SessionLogCompressionLevel,
} from '../pure/zip.ts'

/** `compressionLevel` 字段的 zod 校验器：0-9 整数，缺省 6。 */
export const compressionLevelSchema = z
  .number()
  .int()
  .min(0)
  .max(9)
  .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL)

/** Session-log ZIP 导出的部署策略。 */
export const SessionLogExportConfigSchema = z.object({
  compressionLevel: compressionLevelSchema,
})

/** 解析后的 Session-log 导出配置。 */
export type SessionLogExportConfig = z.infer<typeof SessionLogExportConfigSchema>

/** 校验并解析一份任意的配置输入，约束 `compressionLevel` 到合法区间。 */
export function parseSessionLogExportConfig(raw: unknown): SessionLogExportConfig {
  return SessionLogExportConfigSchema.parse(raw)
}

/** 解析并校验导出配置（对任意 `compressionLevel` 取值收敛到合法区间）。 */
export function resolveCompression(raw: unknown): SessionLogCompressionLevel {
  return asCompressionLevel(parseSessionLogExportConfig(raw).compressionLevel)
}

/** 把已校验的整数值收窄为接受的分级联合类型。 */
export function asCompressionLevel(value: number): SessionLogCompressionLevel {
  return value as SessionLogCompressionLevel
}