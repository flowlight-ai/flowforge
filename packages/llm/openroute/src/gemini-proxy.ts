/**
 * Gemini → OpenRoute 协议转换。
 *
 * TS 移植自 `forgemind/gemini_to_openroute_proxy.py`（549 行）：协议翻译纯函数
 * （gemini_request_to_openai / openai_response_to_gemini）+ 非流式响应合成 Gemini SSE
 * （stream_openai_to_gemini）+ 模型映射表。HTTP 挂载见 proxy-handler.ts。
 *
 * 行为基线：Gemini 用 "model" role 表示 assistant；未知 gemini-* 模型名统一 fallback
 * 到默认模型（OpenRoute 对未知名 403），非 gemini 前缀的原样透传；Gemini SSE 不使用
 * [DONE] 哨兵（直接关闭流）。
 */

type Json = Record<string, unknown>;

function asJson(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

// ── 模型映射 ────────────────────────────────────────────────────────────────

/** Gemini proxy 默认 OpenRoute 模型（对齐 GEMINI_PROXY_MODEL 缺省） */
export const GEMINI_PROXY_DEFAULT_MODEL = 'Doubao-Seed2.0';

/** 客户端模型名 → OpenRoute 可用模型名映射（旧版 gemini 名） */
export const GEMINI_MODEL_MAPPING: Record<string, string> = {
  'gemini-2.0-flash': 'Doubao-Seed2.0',
  'gemini-2.0-flash-exp': 'Doubao-Seed2.0',
  'gemini-2.0-pro': 'Doubao-Seed2.0',
  'gemini-1.5-pro': 'Doubao-Seed2.0',
  'gemini-1.5-flash': 'Doubao-Seed2.0',
  'gemini-1.0-pro': 'Doubao-Seed2.0',
  'gemini-pro': 'Doubao-Seed2.0',
  'gemini-3.3-pro': 'Doubao-Seed2.0',
};

/** Gemini CLI 默认/内部 router 模型名 → OpenRoute 模型名 */
export const GEMINI_TO_OPENROUTE_MODEL: Record<string, string> = {
  'gemini-2.5-pro': 'Doubao-Seed2.0',
  'gemini-2.5-flash': 'Doubao-Seed2.0',
  'gemini-2.0-flash': 'Doubao-Seed2.0',
  'gemini-2.0-pro': 'Doubao-Seed2.0',
  'gemini-1.5-pro': 'Doubao-Seed2.0',
  'gemini-1.5-flash': 'Doubao-Seed2.0',
  // 新版 gemini-cli 0.51+ 默认模型名
  'gemini-3.1-flash-lite': 'Doubao-Seed2.0',
  'gemini-3.1-pro': 'Doubao-Seed2.0',
  'gemini-3.1-flash': 'Doubao-Seed2.0',
  'gemini-3.0-pro': 'Doubao-Seed2.0',
  'gemini-3.0-flash': 'Doubao-Seed2.0',
  // gemini-cli 0.60+ 内部 router 用的模型名
  'gemini-3.5-flash': 'Doubao-Seed2.0',
  'gemini-3.5-flash-thinking': 'Doubao-Seed2.0',
  'gemini-3.5-flash-thinking-lite': 'Doubao-Seed2.0',
  'gemini-3.5-pro': 'Doubao-Seed2.0',
  'gemini-auto': 'Doubao-Seed2.0',
  'gemini-flash-lite': 'Doubao-Seed2.0',
  // 允许直接用 openroute 模型名（如 "GLM-5.1"）原样透传
};

// ── 协议转换: Gemini → OpenAI ───────────────────────────────────────────────

/** 把 Gemini generateContent 请求转成 OpenAI chat/completions 请求 */
export function geminiRequestToOpenai(model: string, body: Json): Json {
  // 客户端模型名 → OpenRoute 可用模型名映射
  const mappedModel = GEMINI_MODEL_MAPPING[model] ?? model;
  const messages: Array<{ role: string; content: string }> = [];

  // systemInstruction → system message
  const sysInst = asJson(body['systemInstruction']) ?? asJson(body['system_instruction']);
  if (sysInst !== undefined) {
    const parts = Array.isArray(sysInst['parts']) ? sysInst['parts'] : [];
    const sysText = parts
      .map((p) => (asJson(p)?.['text'] ?? ''))
      .map(String)
      .join(' ');
    if (sysText.trim() !== '') {
      messages.push({ role: 'system', content: sysText });
    }
  }

  // contents → user/assistant messages
  const contents = Array.isArray(body['contents']) ? body['contents'] : [];
  for (const rawEntry of contents) {
    const entry = asJson(rawEntry);
    if (entry === undefined) continue;
    const role = typeof entry['role'] === 'string' ? entry['role'] : 'user';
    // Gemini 用 "model" 表示 assistant，OpenAI 用 "assistant"
    const oaRole = role === 'model' ? 'assistant' : role;
    const parts = Array.isArray(entry['parts']) ? entry['parts'] : [];
    // 把所有 text part 合并成单个 content 字符串
    const textParts = parts
      .map((p) => asJson(p))
      .filter((p): p is Json => p !== undefined && 'text' in p)
      .map((p) => (typeof p['text'] === 'string' ? p['text'] : ''));
    const content = textParts.length > 0 ? textParts.join('\n') : '';
    if (content !== '') {
      messages.push({ role: oaRole, content });
    }
  }

  // generationConfig → OpenAI 参数
  const genCfg = asJson(body['generationConfig']) ?? asJson(body['generation_config']) ?? {};
  // 未知模型名不透传（OpenRoute 会 403），统一 fallback
  let resolvedModel = GEMINI_TO_OPENROUTE_MODEL[mappedModel];
  if (resolvedModel === undefined) {
    // 任何以 "gemini-" 开头的未知型号都映射到默认模型；非 gemini 前缀原样透传
    if (mappedModel.startsWith('gemini-')) {
      resolvedModel = GEMINI_PROXY_DEFAULT_MODEL;
    } else {
      resolvedModel = mappedModel;
    }
  }

  const openaiBody: Json = {
    model: resolvedModel,
    messages,
    stream: false, // 默认非流式，streamGenerateContent 端点单独处理
  };
  if ('maxOutputTokens' in genCfg) openaiBody['max_tokens'] = genCfg['maxOutputTokens'];
  if ('temperature' in genCfg) openaiBody['temperature'] = genCfg['temperature'];
  if ('topP' in genCfg) openaiBody['top_p'] = genCfg['topP'];
  if ('stopSequences' in genCfg) openaiBody['stop'] = genCfg['stopSequences'];

  // 工具配置（functionDeclarations → tools）
  const tools = Array.isArray(body['tools']) ? body['tools'] : [];
  if (tools.length > 0) {
    const oaTools: Json[] = [];
    for (const rawTool of tools) {
      const tool = asJson(rawTool);
      if (tool === undefined) continue;
      const decls = Array.isArray(tool['functionDeclarations']) ? tool['functionDeclarations'] : [];
      for (const rawDecl of decls) {
        const decl = asJson(rawDecl);
        if (decl === undefined) continue;
        oaTools.push({
          type: 'function',
          function: {
            name: decl['name'] ?? '',
            description: decl['description'] ?? '',
            parameters: decl['parameters'] ?? { type: 'object', properties: {} },
          },
        });
      }
    }
    if (oaTools.length > 0) {
      openaiBody['tools'] = oaTools;
    }
  }

  return openaiBody;
}

// ── 协议转换: OpenAI → Gemini ───────────────────────────────────────────────

/** 把 OpenAI chat/completions 响应转回 Gemini generateContent 响应 */
export function openaiResponseToGemini(oaResp: Json, model: string): Json {
  const candidates: Json[] = [];
  const choices = Array.isArray(oaResp['choices']) ? (oaResp['choices'] as Json[]) : [];
  for (const choice of choices) {
    const message = asJson(choice['message']) ?? {};
    const content = typeof message['content'] === 'string' ? message['content'] : '';
    const finishReason =
      typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : 'stop';
    // 映射 finish_reason
    const geminiFinish =
      ({ stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' } as Record<string, string>)[
        finishReason
      ] ?? 'STOP';

    const parts: Json[] = [];
    if (content !== '') {
      parts.push({ text: content });
    }
    // tool_calls → functionCall parts
    const toolCalls = Array.isArray(message['tool_calls']) ? (message['tool_calls'] as Json[]) : [];
    for (const tc of toolCalls) {
      const fn = asJson(tc['function']) ?? {};
      let args: unknown = {};
      try {
        args = JSON.parse(typeof fn['arguments'] === 'string' ? fn['arguments'] : '{}');
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: fn['name'] ?? '', args } });
    }

    candidates.push({
      content: { role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] },
      finishReason: geminiFinish,
      index: typeof choice['index'] === 'number' ? choice['index'] : 0,
    });
  }

  const usage = asJson(oaResp['usage']) ?? {};
  return {
    candidates,
    usageMetadata: {
      promptTokenCount: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0,
      candidatesTokenCount:
        typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0,
      totalTokenCount: typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : 0,
    },
    modelVersion: typeof oaResp['model'] === 'string' ? oaResp['model'] : model,
  };
}

// ── 流式合成: 非流式响应 → Gemini SSE ──────────────────────────────────────

/** SSE 合成固定 chunk 大小（对齐 CHUNK_SIZE=64） */
export const GEMINI_SSE_CHUNK_SIZE = 64;

/**
 * 把 OpenAI 非流式响应合成为 Gemini SSE 事件流。
 *
 * Gemini streamGenerateContent 用 SSE，每行 `data: {json}`；Gemini SSE 协议不使用
 * [DONE] 哨兵（直接关闭流即可，OpenAI 的 `data: [DONE]` 会被 gemini CLI 解析为 JSON
 * 导致 SyntaxError）。
 */
export async function* streamOpenaiToGemini(oaData: Json, model: string): AsyncGenerator<string> {
  // 提取完整文本和 tool_calls
  let fullText = '';
  let finishReason: string | undefined;
  const toolCallsList: Array<{ name: string; args: unknown }> = [];
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
      toolCallsList.push({ name: typeof fn['name'] === 'string' ? fn['name'] : '', args });
    }
  }

  const modelVersion = typeof oaData['model'] === 'string' ? oaData['model'] : model;

  // 按固定 chunk 大小切分文本，模拟流式增量
  for (let i = 0; i < fullText.length; i += GEMINI_SSE_CHUNK_SIZE) {
    yield `data: ${JSON.stringify({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: fullText.slice(i, i + GEMINI_SSE_CHUNK_SIZE) }] },
          finishReason: null,
          index: 0,
        },
      ],
      modelVersion,
    })}\n\n`;
  }

  // 发送 tool_calls 和结束 chunk
  const parts: Json[] = toolCallsList.map((tc) => ({ functionCall: tc }));
  if (finishReason !== undefined) {
    yield `data: ${JSON.stringify({
      candidates: [
        {
          content:
            parts.length > 0
              ? { role: 'model', parts }
              : { role: 'model' },
          finishReason: finishReason === 'stop' ? 'STOP' : 'MAX_TOKENS',
          index: 0,
        },
      ],
      modelVersion,
    })}\n\n`;
  }

  // Gemini SSE 协议不使用 [DONE] 哨兵 — 直接关闭流即可
}
