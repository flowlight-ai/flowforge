/**
 * @flowforge/forgekin-lineage — 阶段7 F37 ForgeMind 进化谱系域 Cordis 插件
 *
 * 挂载 `ctx.forgeLineage`：Forgekin 进化谱系（F038）——LineageRelation
 * 关系类型 + LineageNode/LineageEdge 数据模型 + LineageStore 双向遍历 +
 * LineageSplitExecutor/LineageFuseExecutor 分裂/融合协议（保留血缘、
 * 新 SoulImprint、operator 审批）。
 *
 * TS 移植自 `docs/features/F038-forgemind-lineage.md`
 * （Python 侧无对应实现文件，按 Feature 文档直接建模）。
 * 一切皆插件：存储后端可注入替换（默认内存实现），分裂/融合规则
 * 全部外置 YAML（config/forgekin-lineage.yaml）。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  LineageFuseExecutor,
  LineageSplitExecutor,
  type LineageExecutorsConfig,
} from './executors.js';
import type { LineageStore } from './store.js';
import { InMemoryLineageStore } from './store.js';

export * from './config.js';
export * from './models.js';
export * from './store.js';
export * from './executors.js';

export interface LineageServiceOptions {
  /** 预创建的谱系存储（缺省内存实现；持久化 backend 可注入替换） */
  readonly store?: LineageStore | undefined;
  /** 分裂/融合规则配置（缺省从内置 forgekin-lineage.yaml 的 split/fuse 段解析） */
  readonly executorsConfig?: Partial<LineageExecutorsConfig> | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 进化谱系域：谱系树建模 + 分裂/融合协议 + 双向遍历 */
    forgeLineage: LineageService;
  }
}

export class LineageService extends Service {
  /** 谱系存储（节点/边写入 + 双向遍历） */
  readonly store: LineageStore;
  /** 分裂执行器（一父多子，保留父血缘） */
  readonly splitExecutor: LineageSplitExecutor;
  /** 融合执行器（多父一子，保留多父血缘） */
  readonly fuseExecutor: LineageFuseExecutor;

  constructor(ctx: Context, options: LineageServiceOptions = {}) {
    super(ctx, 'forgeLineage');
    this.store = options.store ?? new InMemoryLineageStore();
    const config: LineageExecutorsConfig = {
      splitRequireApproval: true,
      maxChildrenPerSplit: 5,
      copyCapabilityFromParent: true,
      fuseRequireApproval: true,
      maxParentsPerFuse: 3,
      mergeStrategy: 'weighted_by_performance',
      ...(options.executorsConfig ?? {}),
    };
    this.splitExecutor = new LineageSplitExecutor(this.store, config);
    this.fuseExecutor = new LineageFuseExecutor(this.store, config);
  }

  // ── 谱系写入 ─────────────────────────────────────────────────────

  /** 入谱（锻造/分裂/融合产出的 Forgekin 节点） */
  addNode(node: Parameters<LineageStore['addNode']>[0]): void {
    this.store.addNode(node);
  }

  /** 写谱系边（分裂/融合/克隆/交易/迁移记录） */
  addEdge(edge: Parameters<LineageStore['addEdge']>[0]): void {
    this.store.addEdge(edge);
  }

  // ── 谱系查询 ─────────────────────────────────────────────────────

  /** 按 soul_imprint 查询节点（唯一锚点，不存在抛错） */
  getNode(soulImprint: string) {
    return this.store.getNode(soulImprint);
  }

  /** 按 forgekin_id 反查节点（不存在返回 undefined） */
  findNodeByForgekinId(forgekinId: string) {
    return this.store.findNodeByForgekinId(forgekinId);
  }

  /** 向上查祖先（审计与能力溯源） */
  getAncestry(soulImprint: string, depth: number) {
    return this.store.getAncestry(soulImprint, depth);
  }

  /** 向下查后代 */
  getDescendants(soulImprint: string, depth: number) {
    return this.store.getDescendants(soulImprint, depth);
  }

  /** 全部谱系边（审计：log_all_edges） */
  listEdges() {
    return this.store.listEdges();
  }

  // ── 分裂/融合（F038 核心协议）───────────────────────────────────

  /** 分裂：一父多子（保留父血缘，能力复制 + manifest 调整） */
  split(parentForgekinId: string, manifest: Parameters<LineageSplitExecutor['split']>[1]): Promise<string[]> {
    return this.splitExecutor.split(parentForgekinId, manifest);
  }

  /** 融合：多父一子（保留多父血缘，能力按权重加权合并） */
  fuse(parentForgekinIds: string[], manifest: Parameters<LineageFuseExecutor['fuse']>[1]): Promise<string> {
    return this.fuseExecutor.fuse(parentForgekinIds, manifest);
  }
}

export default function Plugin(ctx: Context, options?: LineageServiceOptions) {
  return ctx.plugin(LineageService, options);
}
