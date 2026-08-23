/**
 * @flowforge/forgekin-species — ForgekinBase 抽象基类
 *
 * TS 移植自 `forgemind/base.py`。Forgekin 是"赋予灵魂和感情的智能体"，
 * 与现实世界（物理或虚拟）建立闭环：观察 → 推理 → 行动 → 写回 → 验证。
 *
 * 灵魂（Soul）= 持久身份（SoulImprint）+ 价值锚点 + 长期记忆（EchoStore）
 * 感情（Emotion）= 用户偏好 + 协作风格 + 行为画像（能力画像）
 *
 * 移植差异（插件化改造）：
 * - Python 中 chat 按 provider 分发到 zhipu/openroute/CLI 直连客户端
 *   （依赖 flowforge.llm 内部实现）；TS 统一为注入式 `llmClient` 鸭子接口
 *   （可接 @flowforge/forgekin-trae-bridge 的 TraeLLMClient），未注入时降级。
 * - _chat_error 的可重试判定改为错误名/消息启发式（AbortError/timeout/network）。
 *
 * @module @flowforge/forgekin-species/base
 */

import type { SoulImprint } from '@flowforge/forgekin-soul';
import { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinSpecies } from './species-enum.js';

/** OpenAI 格式消息 */
export interface ForgekinChatMessage {
  role: string;
  content: string;
}

/** LLM 客户端鸭子接口（TraeLLMClient 等兼容；依赖注入，铁律3） */
export interface ForgekinLLMClient {
  chat(messages: ForgekinChatMessage[], options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** ForgekinBase 构造入参 */
export interface ForgekinBaseInit {
  forgekin_id: string;
  name: string;
  species: ForgekinSpecies;
  soul_imprint: SoulImprint;
  evolution_stage?: EvolutionStage | undefined;
  awakening_stage?: AwakeningStage | undefined;
  capability_profile?: Readonly<Record<string, unknown>> | undefined;
  /** 完整 YAML 配置（含 personality/role/llm/value_anchors 等） */
  forgekin_config?: Readonly<Record<string, unknown>> | undefined;
  /** LLM 客户端（未注入时 chat 返回降级响应） */
  llm_client?: ForgekinLLMClient | undefined;
}

/** chat 额外选项（sessionId + 透传参数） */
export interface ForgekinChatOptions {
  sessionId?: string | undefined;
  params?: Readonly<Record<string, unknown>> | undefined;
}

/** 可重试错误判定（AbortError / 超时 / 网络类；配置类错误快速失败）— P-116 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true;
  }
  return /timeout|timed out|network|fetch failed|econn/i.test(error.message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Forgekin（Forgekin / Spirit Agent）抽象基类。
 *
 * 所有 5 种形态（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin /
 * HybridForgekin）继承本基类并实现 observe / act / verify 三个抽象方法。
 */
export abstract class ForgekinBase {
  readonly forgekinId: string;
  readonly name: string;
  readonly species: ForgekinSpecies;
  /** SoulImprint（不可变身份标识，谱系追踪锚点） */
  readonly soulImprint: SoulImprint;
  evolutionStage: EvolutionStage;
  awakeningStage: AwakeningStage;
  capabilityProfile: Record<string, unknown>;

  private forgekinConfig: Record<string, unknown>;
  private llmClient: ForgekinLLMClient | null;
  /** 生命周期状态：created → observing/acting/verifying → evolved/retired */
  private lifecycleState = 'created';

  constructor(init: ForgekinBaseInit) {
    if (!init.forgekin_id || !init.forgekin_id.trim()) {
      throw new Error('forgekin_id 不能为空。');
    }
    if (!init.name || !init.name.trim()) {
      throw new Error('name 不能为空。');
    }
    if (init.soul_imprint === null || init.soul_imprint === undefined) {
      throw new Error('soul_imprint 不能为空——Forgekin必须有SoulImprint。详见 [doc:design/naming-contract.md#2.6]');
    }
    this.forgekinId = init.forgekin_id.trim();
    this.name = init.name.trim();
    this.species = init.species;
    this.soulImprint = init.soul_imprint;
    this.evolutionStage = init.evolution_stage ?? EvolutionStage.E1;
    this.awakeningStage = init.awakening_stage ?? AwakeningStage.E1;
    this.capabilityProfile = { ...(init.capability_profile ?? {}) };
    this.forgekinConfig = { ...(init.forgekin_config ?? {}) };
    this.llmClient = init.llm_client ?? null;
  }

  // ── LLM 桥接 ────────────────────────────────────────────────────

  /** 注入 LLM 客户端（依赖注入，铁律3） */
  setLlmClient(client: ForgekinLLMClient): void {
    this.llmClient = client;
  }

  /** 返回完整 YAML 配置字典（只读副本） */
  getForgekinConfig(): Record<string, unknown> {
    return { ...this.forgekinConfig };
  }

  /**
   * 根据 YAML 配置构建 system prompt（角色/性格/能力/价值锚点/限制）。
   * 所有内容来自 YAML 配置（铁律5+P16：禁止硬编码）。
   */
  buildSystemPrompt(): string {
    const cfg = this.forgekinConfig;
    const role = asRecord(cfg['role']);
    const personality = asRecord(cfg['personality']);
    const capability = asRecord(cfg['capability_profile']);
    const anchors = asStringList(cfg['value_anchors']);
    const restrictions = asRecord(cfg['restrictions']);

    const parts: string[] = [];
    parts.push(`你是 ${this.name}，一个Forgekin（Forgekin / Spirit Agent）。`);
    parts.push('Forgekin定义：赋予灵魂和感情的智能体，具有自进化能力的 Agent。');
    parts.push(`你的形态是 ${ForgekinSpecies.chineseName(this.species)}（${this.species}）。`);
    parts.push(
      `你的进化阶是 ${this.evolutionStage}（${EvolutionStage.chineseName(this.evolutionStage)}），` +
        `觉醒阶是 ${this.awakeningStage}（${AwakeningStage.chineseName(this.awakeningStage)}）。`,
    );

    // 项目上下文（FlowForge 元信息；部署细节可由 project_context 配置覆盖）
    parts.push('\n## 当前项目上下文（真实信息）');
    parts.push('- 项目名: FlowForge（AI Agent OS / 灵智体锻造平台）');
    parts.push('- 技术栈: TypeScript monorepo / Cordis 插件体系');
    parts.push('- 对于一般问候或开放式问题，用你的角色定位自然回应，不要说\'无法回答\'');

    const roleDescription = role['description'];
    if (typeof roleDescription === 'string' && roleDescription !== '') {
      parts.push(`\n## 角色定位\n${roleDescription}`);
    }
    const summary = personality['summary'];
    if (typeof summary === 'string' && summary !== '') {
      parts.push(`\n## 性格特征\n${summary}`);
    }
    const collaborationStyle = personality['collaboration_style'];
    if (typeof collaborationStyle === 'string' && collaborationStyle !== '') {
      parts.push(`协作风格：${collaborationStyle}`);
    }
    const voice = personality['voice'];
    if (typeof voice === 'string' && voice !== '') {
      parts.push(`语言风格：${voice}`);
    }
    const weaknesses = asStringList(personality['weaknesses']);
    if (weaknesses.length > 0) {
      parts.push(`已知弱点：${weaknesses.join(', ')}`);
    }

    const nativeAbilities = asStringList(capability['native_abilities']);
    if (nativeAbilities.length > 0) {
      parts.push(`\n## 能力画像\n擅长：${nativeAbilities.join(', ')}`);
    }
    const blindSpots = asStringList(capability['blind_spots']);
    if (blindSpots.length > 0) {
      parts.push(`盲点：${blindSpots.join(', ')}`);
    }

    if (anchors.length > 0) {
      parts.push('\n## 价值锚点（不可违反）');
      anchors.forEach((anchor, i) => {
        parts.push(`${i + 1}. ${anchor}`);
      });
    }

    const forbidden = asStringList(restrictions['forbidden_actions']);
    if (forbidden.length > 0) {
      parts.push('\n## 禁止行为');
      forbidden.forEach((action, i) => {
        parts.push(`${i + 1}. ${action}`);
      });
    }

    parts.push('\n## 行为准则');
    parts.push('- 遵守 CONTRIBUTING.md 15 条编程红线');
    parts.push('- 遵守 VISION.md §7 七条愿景锚点');
    parts.push('- Magic Words 逃生舱始终可触发');
    parts.push('- 单向依赖零容忍：上层可依赖下层，下层禁止 import 上层');
    parts.push('- 回答基于真实数据和项目实际情况，但可以用自然语言解释概念');
    parts.push('- 禁止回复\'无法回答\'——如果不确定，请说明你需要什么信息来回答');

    return parts.join('\n');
  }

  /**
   * 通过注入的 LLM 客户端与 Forgekin 对话。
   *
   * 工作流程:
   *   1. 从 YAML 配置构建 system prompt（角色/性格/能力/价值锚点）
   *   2. 调用注入的 llmClient.chat（如 TraeLLMClient 走文件桥接）
   *   3. 未注入客户端时返回降级响应（提示 operator 注入）
   */
  async chat(messages: readonly ForgekinChatMessage[], options: ForgekinChatOptions = {}): Promise<Record<string, unknown>> {
    const systemPrompt = this.buildSystemPrompt();
    const fullMessages: ForgekinChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];

    const llmCfg = asRecord(this.forgekinConfig['llm']);
    const prefix = llmCfg['session_id_prefix'];
    const sessionId = options.sessionId ?? (typeof prefix === 'string' && prefix !== '' ? prefix : this.forgekinId);
    const params: Record<string, unknown> = { ...(options.params ?? {}) };
    if (params['temperature'] === undefined) {
      params['temperature'] = typeof llmCfg['temperature'] === 'number' ? llmCfg['temperature'] : 0.7;
    }
    if (params['max_tokens'] === undefined) {
      params['max_tokens'] = typeof llmCfg['max_tokens'] === 'number' ? llmCfg['max_tokens'] : 8192;
    }
    params['session_id'] = sessionId;

    // 降级处理：未注入 LLM 客户端
    if (this.llmClient === null) {
      return {
        content:
          `[${this.name} 降级响应] LLM 客户端未注入。` +
          `请通过 setLlmClient(client) 注入 LLM 客户端（如 TraeLLMClient），` +
          `或通过 ForgePipeline.forgeFromYaml() 锻造时自动注入。` +
          `\n\n系统提示词预览:\n${systemPrompt.slice(0, 500)}...`,
        model: 'none',
        usage: { latency_ms: 0, degraded: true },
        session_id: sessionId,
        forgekin_id: this.forgekinId,
      };
    }

    try {
      const result = { ...(await this.llmClient.chat(fullMessages, params)) };
      if (result['forgekin_id'] === undefined) {
        result['forgekin_id'] = this.forgekinId;
      }
      if (result['session_id'] === undefined) {
        result['session_id'] = sessionId;
      }
      return result;
    } catch (error) {
      // P-116: 区分可重试（超时/网络）与不可重试（配置）异常
      return this.chatError('桥接', error, sessionId, 'error');
    }
  }

  /** 构造统一的 LLM 错误响应，标注可重试性 — P-116 */
  private chatError(providerLabel: string, error: unknown, sessionId: string, model: string): Record<string, unknown> {
    const retryable = isRetryableError(error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {
      content: `[${this.name} ${providerLabel} 异常] ${message}`,
      model,
      usage: { latency_ms: 0, error: true },
      session_id: sessionId,
      forgekin_id: this.forgekinId,
      error: message,
      error_type: retryable ? 'retryable' : 'config',
      retryable,
    };
  }

  // ── 抽象方法：现实闭环（观察 → 行动 → 验证）──────────────────

  /** 观察环境（物理传感器 / 虚拟世界状态）— 感知端闭环 */
  abstract observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;

  /** 在环境中执行动作 — 行动端闭环（遵守觉醒阶自主范围约束） */
  abstract act(action: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;

  /** 验证动作结果是否达成预期 — 验证端闭环（失败触发反思/回退） */
  abstract verify(actionResult: Readonly<Record<string, unknown>>): Promise<boolean>;

  // ── 能力判定 ──────────────────────────────────────────────────

  /** 觉醒阶 ≥ E4 Evolving 可自我进化（但不可修改 VISION §7） */
  canSelfEvolve(): boolean {
    return AwakeningStage.canSelfEvolve(this.awakeningStage);
  }

  /** 进化阶 = E6 ForgeMind 可锻造新 Forgekin（operator 直接授权） */
  canForgeNewForgekin(): boolean {
    return EvolutionStage.canForgeNewForgekin(this.evolutionStage);
  }

  // ── 生命周期辅助 ──────────────────────────────────────────────

  /** 当前生命周期状态 */
  get lifecycle_state(): string {
    return this.lifecycleState;
  }

  /** 更新生命周期状态（内部方法，子类用于状态机推进） */
  protected setLifecycleState(state: string): void {
    this.lifecycleState = state;
  }

  /** 描述字典（日志 / 谱系追踪 / UI 展示） */
  describe(): Record<string, unknown> {
    return {
      forgekin_id: this.forgekinId,
      name: this.name,
      species: this.species,
      species_chinese: ForgekinSpecies.chineseName(this.species),
      evolution_stage: this.evolutionStage,
      evolution_stage_chinese: EvolutionStage.chineseName(this.evolutionStage),
      awakening_stage: this.awakeningStage,
      awakening_stage_chinese: AwakeningStage.chineseName(this.awakeningStage),
      imprint_hash: this.soulImprint.imprintHash,
      namespace: this.soulImprint.namespace,
      lifecycle_state: this.lifecycleState,
      can_self_evolve: this.canSelfEvolve(),
      can_forge_new_forgekin: this.canForgeNewForgekin(),
    };
  }

  toString(): string {
    return `<${this.constructor.name} id=${JSON.stringify(this.forgekinId)} name=${JSON.stringify(this.name)} species=${JSON.stringify(this.species)} evo=${this.evolutionStage} awk=${this.awakeningStage}>`;
  }
}
