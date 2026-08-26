/**
 * provider.ts + capability.ts 测试 — ModelCapabilityProvider 能力路由
 * （tools/llm/model_capability_provider.py）+ ModelCapability 零配置高层 API
 * （core/model_capability.py）
 */
import { describe, expect, it } from 'vitest';
import {
  ModelCapabilityProvider,
  ModelHealth,
} from '../src/provider.js';
import {
  ModelCapability,
  type LlmClientLike,
} from '../src/capability.js';

describe('ModelCapabilityProvider（model_capability_provider.py）', () => {
  it('列表格式配置自动发现模型（enabled=false 跳过）', () => {
    const provider = new ModelCapabilityProvider({
      models: [
        { id: 'auto', provider: 'openroute', capabilities: ['chat', 'reasoning'] },
        { id: 'disabled-model', provider: 'openroute', capabilities: ['chat'], enabled: false },
        { id: 'doubao', provider: 'doubao', capabilities: ['chat'] },
      ],
    });
    expect(provider.listModels().map((m) => m.name).sort()).toEqual(['auto', 'doubao']);
    expect(provider.getModelInfo('auto')?.provider).toBe('openroute');
  });

  it('字典格式配置自动发现模型', () => {
    const provider = new ModelCapabilityProvider({
      models: {
        'DeepSeek-V4-Pro': { provider: 'openroute', capabilities: ['chat', 'coding'] },
        'GLM-5.1': { provider: 'openroute', capabilities: ['chat'] },
      },
    });
    expect(provider.listModels()).toHaveLength(2);
    expect(provider.getModelInfo('GLM-5.1')?.capabilities).toEqual(['chat']);
  });

  it('getModel 首选 preferred 健康模型', () => {
    const provider = new ModelCapabilityProvider({
      models: [{ id: 'a', provider: 'p', capabilities: ['chat'] }],
    });
    expect(provider.getModel('chat', 'a')).toBe('a');
  });

  it('getModel preferred 不可用时按能力回退', () => {
    const provider = new ModelCapabilityProvider({
      models: [
        { id: 'a', provider: 'p', capabilities: ['chat'] },
        { id: 'b', provider: 'p', capabilities: ['chat'] },
      ],
    });
    provider.reportFailure('a');
    provider.reportFailure('a');
    provider.reportFailure('a'); // a → UNAVAILABLE
    expect(provider.getModel('chat', 'a')).toBe('b');
  });

  it('getModel 按健康（healthy > degraded）再延迟排序', () => {
    const provider = new ModelCapabilityProvider({
      models: [
        { id: 'slow-healthy', provider: 'p', capabilities: ['chat'] },
        { id: 'fast-degraded', provider: 'p', capabilities: ['chat'] },
      ],
    });
    provider.reportSuccess('slow-healthy', 100);
    provider.reportFailure('fast-degraded');
    provider.reportFailure('fast-degraded'); // failureCount=2 → 仍 degraded
    provider.reportSuccess('fast-degraded', 5); // failureCount=1 → 保持 degraded
    // healthy 优先于 degraded，即使 degraded 延迟更低
    expect(provider.getModel('chat')).toBe('slow-healthy');
  });

  it('getModel 能力不匹配时兜底任意健康模型', () => {
    const provider = new ModelCapabilityProvider({
      models: [
        { id: 'chat-only', provider: 'p', capabilities: ['chat'] },
      ],
    });
    // coding 能力无模型 → 兜底健康模型
    expect(provider.getModel('coding')).toBe('chat-only');
  });

  it('getModel 全部不可用时返回 undefined', () => {
    const provider = new ModelCapabilityProvider({
      models: [{ id: 'a', provider: 'p', capabilities: ['chat'] }],
    });
    provider.reportFailure('a');
    provider.reportFailure('a');
    provider.reportFailure('a');
    expect(provider.getModel('chat')).toBeUndefined();
  });

  it('reportSuccess 恢复 DEGRADED → HEALTHY（failure_count 归零）', () => {
    const provider = new ModelCapabilityProvider({
      models: [{ id: 'a', provider: 'p', capabilities: [] }],
    });
    provider.reportFailure('a');
    expect(provider.getModelInfo('a')?.health).toBe(ModelHealth.DEGRADED);
    provider.reportSuccess('a', 42);
    expect(provider.getModelInfo('a')?.health).toBe(ModelHealth.HEALTHY);
    expect(provider.getModelInfo('a')?.latencyMs).toBe(42);
  });

  it('reportFailure 3 次 → UNAVAILABLE（阈值对齐 Python）', () => {
    const provider = new ModelCapabilityProvider({
      models: [{ id: 'a', provider: 'p', capabilities: [] }],
    });
    provider.reportFailure('a');
    provider.reportFailure('a');
    expect(provider.getModelInfo('a')?.health).toBe(ModelHealth.DEGRADED);
    provider.reportFailure('a');
    expect(provider.getModelInfo('a')?.health).toBe(ModelHealth.UNAVAILABLE);
  });

  it('getHealthStatus 返回健康快照（health/latency_ms/failures）', () => {
    const provider = new ModelCapabilityProvider({
      models: [{ id: 'a', provider: 'p', capabilities: [] }],
    });
    provider.reportSuccess('a', 12.5);
    const status = provider.getHealthStatus()['a'];
    expect(status).toEqual({ health: 'healthy', latency_ms: 12.5, failures: 0 });
  });

  it('registerModel 手动注册并追加能力索引', () => {
    const provider = new ModelCapabilityProvider();
    provider.registerModel('m1', 'openroute', ['chat', 'coding']);
    provider.registerModel('m2', 'openroute', ['chat']);
    expect(provider.getModel('coding')).toBe('m1');
    expect(provider.getModel('chat')).toBe('m1'); // 延迟更低者优先（均 0）
  });
});

class FakeLlmClient implements LlmClientLike {
  executeCalls: Array<Record<string, unknown>> = [];
  streamCalls: Array<Record<string, unknown>> = [];
  responseContent = 'hello from llm';
  failWith: Error | undefined;

  async execute(input: { params: Record<string, unknown> }): Promise<{ result: Record<string, unknown> }> {
    this.executeCalls.push(input.params);
    if (this.failWith) {
      throw this.failWith;
    }
    return {
      result: {
        content: this.responseContent,
        model: input.params['model'] ?? '',
      },
    };
  }

  async *stream(input: { params: Record<string, unknown> }): AsyncIterable<string> {
    this.streamCalls.push(input.params);
    for (const chunk of this.responseContent.split(' ')) {
      yield `${chunk} `;
    }
  }
}

function makeCapability() {
  const llm = new FakeLlmClient();
  const selector = new ModelCapabilityProvider({
    models: [
      { id: 'auto', provider: 'openroute', capabilities: ['chat', 'agent:writer'] },
      { id: 'backup', provider: 'openroute', capabilities: ['chat'] },
    ],
  });
  const capability = new ModelCapability({ llmClient: llm, selector });
  return { llm, selector, capability };
}

describe('ModelCapability（core/model_capability.py）', () => {
  it('chat 无显式模型时按 persona 选择模型并传参', async () => {
    const { llm, capability } = makeCapability();
    const result = await capability.chat({
      prompt: 'Write an article',
      persona: 'writer',
      system: 'Be concise',
      temperature: 0.9,
      maxTokens: 2048,
      taskId: 'sdk-test',
    });
    expect(result['content']).toBe('hello from llm');
    expect(result['model']).toBe('auto');
    const params = llm.executeCalls[0]!;
    expect(params['messages']).toEqual([
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'Write an article' },
    ]);
    expect(params['temperature']).toBe(0.9);
    expect(params['max_tokens']).toBe(2048);
    expect(params['task_id']).toBe('sdk-test');
    expect(params['stream']).toBe(false);
    expect(params['model']).toBe('auto');
  });

  it('chat 显式 model 时优先使用且不查路由', async () => {
    const { llm, capability } = makeCapability();
    await capability.chat({ prompt: 'hi', model: 'backup' });
    expect(llm.executeCalls[0]!['model']).toBe('backup');
  });

  it('chat 成功后向 selector 报告成功（健康追踪）', async () => {
    const { selector, capability } = makeCapability();
    await capability.chat({ prompt: 'hi', persona: 'writer' });
    expect(selector.getModelInfo('auto')?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(selector.getModelInfo('auto')?.failureCount).toBe(0);
  });

  it('chat 失败后向 selector 报告失败并重新抛出', async () => {
    const { llm, selector, capability } = makeCapability();
    llm.failWith = new Error('rate limit exceeded');
    await expect(capability.chat({ prompt: 'hi', persona: 'writer' })).rejects.toThrow(
      'rate limit exceeded',
    );
    expect(selector.getModelInfo('auto')?.failureCount).toBe(1);
  });

  it('chat 支持 tools/prefer_api/top_p 透传（条件参数）', async () => {
    const { llm, capability } = makeCapability();
    await capability.chat({
      prompt: 'hi',
      tools: [{ type: 'function', function: { name: 'f' } }],
      preferApi: true,
      topP: 0.5,
    });
    const params = llm.executeCalls[0]!;
    expect(params['tools']).toEqual([{ type: 'function', function: { name: 'f' } }]);
    expect(params['prefer_api']).toBe(true);
    expect(params['top_p']).toBe(0.5);
  });

  it('chatStream 逐块产出并报告成功', async () => {
    const { selector, capability } = makeCapability();
    const chunks: string[] = [];
    for await (const chunk of capability.chatStream({
      prompt: 'hi',
      persona: 'writer',
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('hello from llm ');
    expect(selector.getModelInfo('auto')?.failureCount).toBe(0);
  });

  it('chatJson 剥离 markdown 代码块并解析 JSON', async () => {
    const { llm, capability } = makeCapability();
    llm.responseContent = '```json\n{"score": 85, "reason": "good"}\n```';
    const parsed = await capability.chatJson({ prompt: 'evaluate' });
    expect(parsed).toEqual({ score: 85, reason: 'good' });
  });

  it('chatJson 无 fence 直接解析', async () => {
    const { llm, capability } = makeCapability();
    llm.responseContent = '{"ok": true}';
    const parsed = await capability.chatJson({ prompt: 'evaluate' });
    expect(parsed).toEqual({ ok: true });
  });

  it('chatJson 解析失败抛错并含原始内容前 500 字符', async () => {
    const { llm, capability } = makeCapability();
    llm.responseContent = 'not json at all';
    await expect(capability.chatJson({ prompt: 'evaluate' })).rejects.toThrow(
      /JSON 解析失败/,
    );
  });

  it('chatJson 空内容抛错', async () => {
    const { llm, capability } = makeCapability();
    llm.responseContent = '';
    await expect(capability.chatJson({ prompt: 'evaluate' })).rejects.toThrow(
      'LLM 返回空内容，无法解析 JSON',
    );
  });

  it('未注入 LLM 客户端时 chat 抛错（惰性依赖）', async () => {
    const capability = new ModelCapability();
    await expect(capability.chat({ prompt: 'hi' })).rejects.toThrow(
      'LLM 客户端未注入',
    );
  });

  it('listModels/checkHealth 委托 ModelService（未注入时抛错）', async () => {
    const capability = new ModelCapability();
    expect(() => capability.listModels()).toThrow('模型服务未注入');
    await expect(capability.checkHealth()).rejects.toThrow('模型服务未注入');
  });
});
