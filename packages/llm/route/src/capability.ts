/**
 * @flowforge/llm-route — ModelCapability（TS 重写自 `core/model_capability.py`，
 * F28）
 *
 * 零配置模型访问，供上层项目（contentforge/devforge 等）使用：
 * 无需配置 models.yaml、providers 或 API keys——一切继承自 flowforge。
 *
 * 内部委托模型选择与健康追踪给 ModelCapabilityProvider（智能路由 +
 * 降级兜底），实际调用通过 LlmClientLike 接口注入（对齐 Python duck
 * typing 的 LLMClient.execute/stream）。
 *
 * @module @flowforge/llm-route/capability
 */

import { ModelCapabilityProvider } from './provider.js';
import type { ModelService } from './model-service.js';

/** LLM 客户端最小接口（对齐 Python LLMClient.execute / stream）。 */
export interface LlmClientLike {
  execute(input: { params: Record<string, unknown> }): Promise<{
    result: Record<string, unknown>;
  }>;
  stream(input: { params: Record<string, unknown> }): AsyncIterable<string>;
}

/** 高可用模型选择器（默认 ModelCapabilityProvider，可替换）。 */
export interface ModelSelectorLike {
  getModel(
    capability?: string | null,
    preferred?: string | null,
  ): string | undefined;
  reportSuccess(modelName: string, latencyMs: number): void;
  reportFailure(modelName: string, error?: string): void;
}

/** ModelCapability 构造选项（一切依赖可注入，对齐 Python 惰性初始化）。 */
export interface ModelCapabilityOptions {
  /** LLM 客户端（缺省需后续注入；chat 调用前必须可用）。 */
  readonly llmClient?: LlmClientLike;
  /** models 配置（provider 自动发现模型，缺省空）。 */
  readonly modelsConfig?: Record<string, unknown>;
  /** 模型服务（list_models/check_health 等，缺省惰性创建）。 */
  readonly modelService?: ModelService;
  /** 模型选择器（缺省 ModelCapabilityProvider）。 */
  readonly selector?: ModelSelectorLike;
}

/**
 * 零配置模型访问（core/model_capability.py ModelCapability）。
 *
 * 包装 LlmClientLike 与 ModelService 为简单高层 API。上层项目永远不需要
 * 配置 providers/models/API keys——全部继承自 flowforge 的 models.yaml。
 *
 * 原 Python 版为单例；TS 版由 Cordis 插件持有实例（ctx.forgeLlmRoute），
 * 插件生命周期内共享同一实例。
 */
export class ModelCapability {
  private llmClient: LlmClientLike | undefined;
  private modelService: ModelService | undefined;
  private selector: ModelSelectorLike;

  constructor(options: ModelCapabilityOptions = {}) {
    this.llmClient = options.llmClient;
    this.modelService = options.modelService;
    this.selector = options.selector ?? new ModelCapabilityProvider(options.modelsConfig ?? {});
  }

  /** 设置/替换 LLM 客户端（惰性初始化入口）。 */
  setLlmClient(client: LlmClientLike): void {
    this.llmClient = client;
  }

  /** 设置/替换模型服务（惰性初始化入口）。 */
  setModelService(service: ModelService): void {
    this.modelService = service;
  }

  /** 访问内部选择器（对齐 Python provider 属性，供高级路由使用）。 */
  get provider(): ModelSelectorLike {
    return this.selector;
  }

  private requireLlmClient(): LlmClientLike {
    if (!this.llmClient) {
      throw new Error(
        'ModelCapability: LLM 客户端未注入（setLlmClient 或构造 options.llmClient）',
      );
    }
    return this.llmClient;
  }

  private requireModelService(): ModelService {
    if (!this.modelService) {
      throw new Error(
        'ModelCapability: 模型服务未注入（setModelService 或构造 options.modelService）',
      );
    }
    return this.modelService;
  }

  /** 根据 persona/agent_name 推导能力名并选择模型（chat/chat_stream 共用）。 */
  private selectModel(
    persona: string,
    agentName: string,
    model: string,
  ): string {
    let selectedModel = model;
    if (!selectedModel) {
      let capability: string | null = null;
      if (persona.length > 0) {
        capability = `persona:${persona}`;
      } else if (agentName.length > 0) {
        capability = `agent:${agentName}`;
      }
      selectedModel = this.selector.getModel(capability, model || null) ?? '';
    }
    return selectedModel;
  }

  /**
   * 发送聊天消息并返回响应 dict（chat）。
   *
   * 未显式指定模型时，用 ModelCapabilityProvider 按能力与健康选择最优模型；
   * 调用后向 provider 报告成功/失败以持续追踪健康。
   *
   * @returns { content, provider, model, tokens, tool_calls? }
   */
  async chat(options: {
    prompt: string;
    system?: string;
    persona?: string;
    agentName?: string;
    model?: string;
    temperature?: number;
    topP?: number | null;
    maxTokens?: number;
    taskId?: string;
    tools?: unknown[];
    preferApi?: boolean;
  }): Promise<Record<string, unknown>> {
    const llm = this.requireLlmClient();
    const selectedModel = this.selectModel(
      options.persona ?? '',
      options.agentName ?? '',
      options.model ?? '',
    );

    const messages: Array<{ role: string; content: string }> = [];
    if (options.system && options.system.length > 0) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const params: Record<string, unknown> = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      persona: options.persona ?? '',
      agent_name: options.agentName ?? '',
      task_id: options.taskId ?? 'sdk',
      stream: false,
    };
    if (options.topP !== undefined && options.topP !== null) {
      params['top_p'] = options.topP;
    }
    if (selectedModel.length > 0) {
      params['model'] = selectedModel;
    }
    if (options.tools && options.tools.length > 0) {
      params['tools'] = options.tools;
    }
    if (options.preferApi === true) {
      params['prefer_api'] = true;
    }

    const start = Date.now();
    try {
      const output = await llm.execute({ params });
      const result = output.result;

      // 报告成功（健康追踪）
      const latencyMs = Date.now() - start;
      const usedModel = typeof result['model'] === 'string'
        ? result['model']
        : selectedModel;
      if (usedModel.length > 0) {
        this.selector.reportSuccess(usedModel, latencyMs);
      }
      return result;
    } catch (error) {
      if (selectedModel.length > 0) {
        this.selector.reportFailure(
          selectedModel,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  /** 流式聊天响应，逐块 yield 文本（chat_stream）。 */
  async *chatStream(options: {
    prompt: string;
    system?: string;
    persona?: string;
    agentName?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    taskId?: string;
  }): AsyncGenerator<string> {
    const llm = this.requireLlmClient();
    const selectedModel = this.selectModel(
      options.persona ?? '',
      options.agentName ?? '',
      options.model ?? '',
    );

    const messages: Array<{ role: string; content: string }> = [];
    if (options.system && options.system.length > 0) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const params: Record<string, unknown> = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4000,
      persona: options.persona ?? '',
      agent_name: options.agentName ?? '',
      task_id: options.taskId ?? 'sdk',
      stream: true,
    };
    if (selectedModel.length > 0) {
      params['model'] = selectedModel;
    }

    const start = Date.now();
    try {
      for await (const chunk of llm.stream({ params })) {
        yield chunk;
      }
      // 流完成后报告成功
      if (selectedModel.length > 0) {
        this.selector.reportSuccess(selectedModel, Date.now() - start);
      }
    } catch (error) {
      if (selectedModel.length > 0) {
        this.selector.reportFailure(
          selectedModel,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  /**
   * 发送聊天消息并将响应解析为 JSON（chat_json）。
   *
   * 去除 markdown 代码块包装后解析 content 为 JSON 对象。
   * 适用于结构化输出提示词（多角色辩论、预测等）。
   *
   * @throws 响应无法解析为 JSON 时抛 ValueError 语义错误。
   */
  async chatJson(options: {
    prompt: string;
    system?: string;
    persona?: string;
    agentName?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    taskId?: string;
  }): Promise<Record<string, unknown>> {
    const result = await this.chat({
      prompt: options.prompt,
      ...(options.system !== undefined ? { system: options.system } : {}),
      ...(options.persona !== undefined ? { persona: options.persona } : {}),
      ...(options.agentName !== undefined ? { agentName: options.agentName } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 4096,
      ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
    });
    const content = typeof result['content'] === 'string'
      ? result['content']
      : String(result);
    if (content.length === 0) {
      throw new Error('LLM 返回空内容，无法解析 JSON');
    }

    // 去除 markdown 代码块包装
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON 顶层应为对象');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `LLM 输出 JSON 解析失败: ${detail}. 原始内容前 500 字符: ${content.slice(0, 500)}`,
      );
    }
  }

  /** 列出所有可用模型及健康状态（list_models）。 */
  listModels(): Array<Record<string, unknown>> {
    return this.requireModelService().getModels();
  }

  /** 列出所有模型分配（persona → 模型链，list_assignments）。 */
  listAssignments(): Record<string, Record<string, unknown>> {
    return this.requireModelService().getAssignments();
  }

  /** 运行全量模型健康检查（check_health）。 */
  async checkHealth(force = false): Promise<Array<Record<string, unknown>>> {
    const results = await this.requireModelService().healthCheckAll(force);
    return results.map((r) => ({ ...r } as Record<string, unknown>));
  }

  /** 获取当前健康报告（不重新检查，get_health_report）。 */
  getHealthReport(): Record<string, unknown> {
    return this.requireModelService().getHealthReport();
  }

  /** 获取 persona/agent 的模型候选链（get_candidate_chain）。 */
  getCandidateChain(persona = '', agentName = ''): string[] {
    void persona;
    void agentName;
    // Python 版委托 LLMClient.get_candidate_chain；TS 版基于模型服务候选链
    // 的默认 assignment 解析（缺省 "default" 链，由上层 LLM 客户端接管）。
    return this.requireModelService().getAvailableFallbackChain('default');
  }
}
