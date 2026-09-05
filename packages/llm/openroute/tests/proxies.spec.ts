/**
 * 三协议转换纯函数：anthropic / gemini / responses 的请求翻译、响应回译与 SSE 合成。
 * （移植基线：forgemind/{anthropic,gemini,responses}_to_openroute_proxy.py）
 */

import { describe, expect, it } from 'vitest'
import {
  anthropicToOpenai,
  openaiToAnthropic,
  stripModelSuffix,
  streamOpenaiToAnthropic,
  ANTHROPIC_PROXY_DEFAULT_MODEL,
  CLAUDE_TO_OPENROUTE_MODEL,
} from '../src/anthropic-proxy.ts'
import {
  geminiRequestToOpenai,
  openaiResponseToGemini,
  streamOpenaiToGemini,
} from '../src/gemini-proxy.ts'
import {
  chatToResponses,
  responsesToChat,
  streamChatToResponses,
  RESPONSES_MODEL_MAPPING,
  RESPONSES_PROXY_DEFAULT_MODEL,
} from '../src/responses-proxy.ts'

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('anthropic 请求翻译', () => {
  it('system 字符串 + messages 数组 content（text/tool_result/tool_use）', () => {
    const openai = anthropicToOpenai({
      model: 'claude-sonnet-4',
      max_tokens: 1024,
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'user', content: [{ type: 'text', text: 'How are you?' }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', content: [{ type: 'text', text: 'result text' }] },
            { type: 'tool_use', name: 'read_file', input: { path: 'a.txt' } },
          ],
        },
      ],
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ['END'],
      tools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object' } }],
    })
    expect(openai).toMatchObject({
      model: ANTHROPIC_PROXY_DEFAULT_MODEL,
      max_tokens: 1024,
      temperature: 0.5,
      top_p: 0.9,
      stop: ['END'],
    })
    expect(openai.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
      { role: 'user', content: 'result text\n{"tool_use":"read_file","input":{"path":"a.txt"}}' },
    ])
    expect(openai.tools).toEqual([
      { type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object' } } },
    ])
  })

  it('system 数组合并 + 未知模型回落默认', () => {
    const openai = anthropicToOpenai({
      system: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }],
      messages: [],
    })
    expect((openai.messages as Array<unknown>)[0]).toEqual({ role: 'system', content: 'part1\npart2' })
    expect(openai.model).toBe(ANTHROPIC_PROXY_DEFAULT_MODEL)
  })

  it('模型映射：后缀剥离后查表（claude-opus-4-7[1m] → Doubao-Seed2.0）', () => {
    const openai = anthropicToOpenai({ model: 'claude-opus-4-7[1m]', messages: [] })
    expect(openai.model).toBe('Doubao-Seed2.0')
    expect(stripModelSuffix('claude-opus-4-7[5m]')).toBe('claude-opus-4-7')
    expect(Object.keys(CLAUDE_TO_OPENROUTE_MODEL)).toContain('claude-sonnet-4')
  })
})

describe('anthropic 响应回译', () => {
  it('text + tool_calls → content blocks + stop_reason/usage 映射', () => {
    const anthropic = openaiToAnthropic(
      {
        id: 'oa-1',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '调用工具',
              tool_calls: [{ id: 'tc-9', function: { name: 'ls', arguments: '{"path":"/"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      },
      'claude-sonnet-4',
    )
    expect(anthropic).toMatchObject({
      id: 'msg_oa-1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 3 },
    })
    expect(anthropic.content).toEqual([
      { type: 'text', text: '调用工具' },
      { type: 'tool_use', id: 'tc-9', name: 'ls', input: { path: '/' } },
    ])
  })

  it('空 choices → 空 text block；finish_reason length → max_tokens', () => {
    const empty = openaiToAnthropic({ choices: [] }, 'm')
    expect(empty.content).toEqual([{ type: 'text', text: '' }])
    const length = openaiToAnthropic(
      { choices: [{ finish_reason: 'length', message: { content: 'x' } }] },
      'm',
    )
    expect(length.stop_reason).toBe('max_tokens')
  })
})

describe('anthropic SSE 合成', () => {
  it('message_start → 64 字符增量 → tool_use block → message_delta → message_stop', async () => {
    const chunks = await collect(
      streamOpenaiToAnthropic(
        {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: 'a'.repeat(130),
                tool_calls: [{ id: 't1', function: { name: 'f', arguments: '{"x":1}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 2 },
        },
        'm',
        'msg_1',
      ),
    )
    const parsed = chunks.map((c) => {
      const lines = c.trim().split('\n')
      return { event: lines[0]?.replace('event: ', ''), data: JSON.parse(lines[1]?.replace('data: ', '') ?? '{}') }
    })
    expect(parsed[0]?.event).toBe('message_start')
    expect(parsed[0]?.data.message.usage.input_tokens).toBe(2)
    expect(parsed[1]?.event).toBe('content_block_start')
    const deltas = parsed.filter((p) => p.event === 'content_block_delta' && p.data.delta.type === 'text_delta')
    expect(deltas).toHaveLength(3) // 130/64 → 3 chunks
    expect((deltas[0]?.data.delta.text as string).length).toBe(64)
    const toolStart = parsed.find((p) => p.event === 'content_block_start' && p.data.content_block.type === 'tool_use')
    expect(toolStart?.data.index).toBe(1)
    const toolDelta = parsed.find((p) => p.event === 'content_block_delta' && p.data.delta.type === 'input_json_delta')
    expect(toolDelta?.data.delta.partial_json).toBe('{"x":1}')
    const messageDelta = parsed.find((p) => p.event === 'message_delta')
    expect(messageDelta?.data.delta.stop_reason).toBe('tool_use')
    expect(parsed.at(-1)?.event).toBe('message_stop')
    expect(chunks.at(-1)).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n')
  })
})

describe('gemini 请求翻译', () => {
  it('systemInstruction + contents(model→assistant) + generationConfig + functionDeclarations', () => {
    const openai = geminiRequestToOpenai('gemini-2.5-pro', {
      systemInstruction: { parts: [{ text: 'Be helpful.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
      ],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7, topP: 0.9, stopSequences: ['S'] },
      tools: [{ functionDeclarations: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }] }],
    })
    expect(openai).toMatchObject({
      model: 'Doubao-Seed2.0',
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 0.9,
      stop: ['S'],
      stream: false,
    })
    expect(openai.messages).toEqual([
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ])
    expect(openai.tools).toEqual([
      { type: 'function', function: { name: 'fn', description: 'd', parameters: { type: 'object' } } },
    ])
  })

  it('未知 gemini-* 模型回落默认；非 gemini 前缀透传', () => {
    expect(geminiRequestToOpenai('gemini-9.9-unknown', {}).model).toBe('Doubao-Seed2.0')
    expect(geminiRequestToOpenai('GLM-5.1', {}).model).toBe('GLM-5.1')
  })
})

describe('gemini 响应回译', () => {
  it('candidates + functionCall + usageMetadata + modelVersion', () => {
    const gemini = openaiResponseToGemini(
      {
        model: 'Doubao-Seed2.0',
        choices: [
          {
            index: 0,
            finish_reason: 'length',
            message: {
              content: '文本',
              tool_calls: [{ id: 'c1', function: { name: 'fn', arguments: '{"a":2}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      },
      'gemini-2.5-pro',
    )
    expect(gemini.modelVersion).toBe('Doubao-Seed2.0')
    expect(gemini.usageMetadata).toEqual({
      promptTokenCount: 3,
      candidatesTokenCount: 4,
      totalTokenCount: 7,
    })
    const candidate = (gemini.candidates as Array<Record<string, unknown>>)[0] ?? {}
    expect(candidate.finishReason).toBe('MAX_TOKENS')
    expect(candidate.content).toEqual({
      role: 'model',
      parts: [{ text: '文本' }, { functionCall: { name: 'fn', args: { a: 2 } } }],
    })
  })
})

describe('gemini SSE 合成', () => {
  it('data: {json} chunk 切分 + 终止 chunk（无 [DONE] 哨兵）', async () => {
    const chunks = await collect(
      streamOpenaiToGemini(
        {
          model: 'Doubao-Seed2.0',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: 'x'.repeat(70),
                tool_calls: [{ id: 'c', function: { name: 'fn', arguments: '{"k":1}' } }],
              },
            },
          ],
        },
        'gemini-2.5-pro',
      ),
    )
    expect(chunks).toHaveLength(3) // 70/64 → 2 文本 chunk + 1 终止 chunk
    expect(chunks[0]?.startsWith('data: ')).toBe(true)
    const first = JSON.parse((chunks[0] ?? '').replace(/^data: /, '').trim())
    expect(first.candidates[0].content.parts[0].text.length).toBe(64)
    const final = JSON.parse((chunks.at(-1) ?? '').replace(/^data: /, '').trim())
    expect(final.candidates[0].finishReason).toBe('STOP')
    expect(final.candidates[0].content.parts).toEqual([{ functionCall: { name: 'fn', args: { k: 1 } } }])
    expect(chunks.some((c) => c.includes('[DONE]'))).toBe(false)
  })
})

describe('responses 请求翻译', () => {
  it('instructions + input 字符串/数组（output_text 提取、reasoning 跳过）+ 参数映射 + tools', () => {
    const chat = responsesToChat({
      model: 'gpt-5',
      instructions: 'You are helpful.',
      input: [
        { role: 'user', content: [{ type: 'output_text', text: '问题' }, { type: 'reasoning', summary: [] }] },
        { role: 'assistant', content: '回答' },
      ],
      max_output_tokens: 512,
      temperature: 0.3,
      tools: [
        { type: 'function', name: 'passthrough' },
        { name: 'wrap_me', description: 'd', parameters: { type: 'object' } },
      ],
    })
    expect(chat).toMatchObject({
      model: RESPONSES_MODEL_MAPPING['gpt-5'],
      max_tokens: 512,
      temperature: 0.3,
    })
    expect(chat.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' },
    ])
    expect(chat.tools).toEqual([
      { type: 'function', name: 'passthrough' },
      { type: 'function', function: { name: 'wrap_me', description: 'd', parameters: { type: 'object' } } },
    ])
  })

  it('input 字符串直传 + 未知模型透传', () => {
    const chat = responsesToChat({ input: 'What is 2+2?' })
    expect(chat.messages).toEqual([{ role: 'user', content: 'What is 2+2?' }])
    expect(chat.model).toBe(RESPONSES_PROXY_DEFAULT_MODEL)
  })
})

describe('responses 响应回译', () => {
  it('output message + function_call（arguments JSON 字符串）+ usage', () => {
    const responses = chatToResponses(
      {
        id: 'oa-2',
        choices: [
          {
            message: {
              content: '回答文本',
              tool_calls: [{ id: 'call_9', function: { name: 'fn', arguments: '{"q":"v"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
      'GPT-5.5',
    )
    expect(responses).toMatchObject({
      id: 'resp_oa-2',
      object: 'response',
      model: 'GPT-5.5',
      status: 'completed',
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    })
    expect(responses.output).toEqual([
      { type: 'function_call', id: 'call_9', call_id: 'call_9', name: 'fn', arguments: '{"q":"v"}' },
      {
        type: 'message',
        id: 'msg_0',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '回答文本', annotations: [] }],
      },
    ])
    expect(typeof responses.created_at).toBe('number')
  })
})

describe('responses SSE 合成', () => {
  it('七段事件序列与最终 usage', async () => {
    const chunks = await collect(
      streamChatToResponses(
        {
          choices: [{ message: { content: 'y'.repeat(65) } }],
          usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
        },
        'Doubao-Seed2.0',
        'resp_1',
      ),
    )
    const events = chunks.map((c) => c.trim().split('\n')[0]?.replace('event: ', ''))
    expect(events).toEqual([
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ])
    const completed = JSON.parse((chunks.at(-1) ?? '').split('\n')[1]?.replace('data: ', '') ?? '{}')
    expect(completed.response.usage).toEqual({ input_tokens: 4, output_tokens: 5, total_tokens: 9 })
    expect(completed.response.output[0].content[0].text).toBe('y'.repeat(65))
  })
})
