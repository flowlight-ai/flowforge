/**
 * @flowforge/plugins-video-gen — 视频/图片生成上游参考插件（C35）。
 *
 * TS 移植自 clowder-ai `plugins/video-gen/*`（F205）：声明式视频/图片生成，
 * 协议模板适配智谱/可灵/即梦（submit + poll 双阶段）。协议模板数据见
 * ./protocols.ts；请求构建/JSONPath 提取/状态归类复用
 * @flowforge/plugins-video-protocol 引擎。
 *
 * 环境变量：VIDEO_GEN_PROVIDER / AUTH_TYPE（apikey|jwt-hs256|hmac-sha256-v4）/
 * API_KEY（apikey）/ ACCESS_KEY + SECRET_KEY（jwt/hmac）/ BASE_URL / MODEL。
 *
 * @module @flowforge/plugins-video-gen
 */

import { Context, Service } from '@flowforge/cordis';
import {
  buildRequest,
  resolveCapability,
  snapshotAsyncResult,
  type AsyncSnapshot,
  type ProtocolVars,
  type VideoProtocol,
} from '@flowforge/plugins-video-protocol';

import { VIDEO_GEN_PROTOCOLS, getVideoGenProtocol } from './protocols.ts';

export { VIDEO_GEN_PROTOCOLS, getVideoGenProtocol } from './protocols.ts';

export interface VideoGenConfigValues {
  provider: string | undefined;
  authType: string | undefined;
  apiKey: string | undefined;
  accessKey: string | undefined;
  secretKey: string | undefined;
  baseUrl: string | undefined;
  model: string | undefined;
}

export interface VideoGenConfigOptions {
  env?: NodeJS.ProcessEnv;
}

export function resolveVideoGenConfig(options: VideoGenConfigOptions = {}): VideoGenConfigValues {
  const env = options.env ?? process.env;
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    provider: read('VIDEO_GEN_PROVIDER'),
    authType: read('VIDEO_GEN_AUTH_TYPE'),
    apiKey: read('VIDEO_GEN_API_KEY'),
    accessKey: read('VIDEO_GEN_ACCESS_KEY'),
    secretKey: read('VIDEO_GEN_SECRET_KEY'),
    baseUrl: read('VIDEO_GEN_BASE_URL'),
    model: read('VIDEO_GEN_MODEL'),
  };
}

export interface BuiltSubmitRequest {
  provider: string;
  capability: string;
  method: string;
  url: string;
  body: unknown;
}

export interface PollRuntimeSpec {
  method: string;
  pathTemplate: string;
  interval: number;
  maxAttempts: number;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 视频生成上游参考插件（C35）：协议模板目录 + submit/poll 请求构建。 */
    forgeVideoGen: ForgeVideoGenService;
  }
}

export class ForgeVideoGenService extends Service {
  readonly config: VideoGenConfigValues;

  constructor(ctx: Context, config: VideoGenConfigOptions = {}) {
    super(ctx, 'forgeVideoGen');
    this.config = resolveVideoGenConfig(config);
  }

  providers(): readonly string[] {
    return VIDEO_GEN_PROTOCOLS.map((protocol) => protocol.name);
  }

  protocol(name: string): VideoProtocol | undefined {
    return getVideoGenProtocol(name);
  }

  capabilityNames(providerName: string): readonly string[] {
    const protocol = this.requireProtocol(providerName);
    return Object.keys(protocol.capabilities);
  }

  /** 提交阶段请求（config model/baseUrl 覆盖优先）。 */
  submit(providerName: string, capabilityName: string, vars: ProtocolVars): BuiltSubmitRequest {
    const protocol = this.requireProtocol(providerName);
    const resolved = resolveCapability(protocol, capabilityName);
    const merged = this.withConfigOverrides(vars);
    const request = buildRequest(this.config.baseUrl ?? protocol.baseUrl, resolved.submit, merged);
    return {
      provider: providerName,
      capability: capabilityName,
      method: request.method,
      url: request.url,
      body: request.body,
    };
  }

  /** 轮询阶段运行时规格（path 模板保留 {{taskId}}，调用方在 poll 时注入）。 */
  pollSpec(providerName: string, capabilityName: string): PollRuntimeSpec {
    const protocol = this.requireProtocol(providerName);
    const resolved = resolveCapability(protocol, capabilityName);
    const poll = resolved.poll;
    if (!poll) throw new Error(`capability "${capabilityName}" has no poll spec`);
    return {
      method: poll.method,
      pathTemplate: poll.path,
      interval: poll.interval,
      maxAttempts: poll.maxAttempts,
    };
  }

  /** 轮询请求（vars 需带 taskId，path/body 占位符随之渲染）。 */
  poll(providerName: string, capabilityName: string, vars: ProtocolVars): BuiltSubmitRequest {
    const protocol = this.requireProtocol(providerName);
    const resolved = resolveCapability(protocol, capabilityName);
    const poll = resolved.poll;
    if (!poll) throw new Error(`capability "${capabilityName}" has no poll spec`);
    const merged = this.withConfigOverrides(vars);
    const request = buildRequest(this.config.baseUrl ?? protocol.baseUrl, poll, merged);
    return {
      provider: providerName,
      capability: capabilityName,
      method: request.method,
      url: request.url,
      body: request.body,
    };
  }

  /** 从响应体提取任务快照（phase 决定用 submit 还是 poll 的 response 规格）。 */
  snapshot(providerName: string, capabilityName: string, body: unknown, phase: 'submit' | 'poll'): AsyncSnapshot {
    const protocol = this.requireProtocol(providerName);
    const resolved = resolveCapability(protocol, capabilityName);
    const response = phase === 'submit' ? resolved.submit.response : resolved.poll?.response;
    if (!response) throw new Error(`capability "${capabilityName}" has no ${phase} response spec`);
    return snapshotAsyncResult(response, body);
  }

  private requireProtocol(name: string): VideoProtocol {
    const protocol = getVideoGenProtocol(name);
    if (!protocol) throw new Error(`unknown video-gen provider: ${name}`);
    return protocol;
  }

  private withConfigOverrides(vars: ProtocolVars): ProtocolVars {
    return {
      ...vars,
      ...(this.config.model ? { model: this.config.model } : {}),
    };
  }
}

export default ForgeVideoGenService;
