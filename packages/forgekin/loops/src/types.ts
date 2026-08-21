/**
 * loops 域外部依赖契约 — LLM 通道（F045 Trae 桥接）与治理层（ForgeMindEngine 三模式）。
 * 对齐 Python `evolution/self_dev_base.py` 构造注入的 trae_client / evolution_engine。
 */

/** LLM 消息 */
export interface LlmChatMessage {
  readonly role: string;
  readonly content: string;
}

/** LLM 聊天结果 */
export interface LlmChatResult {
  readonly content: string;
  readonly model?: string | undefined;
}

export interface LlmChatOptions {
  readonly context?: unknown;
  readonly temperature?: number | undefined;
}

/** LLM 客户端最小契约（F045 TraeLLMClient.chat 的 TS 化） */
export interface LlmChatClient {
  chat(messages: LlmChatMessage[], options?: LlmChatOptions | undefined): Promise<LlmChatResult>;
}

/** 治理层执行请求（ForgeMindEngine.execute 的 TS 化：mode/action/payload） */
export interface PersistEngineRequest {
  readonly mode: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
}

/** 治理层执行结果 */
export type PersistEngineResult = Record<string, unknown>;

/** 治理层最小契约（ForgeMindEngine 三模式：knowledge_evolution / process_evolution） */
export interface PersistEngine {
  execute(request: PersistEngineRequest): Promise<PersistEngineResult>;
}

/** 缺省治理层 stub：记录调用但不做实际沉淀（测试/无引擎场景） */
export class NoopPersistEngine implements PersistEngine {
  readonly calls: PersistEngineRequest[] = [];

  async execute(request: PersistEngineRequest): Promise<PersistEngineResult> {
    this.calls.push(request);
    if (request.action === 'create_episode_card') {
      return { episode_id: `ep-${this.calls.length}` };
    }
    if (request.action === 'distill_episode') {
      return { method_id: `method-${this.calls.length}` };
    }
    if (request.action === 'create_proposal') {
      return { proposal_id: `proposal-${this.calls.length}` };
    }
    return {};
  }
}
