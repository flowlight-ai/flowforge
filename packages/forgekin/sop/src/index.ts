/**
 * @flowforge/forgekin-sop — 阶段7 T7.24 SOP 标准作业程序域 Cordis 插件
 *
 * 挂载 `ctx.forgeSop`：SOP 阶段门禁引擎（SOPDefinition 加载/注册 +
 * PredicateChecker 8 检查器 + SOPExecutor 门禁/推进），对齐 Python
 * `sop/*.py`（models / engine / predicate），管控多智能体自开发方法论
 * 的阶段流转；阶段内任务执行交由 loops 域 LoopExecutor。
 */
import { Context, Service } from '@flowforge/cordis';
import { loadSopFromYaml, loadSopsFromDir, SOPExecutor, SOPProgress } from './engine.js';
import {
  PredicateConfig,
  PredicateContext,
  PredicateResult,
  PredicateType,
  SOPDefinition,
  SOPExecutionResult,
  SOPStageResult,
} from './models.js';
import { PredicateChecker, PredicateCheckerFn, PredicateCheckerOptions } from './predicate.js';

export * from './engine.js';
export * from './models.js';
export * from './predicate.js';

export interface SopServiceOptions {
  /** 预置 SOP 定义（key 为 sop id） */
  readonly sops?: ReadonlyMap<string, SOPDefinition> | undefined;
  /** 谓词检查器依赖注入（测试用：runCommand / env / cwd） */
  readonly checkerOptions?: PredicateCheckerOptions | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** SOP 域：标准作业程序阶段门禁引擎 */
    forgeSop: SopService;
  }
}

export class SopService extends Service {
  readonly checker: PredicateChecker;
  readonly sops = new Map<string, SOPDefinition>();
  readonly executors = new Map<string, SOPExecutor>();

  constructor(ctx: Context, options: SopServiceOptions = {}) {
    super(ctx, 'forgeSop');
    this.checker = new PredicateChecker(options.checkerOptions ?? {});
    for (const [id, sop] of options.sops ?? new Map()) {
      this.sops.set(id, sop);
    }
  }

  /** 已注册的 SOP id 列表 */
  ids(): string[] {
    return [...this.sops.keys()];
  }

  has(id: string): boolean {
    return this.sops.has(id);
  }

  /** 取 SOP 定义（未注册抛错） */
  get(id: string): SOPDefinition {
    const sop = this.sops.get(id);
    if (!sop) {
      throw new Error(`SOP not registered: ${id}`);
    }
    return sop;
  }

  /** 注册一个 SOP 定义（同 id 覆盖） */
  register(sop: SOPDefinition): void {
    this.sops.set(sop.id, sop);
    this.executors.delete(sop.id);
  }

  /** 从 YAML 文件加载并注册 SOP（对齐 load_sop_from_yaml） */
  async loadFile(yamlPath: string): Promise<SOPDefinition> {
    const sop = await loadSopFromYaml(yamlPath);
    this.register(sop);
    return sop;
  }

  /** 从目录批量加载并注册 SOP，返回成功加载的 id（对齐 load_sops_from_dir） */
  async loadDir(sopsDir: string): Promise<string[]> {
    const loaded = await loadSopsFromDir(sopsDir);
    const ids: string[] = [];
    for (const [id, sop] of loaded) {
      this.register(sop);
      ids.push(id);
    }
    return ids;
  }

  /** 取某 SOP 的执行器（惰性创建，同实例复用） */
  executor(id: string): SOPExecutor {
    let exec = this.executors.get(id);
    if (!exec) {
      exec = new SOPExecutor(this.get(id), this.checker);
      this.executors.set(id, exec);
    }
    return exec;
  }

  /** 执行完整 SOP（便捷方法：executor(id).executeSop） */
  executeSop(
    id: string,
    featureId: string,
    context?: PredicateContext,
  ): Promise<SOPExecutionResult> {
    return this.executor(id).executeSop(featureId, context);
  }

  /** 执行单个阶段门禁（便捷方法：executor(id).executeStage） */
  executeStage(
    id: string,
    stageId: string,
    context?: PredicateContext,
  ): Promise<SOPStageResult> {
    return this.executor(id).executeStage(stageId, context);
  }

  /** 取某 SOP 的执行进度 */
  progress(id: string): SOPProgress {
    return this.executor(id).getProgress();
  }

  /** 注册/覆盖自定义谓词检查器（扩展新 type） */
  registerChecker(predicateType: PredicateType | string, checkerFn: PredicateCheckerFn): void {
    this.checker.register(predicateType, checkerFn);
  }

  /** 直接执行一次谓词检查（无需 SOP 上下文） */
  check(config: PredicateConfig, context?: PredicateContext): Promise<PredicateResult> {
    return this.checker.check(config, context);
  }

  /** 快照（trace 日志）：sops / 阶段数 / 规则数 */
  snapshot(): {
    count: number;
    sops: { id: string; domain: string; stages: number; hardRules: number; pitfalls: number }[];
  } {
    const sops = [...this.sops.values()].map((sop) => ({
      id: sop.id,
      domain: sop.domain,
      stages: sop.stages.length,
      hardRules: sop.stages.reduce((n, s) => n + s.hardRules.length, 0),
      pitfalls: sop.stages.reduce((n, s) => n + s.pitfalls.length, 0),
    }));
    return { count: sops.length, sops };
  }
}

export default function Plugin(ctx: Context, options?: SopServiceOptions) {
  return ctx.plugin(SopService, options);
}
