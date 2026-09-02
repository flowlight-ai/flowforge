/**
 * WeChat Visible Reader invoke handlers（C35，自包含移植，注入式 deps）。
 *
 * 两个平台特定命令：
 *   - read_visible_conversation：arm 授权后读取当前可见会话正文
 *   - read_conversation_recent：owner 在 thread 中显式授权 + 确认清未读后，
 *     导航到目标会话读取最近消息
 *
 * 插件化改造：clowder `domains/limb/PluginLimbAdapter`（InvokeHandler）→
 * 本包本地端口类型（params + ctx → 结构化结果）。
 */

import type { WeChatVisibleReaderArmStore } from './arm-store.ts';
import type { WeChatVisibleReaderMetrics } from './metrics.ts';
import type { WeChatVisibleReaderNativeRunner } from './native-runner.ts';

/** InvokeHandler：params + ctx → 结构化结果（与 weixin-mp 端口一致）。 */
export type InvokeHandler = (
  params: Record<string, unknown>,
  ctx: InvokeContext,
) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;

export interface InvokeContext {
  readonly invocation?: {
    catId?: string;
    invocationId?: string;
    userId?: string;
    threadId?: string;
    userMessageId?: string;
  };
}

export interface WeChatVisibleReaderHandlerDeps {
  armStore: WeChatVisibleReaderArmStore;
  metrics: WeChatVisibleReaderMetrics;
  runner: WeChatVisibleReaderNativeRunner;
}

export function createWeChatVisibleReaderHandlers(deps: WeChatVisibleReaderHandlerDeps): Record<string, InvokeHandler> {
  const readVisibleConversation: InvokeHandler = async (params) => {
    if (!deps.armStore.isArmed()) {
      return {
        success: true,
        data: {
          ok: false,
          error: {
            code: 'authorization_required',
            userAction: '请由本机 owner 在 Plugin Hub 中短时授权微信正文读取。',
          },
        },
      };
    }

    const options: { maxBlocks?: number; maxChars?: number } = {};
    if (params.maxBlocks !== undefined) options.maxBlocks = params.maxBlocks as number;
    if (params.maxChars !== undefined) options.maxChars = params.maxChars as number;
    const result = await deps.runner.read(options);
    deps.metrics.record(result);
    return { success: true, data: result };
  };

  const readConversationRecent: InvokeHandler = async (params, context) => {
    const invocation = context.invocation;
    const hasTrustedOwnerMessage = Boolean(
      invocation?.catId &&
        invocation.invocationId &&
        invocation.userId &&
        invocation.threadId &&
        invocation.userMessageId,
    );
    if (!hasTrustedOwnerMessage || params.acknowledgeUiNavigation !== true || params.acknowledgeMayMarkRead !== true) {
      return {
        success: true,
        data: {
          ok: false,
          error: {
            code: 'authorization_required',
            userAction: '请由 owner 在当前 thread 明确授权本次微信前台导航，并确认可能清除目标会话未读。',
          },
        },
      };
    }

    const contact = typeof params.contact === 'string' ? params.contact.trim() : '';
    const limit = params.limit;
    const containsControlCharacter = [...contact].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    });
    if (
      contact.length === 0 ||
      [...contact].length > 128 ||
      containsControlCharacter ||
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 30
    ) {
      return {
        success: true,
        data: {
          ok: false,
          error: {
            code: 'navigation_failed',
            userAction: '联系人必须是 1-128 个可见字符，读取条数必须是 1-30 的整数。',
          },
        },
      };
    }

    const result = await deps.runner.readConversationRecent({ contact, limit });
    return { success: true, data: result };
  };

  return {
    'wechat-visible-reader:read_visible_conversation': readVisibleConversation,
    'wechat-visible-reader:read_conversation_recent': readConversationRecent,
  };
}
