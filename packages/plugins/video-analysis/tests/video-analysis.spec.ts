/**
 * video-analysis 插件测试 — C35。
 *
 * 覆盖：协议目录（gemini/zhipu）；config 解析；analyze 请求构建（占位符/
 * config model/baseUrl 覆盖）；extractResult；Service 挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeVideoAnalysisService, {
  VIDEO_ANALYSIS_PROTOCOLS,
  getVideoAnalysisProtocol,
  resolveVideoAnalysisConfig,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('VIDEO_ANALYSIS_PROTOCOLS', () => {
  it('含 gemini/zhipu 两个 sync 协议', () => {
    expect(VIDEO_ANALYSIS_PROTOCOLS.map((p) => p.name).sort()).toEqual(['gemini', 'zhipu']);
    for (const protocol of VIDEO_ANALYSIS_PROTOCOLS) {
      expect(protocol.mode).toBe('sync');
      expect(Object.keys(protocol.capabilities).length).toBeGreaterThan(0);
    }
  });

  it('gemini 协议带 query-param auth（paramName key）', () => {
    const gemini = getVideoAnalysisProtocol('gemini');
    expect(gemini?.auth).toEqual({ method: 'query-param', paramName: 'key' });
  });
});

describe('resolveVideoAnalysisConfig', () => {
  it('env 空 → 全部 undefined', () => {
    expect(resolveVideoAnalysisConfig({ env: {} })).toEqual({
      provider: undefined,
      authType: undefined,
      apiKey: undefined,
      baseUrl: undefined,
      model: undefined,
    });
  });

  it('provider/baseUrl/model 解析，空串忽略', () => {
    const config = resolveVideoAnalysisConfig({
      env: {
        VIDEO_ANALYSIS_PROVIDER: 'gemini',
        VIDEO_ANALYSIS_MODEL: 'gemini-2.5-pro',
        VIDEO_ANALYSIS_BASE_URL: '',
      },
    });
    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-2.5-pro');
    expect(config.baseUrl).toBeUndefined();
  });
});

describe('ForgeVideoAnalysisService', () => {
  it('gemini analyze：URL path 占位符 + fileData 渲染', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeVideoAnalysisService, {
      env: { VIDEO_ANALYSIS_PROVIDER: 'gemini', VIDEO_ANALYSIS_MODEL: 'gemini-2.0-flash' },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeVideoAnalysis;
    expect(svc.providers()).toContain('gemini');

    const request = svc.analyze('gemini', { videoUrl: 'https://cdn/v.mp4', prompt: '总结这段视频' });
    expect(request.method).toBe('POST');
    expect(request.url).toContain('/v1beta/models/gemini-2.0-flash:generateContent');
    const contents = (request.body as { contents: Array<{ parts: unknown[] }> }).contents;
    expect(contents[0]).toBeDefined();
    expect(contents[0]?.parts).toContainEqual({
      fileData: { mimeType: 'video/mp4', fileUri: 'https://cdn/v.mp4' },
    });
    expect(contents[0]?.parts).toContainEqual({ text: '总结这段视频' });
    expect(request.resultPath).toBe('$.candidates[0].content.parts[0].text');
  });

  it('zhipu analyze：video_url 消息体 + 结果提取', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeVideoAnalysisService)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeVideoAnalysis;
    const request = svc.analyze('zhipu', { videoUrl: 'https://cdn/v.mp4', prompt: '分析' });
    const messages = (request.body as { messages: Array<{ content: unknown[] }> }).messages;
    expect(messages[0]).toBeDefined();
    expect(messages[0]?.content).toContainEqual({ type: 'video_url', video_url: { url: 'https://cdn/v.mp4' } });
    expect(request.resultPath).toBe('$.choices[0].message.content');

    const extracted = svc.extractResult('zhipu', {
      choices: [{ message: { content: '结论' } }],
    });
    expect(extracted).toBe('结论');
  });

  it('未知 provider → 抛错；缺 model 用模板默认', () => {
    const svc = new ForgeVideoAnalysisService(new Context());
    expect(() => svc.analyze('nope', { videoUrl: 'u', prompt: 'p' })).toThrow(/unknown video-analysis provider/);
    const request = svc.analyze('gemini', { videoUrl: 'u', prompt: 'p' });
    expect(request.url).toContain('gemini-2.0-flash');
  });
});
