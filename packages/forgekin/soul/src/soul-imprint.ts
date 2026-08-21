/**
 * @flowforge/forgekin-soul — 阶段7 T7.1 SoulImprint 灵魂印记（不可变身份标识）
 *
 * 本地化自 flowforge Python `forgemind/soul_imprint.py`：
 * - 不可变性：imprint_hash / seed_params / value_anchors / namespace 一经创建不可修改
 *   （TS readonly + Object.freeze 双保险），是谱系追踪的前提
 * - 哈希稳定性：imprint_hash = SHA-256(stable_json(seed_params + value_anchors + namespace))，
 *   相同输入产出相同哈希（stable JSON：键排序 + 紧凑分隔符，对齐 Python ensure_ascii=False）
 * - 命名空间隔离：通过 namespace 区分不同应用层（contentforge / forgemind / novelforge）
 *
 * @module @flowforge/forgekin-soul/soul-imprint
 */

import { createHash } from 'node:crypto';

/** 生成键排序后、无空格的稳定 JSON 字符串，用于哈希（对齐 _stable_json） */
export function stableJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
}

/** 计算 SoulImprint 哈希（SHA-256，64 字符十六进制） */
export function computeSoulHash(
  seedParams: Readonly<Record<string, unknown>>,
  valueAnchors: readonly string[],
  namespace: string,
): string {
  const payload = {
    seed_params: { ...seedParams },
    value_anchors: [...valueAnchors],
    namespace,
  };
  return createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
}

/** SoulImprint（Soul Imprint）— Forgekin 的不可变身份标识 */
export interface SoulImprint {
  /** 基于 seed_params + value_anchors + namespace 计算的 SHA-256 哈希 */
  readonly imprintHash: string;
  /** 初始锻造时的种子参数（如 species / name / operator 等） */
  readonly seedParams: Readonly<Record<string, unknown>>;
  /** 价值锚点（不可变，对齐 VISION §7 + 15 条红线） */
  readonly valueAnchors: readonly string[];
  /** 命名空间（如 'contentforge' / 'forgemind' / 'novelforge'） */
  readonly namespace: string;
  /** 创建时间（UTC ISO 8601） */
  readonly createdAt: string;
}

/** 校验 namespace 非空 + value_anchors 无重复（对齐 pydantic field_validator） */
export function validateSoulImprintInput(namespace: string, valueAnchors: readonly string[]): void {
  if (!namespace || !namespace.trim()) {
    throw new Error('namespace 不能为空——SoulImprint 必须归属于某个命名空间');
  }
  if (valueAnchors.length === 0) {
    throw new Error('value_anchors 不能为空——SoulImprint 必须至少携带一个价值锚点');
  }
  if (new Set(valueAnchors).size !== valueAnchors.length) {
    throw new Error('value_anchors 不能包含重复项。');
  }
}

/** 锻造一个新的不可变 SoulImprint（推荐入口；自动计算哈希并冻结） */
export function forgeSoulImprint(
  seedParams: Readonly<Record<string, unknown>>,
  valueAnchors: readonly string[],
  namespace: string,
): SoulImprint {
  validateSoulImprintInput(namespace, valueAnchors);
  const imprintHash = computeSoulHash(seedParams, valueAnchors, namespace);
  return Object.freeze({
    imprintHash,
    seedParams: Object.freeze({ ...seedParams }),
    valueAnchors: Object.freeze([...valueAnchors]),
    namespace: namespace.trim(),
    createdAt: new Date().toISOString(),
  });
}

/** 校验当前 SoulImprint 的 imprintHash 是否与三要素重算结果一致（跨 session / 跨代际身份验证） */
export function verifySoulImprint(imprint: SoulImprint): boolean {
  return imprint.imprintHash === computeSoulHash(imprint.seedParams, imprint.valueAnchors, imprint.namespace);
}
