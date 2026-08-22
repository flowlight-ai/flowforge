/**
 * @flowforge/forgekin-external-agents — LLMClient Helm 适配器
 *
 * 对齐 Python `core/helm_adapter.py`：把 LLM 客户端生命周期事件桥接到
 * HelmEventEmitter（emit_llm_start / emit_llm_reasoning / emit_llm_stream /
 * emit_llm_end），并维护任务级全局 emitter 的 set/get。
 */

/** 消息片段（对话消息的最小形状，供 on_start 截断预览） */
export interface HelmChatMessage {
  readonly role?: string | undefined;
  readonly content?: unknown;
}

/** Helm 事件发射器契约（对齐 HelmEventEmitter emit_llm_* 系列） */
export interface HelmEventEmitter {
  emitLlmStart(
    taskId: string,
    agentName: string,
    model: string,
    messages: HelmChatMessage[] | null,
  ): Promise<void> | void;
  emitLlmReasoning(taskId: string, agentName: string, delta: string): Promise<void> | void;
  emitLlmStream(taskId: string, agentName: string, delta: string): Promise<void> | void;
  emitLlmEnd(
    taskId: string,
    agentName: string,
    fullResponse: string,
    tokens: number,
    error?: string | null,
  ): Promise<void> | void;
}

/** Helm 模式适配器：把 LLM 生命周期回调包装为 helm.*.llm.* 事件（对齐 LLMClientHelmAdapter） */
export class LLMClientHelmAdapter {
  readonly emitter: HelmEventEmitter;
  readonly taskId: string;

  constructor(emitter: HelmEventEmitter, taskId: string) {
    this.emitter = emitter;
    this.taskId = taskId;
  }

  /** 调用开始：仅转发前 3 条消息作为预览（对齐 messages[:3]） */
  async onStart(agentName: string, model: string, messages: HelmChatMessage[] | null): Promise<void> {
    await this.emitter.emitLlmStart(this.taskId, agentName, model, messages ? messages.slice(0, 3) : null);
  }

  async onReasoning(agentName: string, delta: string): Promise<void> {
    await this.emitter.emitLlmReasoning(this.taskId, agentName, delta);
  }

  async onStream(agentName: string, delta: string): Promise<void> {
    await this.emitter.emitLlmStream(this.taskId, agentName, delta);
  }

  /** 调用结束：完整响应截断至 2000 字符转发（对齐 full_response[:2000]） */
  async onEnd(agentName: string, fullResponse: string, tokens: number, error?: string | null): Promise<void> {
    await this.emitter.emitLlmEnd(this.taskId, agentName, fullResponse.slice(0, 2000), tokens, error ?? null);
  }
}

let helmEmitter: HelmEventEmitter | null = null;

/** 设置任务级全局 Helm emitter（对齐 g_llm_client_set_helm_emitter） */
export function setHelmEmitter(emitter: HelmEventEmitter | null): void {
  helmEmitter = emitter;
}

/** 获取任务级全局 Helm emitter（对齐 g_llm_client_get_helm_emitter） */
export function getHelmEmitter(): HelmEventEmitter | null {
  return helmEmitter;
}
