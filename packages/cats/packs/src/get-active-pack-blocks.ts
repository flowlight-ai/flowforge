/**
 * @flowforge/cats-packs — C30 getActivePackBlocks（F129 活动 Pack 编译）
 *
 * TS 移植：clowder-ai `domains/packs/getActivePackBlocks.ts`。
 * 调用方在路由（serial/parallel）构建静态身份前加载并编译活动 pack。
 *
 * Phase A：单 pack（第一个安装者优先）。多 pack 合并推迟到 Phase B。
 * 插件化：模块级 compiler 单例 → compiler 参数注入（缺省新建）。
 */

import type { CompiledPackBlocks } from '@flowforge/cats-shared';
import { PackCompiler } from './pack-compiler.js';
import type { PackStore } from './pack-store.js';

/**
 * Load first active pack, compile it, return blocks.
 * Returns null if no packs installed or compilation fails.
 */
export async function getActivePackBlocks(
  store: PackStore,
  compiler: PackCompiler = new PackCompiler(),
): Promise<CompiledPackBlocks | null> {
  try {
    const manifests = await store.list();
    if (manifests.length === 0) return null;

    // Phase A: use first installed pack
    const first = manifests[0];
    if (!first) return null;
    const pack = await store.get(first.name);
    if (!pack) return null;

    return await compiler.compile(pack);
  } catch {
    // Best-effort: pack compilation failure does not block invocation
    return null;
  }
}
