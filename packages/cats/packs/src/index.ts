/**
 * @flowforge/cats-packs — C30 packs 域（F129）Cordis 插件
 *
 * TS 移植：clowder-ai `domains/packs`（C30 域），类型/schema 复用
 * `@flowforge/cats-shared` 既有 pack 契约（cats-shared F129 五段式）：
 *   - PackStore：baseDir 构造注入的本地 pack 存储（install/remove/list/get/has）
 *   - PackSecurityGuard：9 步 fail-closed 校验（AC-A7 注入扫描 11 模式 /
 *     AC-A8 schema 严格 / AC-A9 capabilities 拒绝 / KD-3 身份字段 12 个不可变 /
 *     KD-9 约束方向 5 模式）
 *   - PackCompiler：schema → 规范提示块（AC-A3 规范编译；AC-A6 双轨信任边界：
 *     guardrails 硬约束 / defaults 可覆盖），中文提示块输出
 *   - PackLoader：Phase A 仅本地路径（git URL 拒绝），security + growth 边界
 *     流水线编排，PackSecurityError / GrowthBoundaryError 异常
 *   - GrowthBoundary：KD-11 递归扫描（7 目录名 / 4 扩展 / 凭证 stem，6 个
 *     pack 安全父目录豁免）
 *   - PackExporter：cat-config + shared-rules + skills manifest → Pack 目录
 *     （masks / guardrails block+warn / defaults / workflows）
 *   - PackKnowledgeScope：AC-A10 pack 知识隔离，`IEvidenceStore` 剥离为
 *     PackKnowledgeStore 端口（宿主注入）
 *   - getActivePackBlocks：活动 pack 编译（compiler 注入，缺省新建）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsPacks from '@flowforge/cats-packs'
 * ctx.plugin(CatsPacks, { packsDir: '<baseDir>' })
 * // ctx.catsPacks.createStore(packsDir) / .createLoader(store, guard) /
 * //   .createCompiler() / .createExporter() / .createKnowledgeScope(store) /
 * //   .getActivePackBlocks(store)
 * ```
 *
 * @module @flowforge/cats-packs
 */

import { Context, Service } from '@flowforge/cordis';

import { getActivePackBlocks } from './get-active-pack-blocks.js';
import type { PackKnowledgeStore } from './pack-knowledge-scope.js';
import { PackKnowledgeScope } from './pack-knowledge-scope.js';
import { PackCompiler } from './pack-compiler.js';
import { PackExporter } from './pack-exporter.js';
import { PackLoader } from './pack-loader.js';
import { PackSecurityGuard } from './pack-security-guard.js';
import { PackStore } from './pack-store.js';

export { getActivePackBlocks };
export type { CompiledPackBlocks, PackOnDisk } from '@flowforge/cats-shared';
export { PackKnowledgeScope };
export type { PackKnowledgeItem, PackKnowledgeStore } from './pack-knowledge-scope.js';
export { PackCompiler } from './pack-compiler.js';
export { PackExporter } from './pack-exporter.js';
export type { ExportConfig, ExportResult } from './pack-exporter.js';
export { GrowthBoundaryError, PackLoader, PackSecurityError } from './pack-loader.js';
export { PackSecurityGuard } from './pack-security-guard.js';
export type { SecurityResult } from './pack-security-guard.js';
export { PackStore } from './pack-store.js';
export { checkGrowthBoundary } from './growth-boundary.js';
export type { GrowthCheckResult } from './growth-boundary.js';

/** CatsPacks 服务构造选项（baseDir 外置为构造参数） */
export interface CatsPacksServiceOptions {
  /** 时间函数注入（知识条目 updatedAt 缺省 Date.now） */
  readonly now?: (() => Date) | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** packs 域（F129）：store / guard / compiler / loader / exporter / knowledge-scope 工厂 */
    catsPacks: CatsPacksService;
  }
}

/**
 * packs 域服务（F129）：组装 PackStore / PackSecurityGuard / PackCompiler /
 * PackLoader / PackExporter / PackKnowledgeScope 工厂。
 *
 * 挂载 `ctx.catsPacks`，提供：
 *   - createStore(baseDir)：本地 pack 存储
 *   - createGuard()：9 步安全校验守卫
 *   - createCompiler()：schema → 规范提示块编译器
 *   - createLoader(store, guard?)：安装编排（缺省 guard 新建）
 *   - createExporter()：cat-config → pack 目录导出
 *   - createKnowledgeScope(store)：pack 知识隔离（宿主注入 PackKnowledgeStore）
 *   - getActivePackBlocks(store, compiler?)：活动 pack 编译（best-effort）
 */
export class CatsPacksService extends Service {
  /** 时间函数（知识条目 updatedAt 缺省 now） */
  readonly now: () => Date;

  constructor(ctx: Context, options: CatsPacksServiceOptions = {}) {
    super(ctx, 'catsPacks');
    this.now = options.now ?? (() => new Date());
  }

  /** 创建本地 pack 存储（baseDir 宿主注入） */
  createStore(baseDir: string): PackStore {
    return new PackStore(baseDir);
  }

  /** 创建 9 步安全校验守卫 */
  createGuard(): PackSecurityGuard {
    return new PackSecurityGuard();
  }

  /** 创建 schema → 规范提示块编译器 */
  createCompiler(): PackCompiler {
    return new PackCompiler();
  }

  /** 创建安装编排（guard 缺省新建） */
  createLoader(store: PackStore, guard: PackSecurityGuard = new PackSecurityGuard()): PackLoader {
    return new PackLoader(store, guard);
  }

  /** 创建 cat-config → pack 目录导出器 */
  createExporter(): PackExporter {
    return new PackExporter();
  }

  /** 创建 pack 知识隔离（PackKnowledgeStore 宿主注入） */
  createKnowledgeScope(knowledgeStore: PackKnowledgeStore): PackKnowledgeScope {
    return new PackKnowledgeScope(knowledgeStore);
  }

  /** 加载并编译活动 pack（best-effort；失败返回 null 不阻塞调用） */
  getActivePackBlocks(store: PackStore, compiler?: PackCompiler): ReturnType<typeof getActivePackBlocks> {
    return getActivePackBlocks(store, compiler);
  }
}

export default CatsPacksService;
