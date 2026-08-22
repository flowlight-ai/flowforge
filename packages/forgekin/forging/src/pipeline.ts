/**
 * @flowforge/forgekin-forging — Forge Nurturing 锻造流水线主类
 *
 * TS 移植自 `forgemind/forging/pipeline.py`。`ForgePipeline` 是 Forgekin 的
 * 锻造入口：消费 `ForgekinFormData`，按 6 阶段流水线锻造，产出
 * `ForgekinBase` 子类实例。
 *
 * 6 阶段流水线（FM-006，顺序固定）：
 *   1. 形态定义 → 2. 能力注入 → 3. 记忆初始化 → 4. 价值观对齐 →
 *   5. 能力验证 → 6. 觉醒晋升
 *
 * 移植差异（插件化改造）：
 * - Python `importlib.import_module` 动态实例化 → `SpeciesFactoryRegistry`
 *   静态注册表分发（species_factory 配置段保留为谱系元数据）。
 * - Python 中重复定义的两个 `forge()` 合并为 `forge(form, contextExtra?)`。
 *
 * 配置驱动（铁律5+P16）：阶段参数 / 提示词 / 价值锚点默认清单 / 形态工厂
 * 谱系全部外置到 `config/forging.yaml` 与 `config/prompts.yaml`，禁止硬编码。
 *
 * @module @flowforge/forgekin-forging/pipeline
 */

import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { forgeSoulImprint, type SoulImprint } from '@flowforge/forgekin-soul';
import { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import {
  ForgekinFormData,
  ForgekinSpecies,
  SpeciesFactoryRegistry,
  type ForgekinBase,
  type ForgekinLLMClient,
} from '@flowforge/forgekin-species';
import { loadForgingConfig, loadPromptsConfig } from './config.js';
import { ForgingStage, makeForgingStageResult, type ForgingStageResult } from './forging-stages.js';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** ForgePipeline 构造选项 */
export interface ForgePipelineOptions {
  /** Forge Nurturing 配置字典（缺省从内置 `config/forging.yaml` 加载） */
  readonly forgingConfig?: Readonly<Record<string, unknown>> | undefined;
  /** 提示词配置字典（缺省从内置 `config/prompts.yaml` 加载，铁律5+P16） */
  readonly promptsConfig?: Readonly<Record<string, unknown>> | undefined;
  /** 形态构造器工厂注册表（缺省内置五形态；插件可先注册自定义形态再注入） */
  readonly factory?: SpeciesFactoryRegistry | undefined;
}

/** forge() 附加上下文（forgeFromYaml 传递的 forgekin_config / llm_client 等） */
export type ForgeContextExtra = Readonly<Record<string, unknown>>;

/**
 * Forge Nurturing 锻造流水线。
 *
 * 消费 `ForgekinFormData`，按 6 阶段流水线锻造，产出 `ForgekinBase` 子类实例。
 */
export class ForgePipeline {
  /** 阶段顺序常量（对齐 Python STAGES 类属性） */
  static readonly STAGES: readonly string[] = ForgingStage.ordered();

  private readonly forgingConfig: Record<string, unknown>;
  private readonly promptsConfig: Record<string, unknown>;
  private readonly forgingSettings: Record<string, unknown>;
  private readonly factory: SpeciesFactoryRegistry;
  /** 最近一次锻造的各阶段结果（审计用；失败中止时保留已完成部分） */
  lastStageResults: ForgingStageResult[] = [];

  constructor(options: ForgePipelineOptions = {}) {
    this.forgingConfig = { ...(options.forgingConfig ?? loadForgingConfig()) };
    this.promptsConfig = { ...(options.promptsConfig ?? loadPromptsConfig()) };
    this.forgingSettings = asRecord(this.forgingConfig['forging']);
    this.factory = options.factory ?? new SpeciesFactoryRegistry();
  }

  // ── 公开 API ────────────────────────────────────────────────────

  /**
   * 执行完整锻造流程，产出 Forgekin 实例。
   *
   * @param form - Forgekin 锻造表单（name / species / namespace / requirement / seed_params / value_anchors 等）。
   * @param contextExtra - 附加上下文（forgekin_config / llm_client；对齐 Python `_pending_context_extra`）。
   * @throws 任何阶段失败时抛错（含阶段名与错误信息）。
   */
  async forge(form: ForgekinFormData, contextExtra?: ForgeContextExtra): Promise<ForgekinBase> {
    this.lastStageResults = [];
    const context: Record<string, unknown> = {
      form,
      imprint: null,
      profile: {},
      ...(contextExtra ?? {}),
    };

    for (const stage of ForgingStage.ordered()) {
      this.lastStageResults.push(await this.runStage(stage, context));
    }

    // 所有阶段通过后，实例化 Forgekin
    return this.instantiateForgekin(form, context);
  }

  /**
   * 从 YAML 配置文件锻造 Forgekin（Forge Nurturing 体系核心入口）。
   *
   * operator 通过编写 YAML 配置文件定义 Forgekin（参考 forgemind/forgekins/
   * 下的鲁班/夏洛克/梵高预置配置），流水线读取配置并按 6 阶段锻造。
   *
   * @param yamlPath - YAML 配置文件路径。
   * @param options.llmClient - LLM 客户端（如 TraeLLMClient）；缺省时 chat 返回降级响应。
   * @throws 文件不存在 / 缺失必填字段 / 阶段失败时抛错。
   */
  async forgeFromYaml(
    yamlPath: string,
    options: { llmClient?: ForgekinLLMClient | undefined } = {},
  ): Promise<ForgekinBase> {
    let raw: string;
    try {
      raw = readFileSync(yamlPath, 'utf-8');
    } catch {
      throw new Error(`Forgekin YAML 配置不存在: ${yamlPath}。预置配置位于 forgemind/forgekins/ 目录。`);
    }
    const config = asRecord(parseYaml(raw));

    // 校验必填字段
    for (const field of ['name', 'species', 'namespace']) {
      if (!config[field]) {
        throw new Error(
          `YAML 配置缺失必填字段 '${field}': ${yamlPath}。参考 forgemind/forgekins/luban.yaml。`,
        );
      }
    }

    // 从 YAML 配置构造 ForgekinFormData
    const species = ForgekinSpecies.fromString(String(config['species']));
    const evolutionStage = EvolutionStage.fromString(String(config['evolution_stage'] ?? 'E1'));
    const awakeningStage = AwakeningStage.fromString(String(config['awakening_stage'] ?? 'E1'));
    const role = asRecord(config['role']);

    const form = new ForgekinFormData({
      name: String(config['name']),
      species,
      namespace: String(config['namespace']),
      requirement: typeof role['description'] === 'string' ? role['description'] : '',
      seed_params: {
        forgekin_id: config['forgekin_id'] ?? null,
        breed: config['breed'] ?? null,
        breed_en: config['breed_en'] ?? null,
      },
      value_anchors: asStringList(config['value_anchors'] ?? []),
      capability_profile: asRecord(config['capability_profile'] ?? {}),
      evolution_stage: evolutionStage,
      awakening_stage: awakeningStage,
      operator_id: typeof config['operator_id'] === 'string' ? config['operator_id'] : null,
    });

    // 完整 YAML 配置与 LLM 客户端经上下文注入实例化阶段
    return await this.forge(form, {
      forgekin_config: config,
      llm_client: options.llmClient ?? null,
    });
  }

  /** 返回 Forge Nurturing 配置字典（只读视图） */
  getForgingConfig(): Record<string, unknown> {
    return { ...this.forgingConfig };
  }

  /** 返回提示词配置字典（只读视图） */
  getPromptsConfig(): Record<string, unknown> {
    return { ...this.promptsConfig };
  }

  /** 返回指定阶段的配置字典（含 required / timeout_seconds / retry 等） */
  getStageConfig(stage: ForgingStage): Record<string, unknown> {
    const stages = asRecord(this.forgingSettings['stages']);
    return { ...asRecord(stages[stage]) };
  }

  /**
   * 返回指定阶段的提示词模板（外置于 config/prompts.yaml，铁律5+P16）。
   *
   * @throws 该阶段无对应提示词时抛错。
   */
  getPrompt(stage: ForgingStage): string {
    const prompts = asRecord(this.promptsConfig['forging_prompts']);
    const prompt = prompts[stage];
    if (typeof prompt !== 'string') {
      throw new Error(`阶段 ${stage} 无对应提示词——请在 config/prompts.yaml 中补全（铁律5+P16）。`);
    }
    return prompt;
  }

  // ── 阶段执行调度 ─────────────────────────────────────────────────

  /**
   * 执行单个锻造阶段（记录开始 / 调用处理器 / 记录结果）。
   *
   * 阶段处理器当前为骨架实现——Phase 1+ 由真实 LLM 调用与 EchoStore / Eval
   * 系统填充（对齐 Python 骨架语义）。
   */
  private async runStage(stage: ForgingStage, context: Record<string, unknown>): Promise<ForgingStageResult> {
    const start = performance.now();
    try {
      const output = await this.stageHandler(stage, context);
      return makeForgingStageResult({
        stage,
        passed: true,
        output,
        duration_seconds: (performance.now() - start) / 1000,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : String(error);
      this.lastStageResults.push(
        makeForgingStageResult({
          stage,
          passed: false,
          error: `${name}: ${message}`,
          duration_seconds: (performance.now() - start) / 1000,
        }),
      );
      throw new Error(
        `Forge Nurturing锻造阶段 ${stage}（${ForgingStage.chineseName(stage)}）失败: ${message}`,
      );
    }
  }

  /** 阶段分发（对齐 Python _stage_handlers 映射） */
  private stageHandler(stage: ForgingStage, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (stage) {
      case ForgingStage.SPECIES_DEFINITION:
        return this.handleSpeciesDefinition(context);
      case ForgingStage.CAPABILITY_INJECTION:
        return this.handleCapabilityInjection(context);
      case ForgingStage.MEMORY_SEEDING:
        return this.handleMemorySeeding(context);
      case ForgingStage.VALUE_ALIGNMENT:
        return this.handleValueAlignment(context);
      case ForgingStage.CAPABILITY_VERIFICATION:
        return this.handleCapabilityVerification(context);
      case ForgingStage.AWAKENING_PROMOTION:
        return this.handleAwakeningPromotion(context);
    }
  }

  // ── 阶段处理器（骨架实现，Phase 1+ 接入真实 LLM / Eval）──────────

  /** 阶段 1: 形态定义 — 直接采用表单中的 species（Phase 1+ 按 requirement 自动选型） */
  private async handleSpeciesDefinition(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const form = this.formFromContext(context);
    return {
      species: form.species,
      species_chinese: ForgekinSpecies.chineseName(form.species),
      reason: `表单显式指定ForgekinSpecies: ${form.species}`,
    };
  }

  /** 阶段 2: 能力注入 — 直接采用表单中的 capability_profile（Phase 1+ 由 LLM 生成） */
  private async handleCapabilityInjection(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const form = this.formFromContext(context);
    const profile = { ...form.capabilityProfile };
    context['profile'] = profile;
    return {
      capability_profile: profile,
      native_abilities: asStringList(profile['native_abilities'] ?? []),
      blind_spots: asStringList(profile['blind_spots'] ?? []),
    };
  }

  /** 阶段 3: 记忆初始化 — 记录种子记忆结构（Phase 1+ 接入真实 EchoStore 写入） */
  private async handleMemorySeeding(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const form = this.formFromContext(context);
    const seedMemories = {
      identity_memory: `我是 ${form.name}，${ForgekinSpecies.chineseName(form.species)}，归属于 ${form.namespace} 命名空间。`,
      anchor_memory: '价值锚点已注入，详见SoulImprint value_anchors。',
      bootstrap_memory: '首次任务最小可行行为: 观察 → 建议 → 等待 operator 确认。',
    };
    return { seed_memories: seedMemories };
  }

  /** 阶段 4: 价值观对齐 — 从表单或默认清单取价值锚点，锻造 SoulImprint */
  private async handleValueAlignment(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const form = this.formFromContext(context);
    const defaultAnchors = asStringList(this.forgingSettings['value_anchors_default'] ?? []);
    const valueAnchors = form.valueAnchors.length > 0 ? form.valueAnchors : defaultAnchors;
    // 锻造 SoulImprint（不可变身份标识）
    const imprint = forgeSoulImprint(form.toImprintSeed(), [...valueAnchors], form.namespace);
    context['imprint'] = imprint;
    return {
      value_anchors: [...valueAnchors],
      imprint_hash: imprint.imprintHash,
      escape_hatch_ready: true,
    };
  }

  /** 阶段 5: 能力验证 — 骨架默认刚好达标（Phase 1+ 接入真实 Eval 评分） */
  private async handleCapabilityVerification(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    void context;
    const minScoreValue = this.forgingSettings['min_quality_score'];
    const minScore = typeof minScoreValue === 'number' ? minScoreValue : 0.85;
    // 骨架实现: 默认刚好达标
    const qualityScore = minScore;
    if (qualityScore < minScore) {
      throw new Error(`能力验证未达标: ${qualityScore} < ${minScore}（rules.md 铁律2）`);
    }
    return {
      quality_score: qualityScore,
      min_quality_score: minScore,
      passed: true,
    };
  }

  /** 阶段 6: 觉醒晋升 — 确认初始觉醒阶 E1 全导阶（后续晋升需 operator 显式授权） */
  private async handleAwakeningPromotion(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    void context;
    return {
      awakening_stage: AwakeningStage.E1,
      reason: '新锻造Forgekin默认从全导阶起步，等待 operator 显式授权晋升',
      guardrails_level: 'full',
      operator_intervention: 'per_step',
    };
  }

  private formFromContext(context: Record<string, unknown>): ForgekinFormData {
    const form = context['form'];
    if (!(form instanceof ForgekinFormData)) {
      throw new Error('流水线上下文缺少 ForgekinFormData 表单（form 字段）。');
    }
    return form;
  }

  // ── Forgekin 实例化 ─────────────────────────────────────────────

  /**
   * 按形态工厂实例化 Forgekin。
   *
   * 移植差异：Python 经 `importlib.import_module(module).class_name` 动态
   * 实例化；TS 经 `SpeciesFactoryRegistry` 静态注册表分发（一切皆插件），
   * `species_factory` 配置段保留为谱系元数据（模块路径 / 类名），构造器
   * 缺失时报错信息引用谱系定位。
   */
  private instantiateForgekin(form: ForgekinFormData, context: Record<string, unknown>): ForgekinBase {
    const imprint = context['imprint'];
    if (imprint === null || imprint === undefined) {
      throw new Error('流水线上下文缺少 SoulImprint（价值观对齐阶段未执行）。');
    }
    const soulImprint = imprint as SoulImprint;
    const profile = asRecord(context['profile']);
    const forgekinConfig = asRecord(context['forgekin_config']);
    const rawClient = context['llm_client'];
    const llmClient: ForgekinLLMClient | undefined =
      typeof rawClient === 'object' && rawClient !== null && typeof (rawClient as ForgekinLLMClient).chat === 'function'
        ? (rawClient as ForgekinLLMClient)
        : undefined;

    if (!this.factory.has(form.species)) {
      // 谱系定位（对齐 Python species_factory 配置兜底推导）
      const entry = asRecord(asRecord(this.forgingSettings['species_factory'])[String(form.species)]);
      const moduleName =
        typeof entry['module'] === 'string' && entry['module'] !== ''
          ? entry['module']
          : `flowforge.forgemind.species_impl.${form.species}`;
      const className =
        typeof entry['class_name'] === 'string' && entry['class_name'] !== ''
          ? entry['class_name']
          : ForgekinSpecies.className(form.species);
      throw new Error(
        `ForgekinSpecies ${form.species} 的构造器（${moduleName}.${className}）未注册——请先注册形态构造器（插件扩展点）。`,
      );
    }

    const configuredId = forgekinConfig['forgekin_id'];
    const forgekinId =
      typeof configuredId === 'string' && configuredId.trim() !== ''
        ? configuredId
        : `${form.namespace}:${form.name}`;

    // 构造参数: 通用参数（v7.0: forgekin_config 含 personality/role/llm + llm_client）
    const commonKwargs: Record<string, unknown> = {
      forgekin_id: forgekinId,
      name: form.name,
      soul_imprint: soulImprint,
      evolution_stage: form.evolutionStage,
      awakening_stage: form.awakeningStage,
      capability_profile: profile,
      forgekin_config: forgekinConfig,
      llm_client: llmClient,
    };
    return this.factory.create(form.species, commonKwargs);
  }
}
