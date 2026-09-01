/**
 * @flowforge/plugins-weixin-mp — 微信公众号插件（C35 上游参考插件）。
 *
 * TS 移植自 clowder-ai `plugins/weixin-mp/*`：
 *   - markdownToWxHtml：Markdown → 微信 HTML 转换器（内联样式/URL 白名单/转义）
 *   - weixinMpHandlers：convert_markdown / upload_image / upload_material /
 *     create_draft / update_draft / check_status 六处理器（注入式 deps，
 *     路径逃逸校验仅允许 tmpdir）
 *
 * 插件化改造：limb PluginLimbAdapter 契约 → 本包端口类型（TokenManagerPort/
 * InvokeContext/InvokeHandler）；API 凭据经 FF_WEIXIN_MP_APP_ID/SECRET。
 *
 * @module @flowforge/plugins-weixin-mp
 */

import { Context, Service } from '@flowforge/cordis';

import { markdownToWxHtml } from './markdown-to-wx-html.ts';
import { createWeixinMpHandlers, type InvokeHandler, type InvokeContext, type WeixinMpHandlerDeps } from './handlers.ts';

export { markdownToWxHtml } from './markdown-to-wx-html.ts';
export {
  createWeixinMpHandlers,
  weixinMpHandlers,
  validateFilePath,
  MAX_IMAGE_BYTES,
  MAX_TEXT_READ_BYTES,
  TIMEOUT_MS,
  type InvokeContext,
  type InvokeHandler,
  type TokenManagerPort,
  type WeixinMpHandlerDeps,
} from './handlers.ts';

export interface WeixinMpConfig {
  /** 注入式 deps（测试/宿主接线）。 */
  deps?: WeixinMpHandlerDeps;
  /** 插件凭据（缺省读 FF_WEIXIN_MP_APP_ID / FF_WEIXIN_MP_APP_SECRET）。 */
  appId?: string;
  appSecret?: string;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 微信公众号插件（C35）：微信 HTML 转换 + 六处理器注册表。 */
    forgeWeixinMp: ForgeWeixinMpService;
  }
}

export class ForgeWeixinMpService extends Service {
  readonly handlers: Record<string, InvokeHandler>;
  private readonly cfg: WeixinMpConfig;

  constructor(ctx: Context, config: WeixinMpConfig = {}) {
    super(ctx, 'forgeWeixinMp');
    this.cfg = config;
    this.handlers = createWeixinMpHandlers(config.deps ?? {});
  }

  /** Markdown → 微信 HTML。 */
  convert(markdown: string): string {
    return markdownToWxHtml(markdown);
  }

  /** 构造 check_status 的注入 ctx（凭据 + token 管理器由宿主提供）。 */
  makeInvokeContext(tokenManager: InvokeContext['tokenManager']): InvokeContext {
    return {
      tokenManager,
      pluginConfig: {
        WEIXIN_MP_APP_ID: this.cfg.appId ?? process.env.FF_WEIXIN_MP_APP_ID,
        WEIXIN_MP_APP_SECRET: this.cfg.appSecret ?? process.env.FF_WEIXIN_MP_APP_SECRET,
      },
    };
  }
}

export default ForgeWeixinMpService;
