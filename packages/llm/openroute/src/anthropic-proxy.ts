/**
 * Anthropic Messages → OpenRoute (OpenAI Chat Completions) 协议转换。
 *
 * TS 移植自 `forgemind/anthropic_to_openroute_proxy.py`（615 行）：协议翻译纯函数
 * （anthropic_to_openai / openai_to_anthropic）+ 非流式响应合成 Anthropic SSE
 * （stream_openai_to_anthropic）+ 模型映射表。HTTP 挂载见 proxy-handler.ts。
 *
 * 行为基线：Claude CLI 2.1+ 在模型名后追加 `[1m]`/`[5m]` 等推理预算后缀，映射前剥离；
 * stop_reason 映射 stop→end_turn / length→max_tokens / tool_calls→tool_use /
 * content_filter→end_turn。
 */

// ── 模型映射 ────────────────────────────────────────────────────────────────

/** Anthropic proxy 默认 OpenRoute 模型（对齐 ANTHROPIC_PROXY_MODEL 缺省） */
export const ANTHROPIC_PROXY_DEFAULT_MODEL = 'Doubao-Seed2.0';

/** 客户端模型名 → OpenRoute 可用模型名映射（旧版 Claude 模型名） */
export const ANTHROPIC_MODEL_MAPPING: Record<string, string> = {
  'claude-3-5-sonnet-20241022': 'Doubao-Seed2.0',
  'claude-3-5-haiku-20241022': 'Doubao-Seed2.0',
  'claude-3-opus-20240229': 'Doubao-Seed2.0',
  'claude-3-sonnet-20240229': 'Doubao-Seed2.0',
  'claude-3-haiku-20240307': 'Doubao-Seed2.0',
  'claude-2.1': 'Doubao-Seed2.0',
  'claude-2': 'Doubao-Seed2.0',
  'claude-instant-1': 'Doubao-Seed2.0',
  'claude-4-sonnet': 'Doubao-Seed2.0',
  'claude-4-opus': 'Doubao-Seed2.0',
  'claude-4.8-sonnet': 'Doubao-Seed2.0',
};

/** Claude 模型名 → OpenRoute 模型名映射（Claude CLI 默认名 → 国产模型） */
export const CLAUDE_TO_OPENROUTE_MODEL: Record<string, string> = {
  // Sonnet 系列 → Doubao-Seed2.0（当前最稳定的国产模型）
  'claude-sonnet-4-6': ANTHROPIC_PROXY_DEFAULT_MODEL,
  'claude-sonnet-4-5': ANTHROPIC_PROXY_DEFAULT_MODEL,
  'claude-sonnet-4': ANTHROPIC_PROXY_DEFAULT_MODEL,
  'claude-3-7-sonnet': ANTHROPIC_PROXY_DEFAULT_MODEL,
  'claude-3-5-sonnet': ANTHROPIC_PROXY_DEFAULT_MODEL,
  // Opus 系列 → Doubao-Seed2.0（推理能力较强，作为 Opus 替代）
  'claude-opus-4-7': 'Doubao-Seed2.0',
  'claude-opus-4-5': 'Doubao-Seed2.0',
  'claude-opus-4': 'Doubao-Seed2.0',
  // Haiku 系列 → Doubao-Seed2.0（响应快）
  'claude-haiku-4-5': ANTHROPIC_PROXY_DEFAULT_MODEL,
  'claude-3-5-haiku': ANTHROPIC_PROXY_DEFAULT_MODEL,
};

/** 剥离 Claude CLI 模型名后缀（`claude-opus-4-7[1m]` → `claude-opus-4-7`） */
export function stripModelSuffix(model: string): string {
  if (model.includes('[')) {
    return model.split('[', 1)[0] ?? model;
  }
  return model;
}

// ── 协议转换: Anthropic → OpenAI ────────────────────────────────────────────

type Json = Record<string, unknown>;

function asJson(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

/** 把 Anthropic /v1/messages 请求转成 OpenAI /v1/chat/completions 请求 */
export function anthropicToOpenai(body: Json): Json {
  const messages: Array<{ role: string; content: string }> = [];

  // system（字符串或数组）
  const system = body['system'];
  if (typeof system === 'string') {
    messages.push({ role: 'system', content: system });
  } else if (Array.isArray(system)) {
    const parts: string[] = [];
    for (const item of system) {
      const obj = asJson(item);
      if (obj === undefined) continue;
      if ('text' in obj) {
        parts.push(typeof obj['text'] === 'string' ? obj['text'] : String(obj['text'] ?? ''));
      } else if ('content' in obj) {
        parts.push(String(obj['content'] ?? ''));
      }
    }
    if (parts.length > 0) {
      messages.push({ role: 'system', content: parts.join('\n') });
    }
  }

  // messages（content 字符串或数组）
  const rawMessages = Array.isArray(body['messages']) ? body['messages'] : [];
  for (const raw of rawMessages) {
    const msg = asJson(raw);
    if (msg === undefined) continue;
    const role = typeof msg['role'] === 'string' ? msg['role'] : 'user';
    const content = msg['content'];

    if (typeof content === 'string') {
      messages.push({ role, content });
    } else if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const rawItem of content) {
        const item = asJson(rawItem);
        if (item === undefined) continue;
        const type = typeof item['type'] === 'string' ? item['type'] : 'text';
        if (type === 'text') {
          textParts.push(typeof item['text'] === 'string' ? item['text'] : '');
        } else if (type === 'tool_result') {
          // tool_result → 转成文本
          const inner = item['content'];
          if (Array.isArray(inner)) {
            for (const rawInner of inner) {
              const ip = asJson(rawInner);
              if (ip !== undefined && ip['type'] === 'text') {
                textParts.push(typeof ip['text'] === 'string' ? ip['text'] : '');
              }
            }
          } else {
            textParts.push(String(inner ?? ''));
          }
        } else if (type === 'tool_use') {
          // tool_use → 转成 JSON 表示
          textParts.push(
            JSON.stringify({ tool_use: item['name'] ?? '', input: item['input'] ?? {} }),
          );
        }
      }
      messages.push({ role, content: textParts.length > 0 ? textParts.join('\n') : '' });
    }
  }

  // 模型映射（剥离 [1m]/[5m] 等推理预算后缀后再查表）
  const rawModel = typeof body['model'] === 'string' ? body['model'] : 'claude-sonnet-4';
  const mapped = ANTHROPIC_MODEL_MAPPING[rawModel] ?? rawModel;
  const baseModel = stripModelSuffix(mapped);
  const openaiModel = CLAUDE_TO_OPENROUTE_MODEL[baseModel] ?? ANTHROPIC_PROXY_DEFAULT_MODEL;

  const openaiBody: Json = {
    model: openaiModel,
    messages,
    stream: body['stream'] ?? false,
  };

  // 参数映射
  if ('max_tokens' in body) openaiBody['max_tokens'] = body['max_tokens'];
  if ('temperature' in body) openaiBody['temperature'] = body['temperature'];
  if ('top_p' in body) openaiBody['top_p'] = body['top_p'];
  if ('stop_sequences' in body) openaiBody['stop'] = body['stop_sequences'];

  // tools → OpenAI tools 格式
  const tools = Array.isArray(body['tools']) ? body['tools'] : [];
  if (tools.length > 0) {
    const oaTools: Json[] = [];
    for (const rawTool of tools) {
      const tool = asJson(rawTool);
      if (tool === undefined) continue;
      oaTools.push({
        type: 'function',
        function: {
          name: tool['name'] ?? '',
          description: tool['description'] ?? '',
          parameters: tool['input_schema'] ?? { type: 'object', properties: {} },
        },
      });
    }
    if (oaTools.length > 0) {
      openaiBody['tools'] = oaTools;
    }
  }

  return openaiBody;
}

// ── 协议转换: OpenAI → Anthropic ────────────────────────────────────────────

/** 把 OpenAI chat/completions 响应转回 Anthropic /v1/messages 响应 */
export function openaiToAnthropic(oaResp: Json, model: string): Json {
  const contentBlocks: Json[] = [];
  const choices = Array.isArray(oaResp['choices']) ? (oaResp['choices'] as Json[]) : [];
  for (const choice of choices) {
    const message = asJson(choice['message']) ?? {};
    const text = message['content'];
    if (typeof text === 'string' && text !== '') {
      contentBlocks.push({ type: 'text', text });
    }
    // tool_calls → tool_use blocks
    const toolCalls = Array.isArray(message['tool_calls']) ? (message['tool_calls'] as Json[]) : [];
    for (const tc of toolCalls) {
      const fn = asJson(tc['function']) ?? {};
      let args: unknown = {};
      try {
        args = JSON.parse(typeof fn['arguments'] === 'string' ? fn['arguments'] : '{}');
      } catch {
        args = {};
      }
      contentBlocks.push({
        type: 'tool_use',
        id: typeof tc['id'] === 'string' ? tc['id'] : 'tool_0',
        name: fn['name'] ?? '',
        input: args,
      });
    }
  }

  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '' });
  }

  // stop_reason 映射
  const firstChoice = asJson(choices[0]) ?? {};
  const finishReason = typeof firstChoice['finish_reason'] === 'string' ? firstChoice['finish_reason'] : 'stop';
  const stopReason =
    ({ stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', content_filter: 'end_turn' } as Record<string, string>)[
      finishReason
    ] ?? 'end_turn';

  const usage = asJson(oaResp['usage']) ?? {};
  const oaId = typeof oaResp['id'] === 'string' ? oaResp['id'] : 'unknown';
  return {
    id: `msg_${oaId}`,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0,
      output_tokens:
        typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0,
    },
  };
}

// ── 流式合成: 非流式响应 → Anthropic SSE ────────────────────────────────────

/** SSE 合成固定 chunk 大小（对齐 CHUNK_SIZE=64） */
export const ANTHROPIC_SSE_CHUNK_SIZE = 64;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 把 OpenAI 非流式响应合成为 Anthropic SSE 事件流。
 *
 * OpenRoute 的 stream 实现有 bug（返回非 SSE JSON），所以总是以 stream:false 调用，
 * 在这里把完整响应切分成 SSE 事件返回给 claude CLI（message_start → content_block_* →
 * message_delta → message_stop）。
 */
export async function* streamOpenaiToAnthropic(
  oaData: Json,
  model: string,
  msgId: string,
): AsyncGenerator<string> {
  // 提取完整文本 + tool_calls
  let fullText = '';
  let finishReason = 'stop';
  const toolCallsBlocks: Array<{ id: string; name: string; input: unknown }> = [];
  const choices = Array.isArray(oaData['choices']) ? (oaData['choices'] as Json[]) : [];
  for (const choice of choices) {
    const message = asJson(choice['message']) ?? {};
    const text = typeof message['content'] === 'string' ? message['content'] : '';
    if (text !== '') {
      fullText += text;
    }
    if (typeof choice['finish_reason'] === 'string') {
      finishReason = choice['finish_reason'];
    }
    const toolCalls = Array.isArray(message['tool_calls']) ? (message['tool_calls'] as Json[]) : [];
    for (const tc of toolCalls) {
      const fn = asJson(tc['function']) ?? {};
      let args: unknown = {};
      try {
        args = JSON.parse(typeof fn['arguments'] === 'string' ? fn['arguments'] : '{}');
      } catch {
        args = {};
      }
      toolCallsBlocks.push({
        id: typeof tc['id'] === 'string' ? tc['id'] : 'tool_0',
        name: typeof fn['name'] === 'string' ? fn['name'] : '',
        input: args,
      });
    }
  }

  const usage = asJson(oaData['usage']) ?? {};

  // message_start
  yield sse('message_start', {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0,
        output_tokens: 0,
      },
    },
  });

  // 文本 content block（index=0）
  yield sse('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });

  // 按固定 chunk 大小切分文本，模拟流式增量
  for (let i = 0; i < fullText.length; i += ANTHROPIC_SSE_CHUNK_SIZE) {
    yield sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: fullText.slice(i, i + ANTHROPIC_SSE_CHUNK_SIZE) },
    });
  }

  yield sse('content_block_stop', { type: 'content_block_stop', index: 0 });

  // tool_use content blocks（index=1, 2, ...）
  for (const [offset, tc] of toolCallsBlocks.entries()) {
    const index = offset + 1;
    yield sse('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} },
    });
    yield sse('content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(tc.input) },
    });
    yield sse('content_block_stop', { type: 'content_block_stop', index });
  }

  // message_delta（stop_reason）
  const stopReason =
    ({ stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use' } as Record<string, string>)[
      finishReason
    ] ?? 'end_turn';
  yield sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: fullText.length },
  });

  // message_stop
  yield 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
}
