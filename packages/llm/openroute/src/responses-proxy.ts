/**
 * OpenAI Responses API → OpenRoute (Chat Completions) 协议转换。
 *
 * TS 移植自 `forgemind/responses_to_openroute_proxy.py`（542 行）：协议翻译纯函数
 * （responses_to_chat / chat_to_responses）+ 非流式响应合成 Responses SSE
 * （stream_chat_to_responses）+ 模型映射表。HTTP 挂载见 proxy-handler.ts。
 *
 * 行为基线：OpenAI Codex CLI 强制使用 Responses API（/v1/responses）；reasoning
 * content 跳过；tool_calls 输出为 function_call 项（arguments 为 JSON 字符串）。
 */

type Json = Record<string, unknown>;

function asJson(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

// ── 模型映射 ────────────────────────────────────────────────────────────────

/** Responses proxy 默认 OpenRoute 模型（对齐 RESPONSES_PROXY_MODEL 缺省） */
export const RESPONSES_PROXY_DEFAULT_MODEL = 'Doubao-Seed2.0';

/** 客户端模型名 → OpenRoute 可用模型名映射 */
export const RESPONSES_MODEL_MAPPING: Record<string, string> = {
  'gpt-4o': 'Doubao-Seed2.0',
  'gpt-4o-mini': 'Doubao-Seed2.0',
  'gpt-4-turbo': 'Doubao-Seed2.0',
  'gpt-4': 'Doubao-Seed2.0',
  'gpt-3.5-turbo': 'Doubao-Seed2.0',
  'gpt-5': 'GPT-5.5',
  'gpt-5-mini': 'GPT-5.5',
  'gpt-5.5': 'GPT-5.5',
  o1: 'Doubao-Seed2.0',
  'o1-mini': 'Doubao-Seed2.0',
  'o1-preview': 'Doubao-Seed2.0',
  o3: 'Doubao-Seed2.0',
  'o3-mini': 'Doubao-Seed2.0',
  'o4-mini': 'Doubao-Seed2.0',
  'text-davinci-003': 'Doubao-Seed2.0',
};

// ── 协议转换: Responses → Chat Completions ──────────────────────────────────

/** 把 OpenAI Responses API 请求转成 Chat Completions 请求 */
export function responsesToChat(body: Json): Json {
  const messages: Array<{ role: string; content: string }> = [];

  // instructions → system message
  const instructions = body['instructions'];
  if (typeof instructions === 'string' && instructions !== '') {
    messages.push({ role: 'system', content: instructions });
  }

  // input → messages（字符串或数组）
  const input = body['input'];
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const rawItem of input) {
      const item = asJson(rawItem);
      if (item === undefined) continue;
      const role = typeof item['role'] === 'string' ? item['role'] : 'user';
      const content = item['content'];
      if (typeof content === 'string') {
        messages.push({ role, content });
      } else if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const rawC of content) {
          const c = asJson(rawC);
          if (c === undefined) continue;
          if (c['type'] === 'text' || 'text' in c) {
            textParts.push(typeof c['text'] === 'string' ? c['text'] : '');
          } else if (c['type'] === 'output_text') {
            textParts.push(typeof c['text'] === 'string' ? c['text'] : '');
          } else if (c['type'] === 'reasoning') {
            // skip reasoning content
          }
        }
        if (textParts.length > 0) {
          messages.push({ role, content: textParts.join('\n') });
        }
      } else if (content !== undefined && content !== null) {
        messages.push({ role, content: String(content) });
      }
    }
  }

  // 模型
  const rawModel = typeof body['model'] === 'string' ? body['model'] : RESPONSES_PROXY_DEFAULT_MODEL;
  const model = RESPONSES_MODEL_MAPPING[rawModel] ?? rawModel;

  const chatBody: Json = {
    model,
    messages,
    stream: body['stream'] ?? false,
  };

  // 参数映射
  if ('max_output_tokens' in body) chatBody['max_tokens'] = body['max_output_tokens'];
  if ('temperature' in body) chatBody['temperature'] = body['temperature'];
  if ('top_p' in body) chatBody['top_p'] = body['top_p'];

  // tools（Responses API tools 数组，function 类型原样，其余包装成 function 格式）
  const tools = Array.isArray(body['tools']) ? body['tools'] : [];
  if (tools.length > 0) {
    const oaTools: Json[] = [];
    for (const rawTool of tools) {
      const tool = asJson(rawTool);
      if (tool === undefined) continue;
      if (tool['type'] === 'function') {
        oaTools.push(tool);
      } else {
        oaTools.push({
          type: 'function',
          function: {
            name: tool['name'] ?? '',
            description: tool['description'] ?? '',
            parameters: tool['parameters'] ?? { type: 'object', properties: {} },
          },
        });
      }
    }
    if (oaTools.length > 0) {
      chatBody['tools'] = oaTools;
    }
  }

  return chatBody;
}

// ── 协议转换: Chat Completions → Responses ──────────────────────────────────

/** 把 Chat Completions 响应转回 Responses API 格式 */
export function chatToResponses(oaResp: Json, model: string): Json {
  const output: Json[] = [];
  const choices = Array.isArray(oaResp['choices']) ? (oaResp['choices'] as Json[]) : [];
  for (const [index, choice] of choices.entries()) {
    const message = asJson(choice['message']) ?? {};
    const text = message['content'];
    const contentBlocks: Json[] = [];
    if (typeof text === 'string' && text !== '') {
      contentBlocks.push({ type: 'output_text', text, annotations: [] });
    }
    // tool_calls
    const toolCalls = Array.isArray(message['tool_calls']) ? (message['tool_calls'] as Json[]) : [];
    for (const tc of toolCalls) {
      const fn = asJson(tc['function']) ?? {};
      let args: unknown = {};
      try {
        args = JSON.parse(typeof fn['arguments'] === 'string' ? fn['arguments'] : '{}');
      } catch {
        args = {};
      }
      const callId = typeof tc['id'] === 'string' ? tc['id'] : 'call_0';
      output.push({
        type: 'function_call',
        id: callId,
        call_id: callId,
        name: fn['name'] ?? '',
        arguments: JSON.stringify(args),
      });
    }

    if (contentBlocks.length > 0) {
      output.push({
        type: 'message',
        id: `msg_${index}`,
        role: 'assistant',
        status: 'completed',
        content: contentBlocks,
      });
    }
  }

  const usage = asJson(oaResp['usage']) ?? {};
  const oaId = typeof oaResp['id'] === 'string' ? oaResp['id'] : 'unknown';
  return {
    id: `resp_${oaId}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    output,
    status: 'completed',
    usage: {
      input_tokens: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0,
      output_tokens:
        typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0,
      total_tokens: typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : 0,
    },
  };
}

// ── 流式合成 ────────────────────────────────────────────────────────────────

/** SSE 合成固定 chunk 大小（对齐 CHUNK_SIZE=64） */
export const RESPONSES_SSE_CHUNK_SIZE = 64;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 从 OpenAI 非流式响应合成 Responses API SSE 流。
 *
 * Responses API 流式事件：response.created → response.output_item.added →
 * response.content_part.added → response.output_text.delta → response.content_part.done
 * → response.output_item.done → response.completed。
 */
export async function* streamChatToResponses(
  oaData: Json,
  model: string,
  respId: string,
): AsyncGenerator<string> {
  // 提取完整文本和 tool_calls
  let fullText = '';
  const toolCallsList: Array<{ id: string; call_id: string; name: string; arguments: string }> = [];
  const choices = Array.isArray(oaData['choices']) ? (oaData['choices'] as Json[]) : [];
  for (const choice of choices) {
    const message = asJson(choice['message']) ?? {};
    const text = typeof message['content'] === 'string' ? message['content'] : '';
    if (text !== '') {
      fullText += text;
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
      const callId = typeof tc['id'] === 'string' ? tc['id'] : 'call_0';
      toolCallsList.push({
        id: callId,
        call_id: callId,
        name: typeof fn['name'] === 'string' ? fn['name'] : '',
        arguments: JSON.stringify(args),
      });
    }
  }
  const usage = asJson(oaData['usage']) ?? {};

  // response.created
  yield sse('response.created', {
    type: 'response.created',
    response: { id: respId, object: 'response', status: 'in_progress', model, output: [] },
  });

  // response.output_item.added（message）
  const msgId = `msg_${Date.now()}`;
  yield sse('response.output_item.added', {
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'message', id: msgId, role: 'assistant', status: 'in_progress', content: [] },
  });

  // response.content_part.added
  yield sse('response.content_part.added', {
    type: 'response.content_part.added',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });

  // 把完整文本按固定 chunk 切分，模拟流式增量
  for (let i = 0; i < fullText.length; i += RESPONSES_SSE_CHUNK_SIZE) {
    yield sse('response.output_text.delta', {
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      delta: fullText.slice(i, i + RESPONSES_SSE_CHUNK_SIZE),
    });
  }

  // response.content_part.done
  yield sse('response.content_part.done', {
    type: 'response.content_part.done',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: fullText, annotations: [] },
  });

  // response.output_item.done
  yield sse('response.output_item.done', {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'message',
      id: msgId,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: fullText, annotations: [] }],
    },
  });

  // response.completed
  yield sse('response.completed', {
    type: 'response.completed',
    response: {
      id: respId,
      object: 'response',
      status: 'completed',
      model,
      output: [
        {
          type: 'message',
          id: msgId,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: fullText, annotations: [] }],
        },
      ],
      usage: {
        input_tokens: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0,
        output_tokens:
          typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0,
        total_tokens: typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : 0,
      },
    },
  });
}
