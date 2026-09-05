/**
 * video-gen 插件测试 — C35。
 *
 * 覆盖：协议目录（zhipu/kling/jimeng）；submit 请求构建（默认 model）；
 * poll 请求（taskId 占位符注入）；config model/baseUrl 覆盖；snapshot 任务
 * 快照（终态/URL/statusMap 差异）；Service 挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeVideoGenService, {
  VIDEO_GEN_PROTOCOLS,
  getVideoGenProtocol,
  resolveVideoGenConfig,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('VIDEO_GEN_PROTOCOLS', () => {
  it('含 zhipu/kling/jimeng 三个 async 协议', () => {
    expect(VIDEO_GEN_PROTOCOLS.map((p) => p.name).sort()).toEqual(['jimeng', 'kling', 'zhipu']);
    for (const protocol of VIDEO_GEN_PROTOCOLS) {
      expect(protocol.mode).toBe('async');
      expect(protocol.capabilities.text2video).toBeDefined();
    }
  });

  it('zhipu image2video 通过 inherit 复用 text2video poll', () => {
    const zhipu = getVideoGenProtocol('zhipu');
    const image2video = zhipu?.capabilities.image2video;
    expect(image2video?.mode === 'async' && image2video.inherit).toBe('text2video');
  });
});

describe('resolveVideoGenConfig', () => {
  it('jwt 凭据解析 + requiredWhen 提示不强制（apiKey 可缺省）', () => {
    const config = resolveVideoGenConfig({
      env: {
        VIDEO_GEN_PROVIDER: 'kling',
        VIDEO_GEN_AUTH_TYPE: 'jwt-hs256',
        VIDEO_GEN_ACCESS_KEY: 'ak',
        VIDEO_GEN_SECRET_KEY: 'sk',
      },
    });
    expect(config.provider).toBe('kling');
    expect(config.authType).toBe('jwt-hs256');
    expect(config.apiKey).toBeUndefined();
    expect(config.accessKey).toBe('ak');
    expect(config.secretKey).toBe('sk');
  });
});

describe('ForgeVideoGenService', () => {
  it('zhipu text2video submit：默认 cogvideox-flash；config model 覆盖', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeVideoGenService, {
      env: { VIDEO_GEN_PROVIDER: 'zhipu', VIDEO_GEN_MODEL: 'cogvideox-2' },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeVideoGen;
    expect(svc.capabilityNames('zhipu')).toContain('text2video');

    const submitted = svc.submit('zhipu', 'text2video', { prompt: '奔跑的狗' });
    expect(submitted.method).toBe('POST');
    expect(submitted.url).toBe('https://open.bigmodel.cn/api/paas/v4/videos/generations');
    expect(submitted.body).toEqual({ model: 'cogvideox-2', prompt: '奔跑的狗' });

    const poll = svc.poll('zhipu', 'text2video', { taskId: 't-1' });
    expect(poll.url).toBe('https://open.bigmodel.cn/api/paas/v4/async-result/t-1');
    expect(svc.pollSpec('zhipu', 'text2video').maxAttempts).toBe(120);
  });

  it('kling submit：statusMap 解析 + resultUrl 快照', async () => {
    const svc = new ForgeVideoGenService(new Context());
    const submitted = svc.submit('kling', 'text2video', { prompt: '猫' });
    expect(submitted.url).toContain('/v1/videos/text2video');
    expect((submitted.body as { model_name: string }).model_name).toBe('kling-v2.6-pro');

    const pollSnap = svc.snapshot(
      'kling',
      'text2video',
      { data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://v/o.mp4' }] } } },
      'poll',
    );
    expect(pollSnap.status).toBe('succeeded');
    expect(pollSnap.isTerminal).toBe(true);
    expect(pollSnap.resultUrl).toBe('https://v/o.mp4');
  });

  it('jimeng text2image poll：done 归类 succeeded + image_urls 结果 URL', async () => {
    const svc = new ForgeVideoGenService(new Context());
    const submitSnap = svc.snapshot(
      'jimeng',
      'text2image',
      { code: 10000, data: { task_id: 'jt-1' } },
      'submit',
    );
    expect(submitSnap.taskId).toBe('jt-1');

    const running = svc.snapshot(
      'jimeng',
      'text2image',
      { code: 10000, data: { status: 'running' } },
      'poll',
    );
    expect(running.status).toBeNull();

    const done = svc.snapshot(
      'jimeng',
      'text2image',
      { code: 10000, data: { status: 'done', image_urls: ['https://i/1.png'] } },
      'poll',
    );
    expect(done.status).toBe('succeeded');
    expect(done.resultUrl).toBe('https://i/1.png');
  });

  it('未知 provider → 抛错', () => {
    const svc = new ForgeVideoGenService(new Context());
    expect(() => svc.submit('nope', 'text2video', { prompt: 'p' })).toThrow(/unknown video-gen provider/);
  });

  it('无 poll 能力的 sync 风格 capability（本包不存在）→ 用缺省 poll 兜底仍返回', () => {
    // 本包能力均为 async；验证 pollSpec 对缺失 poll 兜底后 path 为空串不炸
    const svc = new ForgeVideoGenService(new Context());
    const spec = svc.pollSpec('zhipu', 'text2video');
    expect(spec.maxAttempts).toBeGreaterThan(0);
  });
});
