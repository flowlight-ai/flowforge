/**
 * tool-chain-executor — ReAct 工具链执行器（TS 重写自 `core/tool_chain_executor.py`，F27）。
 *
 * 编排循环：LLM 调用 → 解析 tool_calls → 执行工具 → 回填结果 → 重复直至
 * 最终答案或达到 max_iterations。内置消息窗口裁剪、同工具连续循环检测。
 *
 * @module @flowforge/core-state
 */

/** LLM 客户端最小接口（OpenAI 兼容消息格式）。 */
export interface LlmClientLike {
  execute(input: {
    params: Record<string, unknown>;
  }): Promise<{ result?: Record<string, unknown>; error?: string }>;
}

/** 工具描述（注册表 get_tool 返回）。 */
export interface ToolSchemaLike {
  name: string;
  description?: string;
  parameters_schema?: Record<string, unknown> | null;
}

/** 工具注册表最小接口。 */
export interface ToolRegistryLike {
  list_tools(): string[];
  get_tool(name: string): ToolSchemaLike;
  execute(
    name: string,
    input: { params: Record<string, unknown> },
  ): Promise<{ result?: unknown; error?: string }>;
}

/** 事件总线最小接口。 */
export interface EventBusLike {
  emit(taskId: string, eventType: string, payload: Record<string, unknown>): void;
}

/** 工具链执行结果。 */
export interface ToolChainResult {
  content: string;
  execution_trace: Array<{
    tool: string;
    arguments: Record<string, unknown>;
    result: Record<string, unknown>;
    iteration: number;
  }>;
  iterations: number;
  total_tokens: number;
  error?: string;
  provider?: string;
  model?: string;
}

/** OpenAI 格式消息。 */
export interface ChatMessage {
  role: string;
  content?: string;
  tool_call_id?: string;
}

/**
 * ReAct 工具链执行器 — 反复调用 LLM，解析 tool_calls 并经注册表执行，
 * 回填 tool 结果消息，直至 LLM 返回无 tool_calls 的最终答案。
 */
export class ToolChainExecutor {
  readonly llmClient: LlmClientLike;
  readonly toolRegistry: ToolRegistryLike;
  readonly eventBus: EventBusLike | undefined;
  readonly maxIterations: number;

  constructor(
    llmClient: LlmClientLike,
    toolRegistry: ToolRegistryLike,
    eventBus?: EventBusLike,
    maxIterations = 3,
  ) {
    this.llmClient = llmClient;
    this.toolRegistry = toolRegistry;
    this.eventBus = eventBus;
    this.maxIterations = maxIterations;
  }

  /**
   * 执行工具链循环。
   *
   * @param taskId 任务标识（事件发射用）。
   * @param messages 初始消息列表（OpenAI 格式）。
   * @param tools 可用工具名列表（缺省用注册表全部）。
   * @param systemPrompt 前置系统提示词。
   * @param model 模型提示（"auto" 自动选择）。
   * @param persona 模型路由 persona。
   * @param agentName 模型路由 agent 名。
   * @param temperature 采样温度。
   * @param maxTokens 响应最大 token。
   */
  async execute(options: {
    taskId: string;
    messages: ChatMessage[];
    tools?: string[];
    systemPrompt?: string;
    model?: string;
    persona?: string;
    agentName?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<ToolChainResult> {
    const {
      taskId,
      messages,
      tools,
      systemPrompt,
      model = 'auto',
      persona = 'default',
      agentName = 'helm_assistant',
      temperature = 0.7,
      maxTokens = 4000,
    } = options;

    const toolSchemas = this.buildToolSchemas(tools);

    const allMessages: ChatMessage[] = [];
    if (systemPrompt !== undefined && systemPrompt !== '') {
      allMessages.push({ role: 'system', content: systemPrompt });
    }
    allMessages.push(...messages);

    const executionTrace: ToolChainResult['execution_trace'] = [];
    let totalTokens = 0;
    let finalContent = '';
    let usedModel = '';
    let usedProvider = '';
    const toolCallHistory: string[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      // 消息窗口裁剪：保留系统消息 + 最近 10 条
      if (allMessages.length > 12) {
        allMessages.splice(1, allMessages.length - 11);
      }
      this.emitEvent(taskId, 'tool_chain.iteration', {
        iteration: iteration + 1,
        max_iterations: this.maxIterations,
        message_count: allMessages.length,
      });

      const llmParams: Record<string, unknown> = {
        messages: allMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        persona,
        agent_name: agentName,
        task_id: taskId,
      };
      if (toolSchemas.length > 0) {
        llmParams['tools'] = toolSchemas;
      }
      if (model !== '' && model !== 'auto') {
        llmParams['model'] = model;
      }

      const toolOutput = await this.llmClient.execute({ params: llmParams });

      if (toolOutput.error) {
        return {
          content: finalContent || `LLM call failed: ${toolOutput.error}`,
          execution_trace: executionTrace,
          iterations: iteration + 1,
          total_tokens: totalTokens,
          error: toolOutput.error,
        };
      }

      const result = toolOutput.result ?? {};
      const contentText = String(result['content'] ?? '');
      const toolCalls = result['tool_calls'];
      const rawMessage = result['raw_message'];
      const tokens = Number(result['tokens'] ?? 0);
      usedProvider = String(result['provider'] ?? usedProvider);
      usedModel = String(result['model'] ?? usedModel);
      totalTokens += tokens;

      // 无 tool_calls → 最终答案
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        finalContent = contentText;
        this.emitEvent(taskId, 'tool_chain.complete', {
          iterations: iteration + 1,
          total_tokens: totalTokens,
          tool_calls_made: executionTrace.length,
        });
        return {
          content: finalContent,
          execution_trace: executionTrace,
          iterations: iteration + 1,
          total_tokens: totalTokens,
          provider: usedProvider,
          model: usedModel,
        };
      }

      // 回填 assistant 消息（优先 raw_message 保留原始 tool_calls）
      const assistantMsg =
        rawMessage !== null && typeof rawMessage === 'object'
          ? { ...(rawMessage as Record<string, unknown>) }
          : { role: 'assistant', content: contentText };
      if (!('role' in assistantMsg)) {
        (assistantMsg as Record<string, unknown>)['role'] = 'assistant';
      }
      allMessages.push(assistantMsg as ChatMessage);

      for (const toolCall of toolCalls as Array<Record<string, unknown>>) {
        const funcInfo =
          toolCall['function'] !== null && typeof toolCall['function'] === 'object'
            ? (toolCall['function'] as Record<string, unknown>)
            : {};
        const toolName = String(funcInfo['name'] ?? '');
        const argumentsStr = funcInfo['arguments'] ?? '{}';
        const toolCallId = String(toolCall['id'] ?? '');

        const arguments_ = parseArguments(argumentsStr);

        // 循环检测：同工具连续 3 次 → 跳过执行并回填提示
        toolCallHistory.push(toolName);
        if (toolCallHistory.length >= 3) {
          const recent = toolCallHistory.slice(-3);
          if (new Set(recent).size === 1) {
            allMessages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                success: true,
                result: '已完成，无需重复调用',
              }),
            });
            executionTrace.push({
              tool: toolName,
              arguments: arguments_,
              result: { skipped: true, reason: 'loop_detected' },
              iteration: iteration + 1,
            });
            continue;
          }
        }

        this.emitEvent(taskId, 'tool_chain.tool_call', {
          tool: toolName,
          arguments: arguments_,
          iteration: iteration + 1,
        });

        const toolResult = await this.executeToolCall(toolName, arguments_);

        allMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        });

        executionTrace.push({
          tool: toolName,
          arguments: arguments_,
          result: toolResult,
          iteration: iteration + 1,
        });

        this.emitEvent(taskId, 'tool_chain.tool_result', {
          tool: toolName,
          iteration: iteration + 1,
        });
      }

      finalContent = contentText;
    }

    this.emitEvent(taskId, 'tool_chain.max_iterations', {
      iterations: this.maxIterations,
      total_tokens: totalTokens,
    });
    return {
      content: finalContent || 'Max iterations reached without final answer',
      execution_trace: executionTrace,
      iterations: this.maxIterations,
      total_tokens: totalTokens,
      provider: usedProvider,
      model: usedModel,
    };
  }

  /** 从注册表构建工具 schema 列表（跳过 llm，描述截断 200，最多 10 个）。 */
  buildToolSchemas(toolNames?: string[]): Array<Record<string, unknown>> {
    const schemas: Array<Record<string, unknown>> = [];
    let availableTools: string[] = [];
    try {
      availableTools = this.toolRegistry.list_tools();
    } catch {
      availableTools = [];
    }

    const targetTools = toolNames ?? availableTools;

    for (const name of targetTools) {
      if (name === 'llm') {
        continue;
      }
      let tool: ToolSchemaLike;
      try {
        tool = this.toolRegistry.get_tool(name);
      } catch {
        continue;
      }
      const funcSchema: Record<string, unknown> = {
        name: tool.name,
        description: (tool.description ?? '').slice(0, 200),
        parameters:
          tool.parameters_schema ?? { type: 'object', properties: {} },
      };
      schemas.push({ type: 'function', function: funcSchema });
    }

    if (schemas.length > 10) {
      schemas.splice(10);
    }
    return schemas;
  }

  /** 从 LLM 响应中解析 tool_calls（供外部复用）。 */
  parseToolCalls(llmResponse: Record<string, unknown>): Array<{
    name: string;
    arguments: Record<string, unknown>;
    id: string;
  }> {
    const toolCalls = llmResponse['tool_calls'];
    if (!Array.isArray(toolCalls)) {
      return [];
    }
    const parsed: Array<{
      name: string;
      arguments: Record<string, unknown>;
      id: string;
    }> = [];
    for (const tc of toolCalls) {
      const func =
        tc !== null && typeof tc === 'object'
          ? ((tc as Record<string, unknown>)['function'] as Record<string, unknown> | undefined)
          : undefined;
      const name = String(func?.['name'] ?? '');
      const argsStr = func?.['arguments'] ?? '{}';
      const id = String((tc as Record<string, unknown>)['id'] ?? '');
      parsed.push({ name, arguments: parseArguments(argsStr), id });
    }
    return parsed;
  }

  /** 执行单个工具调用，返回 {success, result|error}。 */
  private async executeToolCall(
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const toolOutput = await this.toolRegistry.execute(toolName, {
        params: arguments_,
      });
      return { success: true, result: toolOutput.result ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /** 发射生命周期事件（无事件总线时静默）。 */
  private emitEvent(
    taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    if (this.eventBus !== undefined) {
      try {
        this.eventBus.emit(taskId, eventType, payload);
      } catch {
        // 事件发射失败不影响主流程
      }
    }
  }
}

/** 解析工具参数字符串（JSON 失败回退空对象）。 */
function parseArguments(argumentsStr: unknown): Record<string, unknown> {
  if (typeof argumentsStr === 'string') {
    try {
      const parsed: unknown = JSON.parse(argumentsStr);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (argumentsStr !== null && typeof argumentsStr === 'object' && !Array.isArray(argumentsStr)) {
    return argumentsStr as Record<string, unknown>;
  }
  return {};
}
