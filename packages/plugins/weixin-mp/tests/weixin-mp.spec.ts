/**
 * weixin-mp 插件测试 — C35（markdownToWxHtml + validateFilePath + 六处理器）。
 *
 * 覆盖：markdownToWxHtml（标题/代码块/表格/引用/列表/分割线/链接/图片 URL
 * 白名单/内联加粗斜体/HTML 转义）；validateFilePath（tmpdir 内允许/逃逸拒绝）；
 * createWeixinMpHandlers（convert_markdown 落盘临时文件/upload_image 走注入
 * fetch+form/check_status 未配置/configured）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeWeixinMpService, {
  createWeixinMpHandlers,
  markdownToWxHtml,
  validateFilePath,
  type InvokeContext,
  type TokenManagerPort,
} from '../src/index.ts';

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-wxmp-'));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// markdownToWxHtml
// ---------------------------------------------------------------------------

describe('markdownToWxHtml', () => {
  it('标题/加粗/斜体/行内代码', () => {
    const html = markdownToWxHtml('# 标题\n\n**bold** 与 *em* 和 `code`');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code');
  });

  it('代码块/引用/无序/有序列表', () => {
    const html = markdownToWxHtml('```\nconst x = 1\n```\n> 引用\n- a\n- b\n1. one\n2. two');
    expect(html).toContain('<pre');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
  });

  it('表格 + 分隔线', () => {
    const html = markdownToWxHtml('| a | b |\n|---|---|\n| 1 | 2 |\n\n---');
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('<hr');
  });

  it('链接白名单：http(s)/# 保留；javascript: 拒绝（回落纯文本）', () => {
    const html = markdownToWxHtml('[安全](https://x.com) [危险](javascript:alert(1))');
    expect(html).toContain('<a href="https://x.com"');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('危险');
  });

  it('HTML 转义', () => {
    const html = markdownToWxHtml('<script>alert("x")</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

// ---------------------------------------------------------------------------
// validateFilePath
// ---------------------------------------------------------------------------

describe('validateFilePath', () => {
  it('tmpdir 内文件允许；目录逃逸拒绝', async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, 'a.md'), '# x', 'utf-8');
    const roots = [await import('node:fs/promises').then((m) => m.realpath(tmpdir()))];
    const safe = await validateFilePath(join(dir, 'a.md'), roots, 'test');
    expect(safe).toBeTruthy();
    // 用已存在的 cwd（不在允许根内）验证逃逸拒绝
    await expect(validateFilePath(process.cwd(), roots, 'test')).rejects.toThrow(/escapes allowed roots/);
  });
});

// ---------------------------------------------------------------------------
// createWeixinMpHandlers
// ---------------------------------------------------------------------------

describe('createWeixinMpHandlers', () => {
  function makeCtx(tokenManager: Partial<TokenManagerPort> = {}): InvokeContext {
    return {
      tokenManager: {
        getAccessToken: async () => 'tok',
        isTokenExpiredError: () => false,
        invalidateAccessToken: async () => {},
        ...tokenManager,
      },
      pluginConfig: {},
    };
  }

  it('convert_markdown：内联 markdown → 临时 html 落盘', async () => {
    const handlers = createWeixinMpHandlers({ validatePath: async (fp) => fp });
    const result = await handlers['weixin-mp:convert_markdown']!({ markdown: '# 你好' }, makeCtx());
    expect(result.success).toBe(true);
    expect((result.data?.filePath as string)).toMatch(/wx-converted-.*\.html$/);
  });

  it('convert_markdown：缺 markdown → error', async () => {
    const handlers = createWeixinMpHandlers();
    const result = await handlers['weixin-mp:convert_markdown']!({}, makeCtx());
    expect(result).toEqual({ success: false, error: 'markdown or markdownFilePath is required' });
  });

  it('upload_image：注入 fetch + form → url 结果', async () => {
    const handlers = createWeixinMpHandlers({
      fetchExternalUrlPinned: async () => ({ contentType: 'image/png', body: new Uint8Array([1, 2, 3]) }),
      uploadFormData: async () => ({ url: 'https://wx/uploaded.png' }),
    });
    const result = await handlers['weixin-mp:upload_image']!({ fileLocation: 'https://example.com/i.png' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.data?.url).toBe('https://wx/uploaded.png');
  });

  it('upload_image：缺 fileLocation → error', async () => {
    const handlers = createWeixinMpHandlers();
    expect(await handlers['weixin-mp:upload_image']!({}, makeCtx())).toEqual({
      success: false,
      error: 'fileLocation is required',
    });
  });

  it('create_draft：title+thumb 校验 + jsonPost 调用', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const handlers = createWeixinMpHandlers({
      jsonPost: async (_url, body) => {
        posts.push(body);
        return { media_id: 'md1' };
      },
    });
    const result = await handlers['weixin-mp:create_draft']!(
      { title: 'T', thumbMediaId: 'thumb1', content: '正文', author: 'bot' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    expect(result.data?.mediaId).toBe('md1');
    expect(posts[0]).toMatchObject({ articles: [{ title: 'T', thumb_media_id: 'thumb1', author: 'bot' }] });
  });

  it('create_draft：缺 title/thumb → error', async () => {
    const handlers = createWeixinMpHandlers();
    expect(await handlers['weixin-mp:create_draft']!({ content: 'x' }, makeCtx())).toEqual({
      success: false,
      error: 'title and thumbMediaId are required',
    });
  });

  it('check_status：未配置 → not_configured；配置 + token 成功 → connected', async () => {
    const handlers = createWeixinMpHandlers();
    const unconfigured = await handlers['weixin-mp:check_status']!({}, makeCtx());
    expect(unconfigured.data?.status).toBe('not_configured');

    const configuredCtx: InvokeContext = {
      tokenManager: { getAccessToken: async () => 'tok', isTokenExpiredError: () => false, invalidateAccessToken: async () => {} },
      pluginConfig: { WEIXIN_MP_APP_ID: 'app', WEIXIN_MP_APP_SECRET: 'sec' },
    };
    const ok = await handlers['weixin-mp:check_status']!({}, configuredCtx);
    expect(ok.data?.status).toBe('connected');
  });

  it('token 过期自动重试（isTokenExpiredError 命中）', async () => {
    let calls = 0;
    const handlers = createWeixinMpHandlers({
      jsonPost: async () => {
        calls += 1;
        if (calls === 1) return { errcode: 40001, errmsg: 'invalid credential' };
        return { media_id: 'md-retry' };
      },
    });
    const ctx: InvokeContext = {
      tokenManager: {
        getAccessToken: async () => 'tok',
        isTokenExpiredError: (code) => code === 40001,
        invalidateAccessToken: async () => {},
      },
      pluginConfig: {},
    };
    const result = await handlers['weixin-mp:create_draft']!({ title: 'T', thumbMediaId: 'th', content: 'c' }, ctx);
    expect(result.data?.mediaId).toBe('md-retry');
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe('ForgeWeixinMpService（Cordis 插件）', () => {
  it('挂载 ctx.forgeWeixinMp + convert + makeInvokeContext', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeWeixinMpService, {
      appId: 'app1',
      appSecret: 'sec1',
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeWeixinMp;
    expect(svc).toBeDefined();
    expect(svc.convert('# 标题')).toContain('<h1');
    const invokeCtx = svc.makeInvokeContext({ getAccessToken: async () => 't', isTokenExpiredError: () => false, invalidateAccessToken: async () => {} });
    expect(invokeCtx.pluginConfig.WEIXIN_MP_APP_ID).toBe('app1');
    const status = await svc.handlers['weixin-mp:check_status']!({}, invokeCtx);
    expect(status.data?.status).toBe('connected');
  });
});
