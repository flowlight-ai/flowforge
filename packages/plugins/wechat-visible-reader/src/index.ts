/**
 * @flowforge/plugins-wechat-visible-reader — 微信正文可见读取插件（C35 上游参考插件）。
 *
 * TS 移植自 clowder-ai `packages/api/src/plugins/wechat-visible-reader/*`：
 *   - zod 严格校验原生读取结果（types.ts：NormalizedRect/VisibleMessageUnit
 *     三态/成功+失败判别联合 + parse* 解析器）
 *   - native-runner：Swift 源码哈希键控缓存编译 + 四命令执行
 *   - handlers：read_visible_conversation / read_conversation_recent
 *   - arm-store：owner 短时授权闸门（1-30 分钟 TTL）
 *   - metrics：隐私安全遥测（只记结果不记正文）
 *
 * 插件化改造：clowder `PluginLimbAdapter` → 本包本地端口类型；native 源文件
 * 路径由宿主注入（sourcePaths）。
 *
 * @module @flowforge/plugins-wechat-visible-reader
 */

import { Context, Service } from '@flowforge/cordis';

import { WeChatVisibleReaderArmStore } from './arm-store.ts';
import {
  createWeChatVisibleReaderHandlers,
  type InvokeContext,
  type InvokeHandler,
} from './handlers.ts';
import { WeChatVisibleReaderMetrics } from './metrics.ts';
import {
  createWeChatVisibleReaderNativeRunner,
  type WeChatVisibleReaderNativeRunner,
  type WeChatVisibleReaderNativeRunnerOptions,
} from './native-runner.ts';

export { WeChatVisibleReaderArmStore, type WeChatVisibleReaderArmStatus } from './arm-store.ts';
export { createWeChatVisibleReaderHandlers, type InvokeContext, type InvokeHandler } from './handlers.ts';
export { WeChatVisibleReaderMetrics, type WeChatVisibleReaderMetricsSnapshot } from './metrics.ts';
export {
  createWeChatVisibleReaderNativeRunner,
  DEFAULT_WECHAT_VISIBLE_BLOCKS,
  DEFAULT_WECHAT_VISIBLE_CHARS,
  MAX_WECHAT_VISIBLE_BLOCKS,
  MAX_WECHAT_VISIBLE_CHARS,
  type NativeCommandExecutor,
  type NativeExecutionOptions,
  type WeChatConversationRecentOptions,
  type WeChatVisibleReadOptions,
  type WeChatVisibleReaderNativeRunner,
  type WeChatVisibleReaderNativeRunnerOptions,
} from './native-runner.ts';
export * from './types.ts';

export interface WeChatVisibleReaderConfig {
  /** 原生 Swift 源文件路径（宿主注入；缺省不编译，执行回落到 capture_failed）。 */
  sourcePaths?: readonly string[];
  sourceDigest?: string;
  cacheDirectory?: string;
  /** 预编译可执行文件（测试缝）。 */
  executablePath?: string;
  /** 执行器（测试缝）。 */
  execute?: WeChatVisibleReaderNativeRunnerOptions['execute'];
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 微信正文可见读取插件（C35）：arm 授权 + 原生读取 runner + 遥测。 */
    forgeWeChatVisibleReader: ForgeWeChatVisibleReaderService;
  }
}

export class ForgeWeChatVisibleReaderService extends Service {
  readonly runner: WeChatVisibleReaderNativeRunner;
  readonly armStore: WeChatVisibleReaderArmStore;
  readonly metrics: WeChatVisibleReaderMetrics;
  readonly handlers: Record<string, InvokeHandler>;

  constructor(ctx: Context, config: WeChatVisibleReaderConfig = {}) {
    super(ctx, 'forgeWeChatVisibleReader');
    this.runner = createWeChatVisibleReaderNativeRunner({
      ...(config.sourcePaths ? { sourcePaths: config.sourcePaths } : {}),
      ...(config.sourceDigest ? { sourceDigest: config.sourceDigest } : {}),
      ...(config.cacheDirectory ? { cacheDirectory: config.cacheDirectory } : {}),
      ...(config.executablePath ? { executablePath: config.executablePath } : {}),
      ...(config.execute ? { execute: config.execute } : {}),
    });
    this.armStore = new WeChatVisibleReaderArmStore();
    this.metrics = new WeChatVisibleReaderMetrics();
    this.handlers = createWeChatVisibleReaderHandlers({
      armStore: this.armStore,
      metrics: this.metrics,
      runner: this.runner,
    });
  }

  /** owner 短时授权微信正文读取（1-30 分钟）。 */
  arm(operator: string, minutes: number) {
    return this.armStore.arm({ operator, minutes });
  }

  /** 构造注入 ctx（宿主把本次调用的 owner thread 溯源传入）。 */
  makeInvokeContext(invocation?: InvokeContext['invocation']): InvokeContext {
    return invocation ? { invocation } : {};
  }
}

export default ForgeWeChatVisibleReaderService;
