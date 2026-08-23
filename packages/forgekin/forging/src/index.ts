/**
 * @flowforge/forgekin-forging — 阶段7 T7.25 Forge Nurturing 锻造流水线域 Cordis 插件
 *
 * 挂载 `ctx.forgeForging`：ForgePipeline 6 阶段锻造（FM-006）+ forge_from_yaml
 * 配置驱动入口。对齐 Python `forgemind/forging/{stages,pipeline}.py` +
 * `config/{forging,prompts}.yaml`。
 *
 * 一切皆插件：形态实例化经 SpeciesFactoryRegistry 静态注册分发（替代
 * Python importlib 动态导入）；配置/提示词/形态工厂谱系全部外置 YAML。
 */
import { Context, Service } from '@flowforge/cordis';
import type { ForgekinBase, ForgekinFormData, ForgekinLLMClient, SpeciesFactoryRegistry } from '@flowforge/forgekin-species';
import { ForgePipeline, type ForgeContextExtra } from './pipeline.js';
import { ForgingStage } from './forging-stages.js';

export * from './config.js';
export * from './forging-stages.js';
export * from './pipeline.js';

export interface ForgingServiceOptions {
  /** Forge Nurturing 配置字典（缺省从内置 `config/forging.yaml` 加载） */
  readonly forgingConfig?: Readonly<Record<string, unknown>> | undefined;
  /** 提示词配置字典（缺省从内置 `config/prompts.yaml` 加载，铁律5+P16） */
  readonly promptsConfig?: Readonly<Record<string, unknown>> | undefined;
  /** 形态构造器工厂注册表（缺省内置五形态；插件可先注册自定义形态再注入） */
  readonly factory?: SpeciesFactoryRegistry | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Forge Nurturing 锻造流水线域：6 阶段锻造 + YAML 配置驱动入口 */
    forgeForging: ForgingService;
  }
}

export class ForgingService extends Service {
  readonly pipeline: ForgePipeline;

  constructor(ctx: Context, options: ForgingServiceOptions = {}) {
    super(ctx, 'forgeForging');
    this.pipeline = new ForgePipeline(options);
  }

  // ── 锻造门面 ────────────────────────────────────────────────────

  /** 执行完整 6 阶段锻造，产出 Forgekin 实例 */
  forge(form: ForgekinFormData, contextExtra?: ForgeContextExtra): Promise<ForgekinBase> {
    return this.pipeline.forge(form, contextExtra);
  }

  /** 从 YAML 配置文件锻造（operator 编写配置定义 Forgekin 的核心入口） */
  forgeFromYaml(
    yamlPath: string,
    options: { llmClient?: ForgekinLLMClient | undefined } = {},
  ): Promise<ForgekinBase> {
    return this.pipeline.forgeFromYaml(yamlPath, options);
  }

  // ── 配置门面 ────────────────────────────────────────────────────

  /** 返回指定阶段的配置字典（required / timeout_seconds / retry 等） */
  getStageConfig(stage: ForgingStage): Record<string, unknown> {
    return this.pipeline.getStageConfig(stage);
  }

  /** 返回指定阶段的提示词模板（缺失抛错，铁律5+P16） */
  getPrompt(stage: ForgingStage): string {
    return this.pipeline.getPrompt(stage);
  }

  /** 快照（trace 日志）：流水线配置摘要 + 最近一次锻造阶段结果 */
  snapshot(): {
    stages: number;
    lastStageResults: number;
    lastAllPassed: boolean;
  } {
    const results = this.pipeline.lastStageResults;
    return {
      stages: ForgingStage.ordered().length,
      lastStageResults: results.length,
      lastAllPassed: results.length > 0 && results.every((r) => r.passed),
    };
  }
}

export default function Plugin(ctx: Context, options?: ForgingServiceOptions) {
  return ctx.plugin(ForgingService, options);
}
