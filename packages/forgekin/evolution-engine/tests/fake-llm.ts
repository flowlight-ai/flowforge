/**
 * 测试用 LLM 客户端 stub（unit 层，符合规范冲突裁决：dsh llm-mock-server 仅限 unit/契约层）。
 * 仅提供 chat() 最小实现，供 SelfDevRuntime 装配测试使用。
 */

import type { LlmChatClient, LlmChatMessage, LlmChatOptions, LlmChatResult } from '@flowforge/forgekin-loops';

export class FakeLlmChatClient implements LlmChatClient {
  readonly calls: Array<{ messages: LlmChatMessage[]; options?: LlmChatOptions }> = [];

  async chat(messages: LlmChatMessage[], options?: LlmChatOptions): Promise<LlmChatResult> {
    this.calls.push({ messages, ...(options === undefined ? {} : { options }) });
    return { content: '{}', model: 'fake-model' };
  }
}
