/**
 * @flowforge/core-state — F27 状态机族 Cordis 插件。
 *
 * 挂载 `ctx.forgeState`，统一提供状态域能力（TS 重写自 Python core/）：
 *   - namespace: NamespaceRegistry（core/namespace.py）
 *   - handoff: HandoffManager（core/handoff.py）
 *   - stateUpdates: StateUpdateMapper（core/state_updates.py）
 *   - stateMapper: StateMapper/ParamMapping（core/state_mapper.py FWK-04）
 *   - variableResolver: VariableResolver（core/variable_resolver.py）
 *   - fieldConditionGate: FieldConditionGate（core/field_condition_gate.py）
 *   - contextLayerManager: ContextLayerManager（core/context_layer_manager.py）
 *   - stateQueryTool: StateQueryTool 基类（core/state_query_tool.py）
 *   - toolChainExecutor: ToolChainExecutor ReAct 循环（core/tool_chain_executor.py）
 *
 * 依赖（Memory / LLM / ToolRegistry / EventBus / web_search）均通过
 * 接口注入，与 Python 版 duck typing 对应。
 */

import { Context, Service } from '@flowforge/cordis';
import { ContextLayerManager, type ContextLayerConfig, type ContextLlmLike, type ContextMemoryLike } from './context-layer-manager.js';
import { FieldConditionGate, type FieldGateDefinition } from './field-condition-gate.js';
import { HandoffManager, type AgentRegistryLike } from './handoff.js';
import { StateMapper, type ParamMappingInput } from './state-mapper.js';
import { StateQueryTool, type QueryMemoryLike, type WebSearchLike } from './state-query-tool.js';
import { StateUpdateMapper } from './state-updates.js';
import { ToolChainExecutor, type EventBusLike, type LlmClientLike, type ToolRegistryLike } from './tool-chain-executor.js';
import { createResolverFromState, VariableResolver } from './variable-resolver.js';

export * from './namespace.js';
export * from './handoff.js';
export * from './state-updates.js';
export * from './state-mapper.js';
export * from './variable-resolver.js';
export * from './field-condition-gate.js';
export * from './context-layer-manager.js';
export * from './state-query-tool.js';
export * from './tool-chain-executor.js';

/** 外部依赖注入面（对齐 Python duck typing）。 */
export interface StateDependencies {
  /** agent 注册表（handoff 目标解析）。 */
  readonly agentRegistry?: AgentRegistryLike | undefined;
  /** 工作记忆（context layer / state query）。 */
  readonly memory?: ContextMemoryLike & QueryMemoryLike | undefined;
  /** LLM 客户端（context layer / tool chain）。 */
  readonly llmClient?: ContextLlmLike & LlmClientLike | undefined;
  /** 工具注册表（tool chain）。 */
  readonly toolRegistry?: ToolRegistryLike | undefined;
  /** 事件总线（tool chain 生命周期事件）。 */
  readonly eventBus?: EventBusLike | undefined;
  /** web_search 工具（state query 降级）。 */
  readonly webSearch?: WebSearchLike | undefined;
}

/** StateService 配置。 */
export interface StateServiceOptions extends StateDependencies {
  /** 门禁定义（name → 定义），缺省空。 */
  readonly gates?: Record<string, FieldGateDefinition> | undefined;
  /** 上下文层级配置（缺省 DEFAULT_CONFIG）。 */
  readonly contextLayerConfig?: ContextLayerConfig | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 状态机域：命名空间 / 交接 / 状态映射 / 变量解析 / 门禁 / 上下文层级 / 工具链 */
    forgeState: StateService;
  }
}

/**
 * 状态机域服务 — F27 状态机族统一入口。
 *
 * 组装 9 个状态模块，外部依赖通过 options 注入（agentRegistry / memory /
 * llmClient / toolRegistry / eventBus / webSearch）。
 */
export class StateService extends Service {
  /** 命名空间注册表（core/namespace.py）。 */
  readonly handoff: HandoffManager;
  /** 状态更新映射（core/state_updates.py）。 */
  readonly stateUpdates: StateUpdateMapper;
  /** 字段条件门禁（core/field_condition_gate.py）。 */
  readonly fieldConditionGate: FieldConditionGate;
  /** 上下文层级管理器（core/context_layer_manager.py）。 */
  readonly contextLayerManager: ContextLayerManager | undefined;
  /** 外部依赖注入面。 */
  readonly deps: StateDependencies;

  constructor(ctx: Context, options: StateServiceOptions = {}) {
    super(ctx, 'forgeState');
    this.deps = {
      agentRegistry: options.agentRegistry,
      memory: options.memory,
      llmClient: options.llmClient,
      toolRegistry: options.toolRegistry,
      eventBus: options.eventBus,
      webSearch: options.webSearch,
    };
    this.handoff = new HandoffManager(this.deps.agentRegistry ?? { get: () => undefined, list: () => [] });
    this.stateUpdates = new StateUpdateMapper();
    this.fieldConditionGate = new FieldConditionGate(options.gates ?? {});
    this.contextLayerManager =
      this.deps.memory !== undefined
        ? new ContextLayerManager(this.deps.memory, this.deps.llmClient, options.contextLayerConfig)
        : undefined;
  }

  /** 从配置构建 StateMapper（FWK-04 param_mapping）。 */
  createStateMapper(
    mappings: Record<string, string> | ParamMappingInput[],
  ): StateMapper {
    if (Array.isArray(mappings)) {
      return new StateMapper(
        mappings.map((m) => ({
          paramName: m.paramName,
          source: m.source,
          required: m.required ?? false,
          default: m.default ?? null,
          ...(m.transform !== undefined ? { transform: m.transform } : {}),
        })),
      );
    }
    return StateMapper.fromConfig(mappings);
  }

  /** 从 YAML 内容构建 FieldConditionGate。 */
  static gateFromYaml(yamlContent: string): FieldConditionGate {
    return FieldConditionGate.fromYaml(yamlContent);
  }

  /** 从上下文构建 VariableResolver（state/params/result/outputs）。 */
  createVariableResolver(options: {
    state?: Record<string, unknown>;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    config?: Record<string, unknown>;
  }): VariableResolver {
    return createResolverFromState(
      options.state ?? {},
      options.params ?? {},
      options.result ?? {},
      options.outputs ?? {},
      options.config ?? {},
    );
  }

  /** 构建状态查询工具基类（子类可继承覆盖 doSearch）。 */
  createStateQueryTool(
    options: ConstructorParameters<typeof StateQueryTool>[0] & {
      name?: string;
      description?: string;
    },
  ): StateQueryTool {
    return new StateQueryTool({
      ...options,
      ...(this.deps.memory !== undefined ? { memory: this.deps.memory } : {}),
      ...(this.deps.webSearch !== undefined ? { webSearch: this.deps.webSearch } : {}),
    });
  }

  /** 构建 ReAct 工具链执行器（需注入 llmClient + toolRegistry）。 */
  createToolChainExecutor(options?: {
    maxIterations?: number;
  }): ToolChainExecutor {
    if (this.deps.llmClient === undefined || this.deps.toolRegistry === undefined) {
      throw new Error(
        'forgeState.createToolChainExecutor: llmClient 与 toolRegistry 依赖未注入',
      );
    }
    return new ToolChainExecutor(
      this.deps.llmClient,
      this.deps.toolRegistry,
      this.deps.eventBus,
      options?.maxIterations ?? 3,
    );
  }
}

export default function Plugin(
  ctx: Context,
  options: StateServiceOptions = {},
): void {
  ctx.forgeState = new StateService(ctx, options);
}
