/**
 * HMAC-SHA256 ID 伪名化（外部遥测用，同输入→同哈希，跨信号关联不泄原 ID）。
 *
 * TS 移植自 clowder-ai `infrastructure/telemetry/hmac.ts`（批次30 批次内联于
 * index.ts，批次51 拆分为独立模块供 redactor 等纯逻辑层引用）。
 *
 * 插件化改造：TELEMETRY_HMAC_SALT → FF_TELEMETRY_HMAC_SALT（R17）。
 */

import { createHmac } from 'node:crypto';

const TENANT_SALT = process.env.FF_TELEMETRY_HMAC_SALT;

function getSalt(): string {
  if (TENANT_SALT) return TENANT_SALT;
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'test') {
    return 'dev-only-insecure-salt';
  }
  throw new Error(
    'FF_TELEMETRY_HMAC_SALT is required in non-dev environments. Set it in .env or your secret manager.',
  );
}

/** 校验 salt 可用（非 dev 环境缺 salt 抛错，调用方捕获并禁用遥测）。 */
export function validateSalt(): void {
  getSalt();
}

/** HMAC-SHA256 伪名化标识符（前 32 hex 字符，128-bit 碰撞安全）。 */
export function hmacId(id: string): string {
  return createHmac('sha256', getSalt()).update(id).digest('hex').slice(0, 32);
}

/** Env 闸门：导出原 ID（自托管受控环境）。 */
export function shouldExportRawIds(): boolean {
  return process.env.FF_TELEMETRY_EXPORT_RAW_IDS === '1';
}

/** 伪名化系统标识符（escape hatch 开启时返回原 ID）。 */
export function pseudonymizeId(id: string): string {
  return shouldExportRawIds() ? id : hmacId(id);
}
