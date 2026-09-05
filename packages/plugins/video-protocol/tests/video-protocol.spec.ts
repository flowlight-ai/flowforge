/**
 * video-protocol 协议引擎测试 — C35。
 *
 * 覆盖：占位符渲染（提供 var / default 回落 / 缺省空串）；嵌套 body 渲染；
 * sync/async 请求构建；JSONPath 提取（对象/数组索引）；statusMap 归类；
 * inherit 链解析；async snapshot。
 */

import { describe, expect, it } from 'vitest';

import {
  buildRequest,
  classifyStatus,
  extractJsonPath,
  renderTemplateString,
  resolveCapability,
  snapshotAsyncResult,
  type VideoProtocol,
} from '../src/index.ts';

describe('renderTemplateString', () => {
  it('提供 var 用之；缺省回落 default 字面量', () => {
    expect(renderTemplateString('{{model | default:cogvideox-flash}}', {})).toBe('cogvideox-flash');
    expect(renderTemplateString('{{model | default:cogvideox-flash}}', { model: 'my-model' })).toBe('my-model');
    expect(renderTemplateString('{{prompt}}', { prompt: '一只猫' })).toBe('一只猫');
    expect(renderTemplateString('{{missing}}', {})).toBe('');
  });

  it('支持非字符串 var（number/boolean）', () => {
    expect(renderTemplateString('w={{width}}', { width: 1280 })).toBe('w=1280');
  });
});

describe('buildRequest', () => {
  const protocol: VideoProtocol = {
    name: 'zhipu',
    version: 1,
    mode: 'sync',
    baseUrl: 'https://open.bigmodel.cn',
    capabilities: {
      analyze: {
        mode: 'sync',
        request: {
          method: 'POST',
          path: '/api/paas/v4/chat/completions',
          body: {
            model: '{{model | default:glm-4.6v-flash}}',
            messages: [{ role: 'user', content: [{ type: 'text', text: '{{prompt}}' }] }],
          },
        },
      },
    },
  };

  it('sync 能力 → method/url/body 渲染', () => {
    const request = resolveCapability(protocol, 'analyze');
    const built = buildRequest(protocol.baseUrl, request.submit, { prompt: '分析这段视频', model: 'custom' });
    expect(built.method).toBe('POST');
    expect(built.url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    expect(built.body).toEqual({
      model: 'custom',
      messages: [{ role: 'user', content: [{ type: 'text', text: '分析这段视频' }] }],
    });
  });
});

describe('extractJsonPath', () => {
  const body = {
    data: { task_id: 'task-1', videos: [{ url: 'https://v/1.mp4' }] },
    candidates: [{ content: { parts: [{ text: '解析结果' }] } }],
  };

  it('对象路径与数组索引', () => {
    expect(extractJsonPath(body, '$.data.task_id')).toBe('task-1');
    expect(extractJsonPath(body, '$.candidates[0].content.parts[0].text')).toBe('解析结果');
    expect(extractJsonPath(body, '$.data.videos[0].url')).toBe('https://v/1.mp4');
    expect(extractJsonPath(body, '$.missing.path')).toBeUndefined();
    expect(extractJsonPath(body, undefined)).toBeUndefined();
  });
});

describe('classifyStatus', () => {
  const spec = { statusMap: { running: ['PROCESSING'], succeeded: ['SUCCESS'], failed: ['FAIL'] } };

  it('statusMap 归类', () => {
    expect(classifyStatus(spec, 'PROCESSING')).toEqual({ lifecycle: 'running', matched: true });
    expect(classifyStatus(spec, 'SUCCESS')).toEqual({ lifecycle: 'succeeded', matched: true });
    expect(classifyStatus(spec, 'WEIRD')).toEqual({ lifecycle: null, matched: false });
    expect(classifyStatus(spec, undefined)).toEqual({ lifecycle: null, matched: false });
  });
});

describe('resolveCapability + snapshotAsyncResult', () => {
  const protocol: VideoProtocol = {
    name: 'zhipu',
    version: 1,
    mode: 'async',
    baseUrl: 'https://open.bigmodel.cn',
    capabilities: {
      text2video: {
        mode: 'async',
        submit: {
          method: 'POST',
          path: '/api/paas/v4/videos/generations',
          body: { model: '{{model | default:cogvideox-flash}}', prompt: '{{prompt}}' },
          response: {
            taskId: '$.id',
            status: '$.task_status',
            statusMap: { running: ['PROCESSING'], succeeded: ['SUCCESS'], failed: ['FAIL'] },
          },
        },
        poll: {
          method: 'GET',
          path: '/api/paas/v4/async-result/{{taskId}}',
          interval: 5000,
          maxAttempts: 120,
          response: {
            status: '$.task_status',
            statusMap: { running: ['PROCESSING'], succeeded: ['SUCCESS'], failed: ['FAIL'] },
            resultUrl: '$.video_result[0].url',
            coverUrl: '$.video_result[0].cover_image_url',
          },
        },
      },
      image2video: {
        mode: 'async',
        inherit: 'text2video',
        submit: {
          method: 'POST',
          path: '/api/paas/v4/videos/generations',
          body: { model: '{{model | default:cogvideox-flash}}', prompt: '{{prompt}}', image_url: '{{imageUrl}}' },
          response: { taskId: '$.id' },
        },
      },
    },
  };

  it('async 能力 submit + poll 构建', () => {
    const resolved = resolveCapability(protocol, 'text2video');
    expect(resolved.mode).toBe('async');
    expect(resolved.poll).toBeDefined();
    const built = buildRequest(protocol.baseUrl, resolved.submit, { prompt: '跑步的狗' });
    expect(built.body).toEqual({ model: 'cogvideox-flash', prompt: '跑步的狗' });
  });

  it('inherit 链：image2video 继承 text2video 的 poll', () => {
    const resolved = resolveCapability(protocol, 'image2video');
    expect(resolved.submit.body).toEqual({
      model: '{{model | default:cogvideox-flash}}',
      prompt: '{{prompt}}',
      image_url: '{{imageUrl}}',
    });
    expect(resolved.poll).toBeDefined();
    expect(resolved.poll?.interval).toBe(5000);
  });

  it('snapshotAsyncResult：终态判定与 URL 提取', () => {
    const resolved = resolveCapability(protocol, 'text2video');
    const pollSpec = resolved.poll!;
    const running = snapshotAsyncResult(pollSpec.response!, {
      task_status: 'PROCESSING',
      video_result: [{ url: 'https://v/1.mp4', cover_image_url: 'https://c/1.jpg' }],
    });
    expect(running.status).toBe('running');
    expect(running.isTerminal).toBe(false);

    const done = snapshotAsyncResult(pollSpec.response!, {
      task_status: 'SUCCESS',
      video_result: [{ url: 'https://v/1.mp4', cover_image_url: 'https://c/1.jpg' }],
    });
    expect(done.status).toBe('succeeded');
    expect(done.isTerminal).toBe(true);
    expect(done.resultUrl).toBe('https://v/1.mp4');
    expect(done.coverUrl).toBe('https://c/1.jpg');
  });
});
