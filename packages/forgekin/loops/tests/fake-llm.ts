/**
 * FakeLlmChatClient — 测试用 LLM 客户端（响应队列，按调用顺序弹出）。
 *
 * - queue 可放字符串响应或函数（接收消息返回内容）
 * - failNext() 使下一次调用抛错（模拟 LLM 故障）
 * - calls 记录每次调用的消息数组（可断言 prompt 内容）
 */

import {
  LlmChatClient,
  LlmChatMessage,
  LlmChatOptions,
  LlmChatResult,
} from '../src/types.js';

type Responder = (messages: LlmChatMessage[]) => string;

export class FakeLlmChatClient implements LlmChatClient {
  readonly queue: Array<string | Responder> = [];
  readonly calls: Array<{ messages: LlmChatMessage[]; options?: LlmChatOptions }> = [];
  private failureNext = 0;

  async chat(messages: LlmChatMessage[], options?: LlmChatOptions): Promise<LlmChatResult> {
    this.calls.push({ messages, ...(options === undefined ? {} : { options }) });
    if (this.failureNext > 0) {
      this.failureNext -= 1;
      throw new Error('fake LLM 调用失败');
    }
    const next = this.queue.shift();
    const content = typeof next === 'function' ? next(messages) : (next ?? '{}');
    return { content, model: 'fake-model' };
  }

  /** 让接下来 N 次调用抛错（默认 1 次） */
  failNext(n = 1): void {
    this.failureNext = n;
  }

  /** 剩余未消费响应数 */
  get pending(): number {
    return this.queue.length;
  }
}

/** 常用响应构造：写文件 plan（内容含 front-matter + # 标题） */
export function writePlanJson(path: string, content: string): string {
  return JSON.stringify({
    steps: [{ action: 'write_file', path, content }],
    expected_effect: '写入文件',
    risk_assessment: 'low',
  });
}

/** 常用响应构造：LLM 审核通过 */
export const reviewPassJson = JSON.stringify({
  passed: true,
  score: 0.95,
  issues: [],
  suggestions: ['无需修改'],
});

/** 常用响应构造：LLM 审核不通过 */
export const reviewFailJson = JSON.stringify({
  passed: false,
  score: 0.4,
  issues: ['front-matter 缺失', '标题层级过深'],
  suggestions: ['补全 front-matter'],
});

/** 标准文档内容（front-matter + # 标题，可通过 doc verify） */
export const goodDocContent = '---\ntype: guide\nstatus: draft\n---\n# 指南\n\n正文内容';
