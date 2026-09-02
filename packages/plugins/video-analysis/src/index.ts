/**
 * @flowforge/plugins-video-analysis — 视频分析上游参考插件（C35）。
 *
 * TS 移植自 clowder-ai `plugins/video-analysis/*`（F205）：声明式视频理解，
 * 通过协议模板适配 Gemini/智谱。协议模板数据见 ./protocols.ts；请求构建与
 * 结果提取复用 @flowforge/plugins-video-protocol 引擎。
 *
 * 环境变量：VIDEO_ANALYSIS_PROVIDER / AUTH_TYPE / API_KEY / BASE_URL / MODEL。
 *
 * @module @flowforge/plugins-video-analysis
 */

import { Context, Service } from '@flowforge/cordis';
import {
  buildRequest,
  extractJsonPath,
  resolveCapability,
  type ProtocolVars,
  type VideoProtocol,
} from '@flowforge/plugins-video-protocol';

import { VIDEO_ANALYSIS_PROTOCOLS, getVideoAnalysisProtocol } from './protocols.ts';

export {
  VIDEO_ANALYSIS_PROTOCOLS,
  getVideoAnalysisProtocol,
} from './protocols.ts';

export interface VideoAnalysisConfigValues {
  provider: string | undefined;
  authType: string | undefined;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  model: string | undefined;
}

export interface VideoAnalysisConfigOptions {
  env?: NodeJS.ProcessEnv;
}

export function resolveVideoAnalysisConfig(options: VideoAnalysisConfigOptions = {}): VideoAnalysisConfigValues {
  const env = options.env ?? process.env;
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    provider: read('VIDEO_ANALYSIS_PROVIDER'),
    authType: read('VIDEO_ANALYSIS_AUTH_TYPE'),
    apiKey: read('VIDEO_ANALYSIS_API_KEY'),
    baseUrl: read('VIDEO_ANALYSIS_BASE_URL'),
    model: read('VIDEO_ANALYSIS_MODEL'),
  };
}

export interface VideoAnalysisRequestInput {
  videoUrl: string;
  prompt: string;
  mimeType?: string;
  model?: string;
}

export interface BuiltVideoAnalysisRequest {
  provider: string;
  method: string;
  url: string;
  body: unknown;
  resultPath: string | undefined;
  auth: { method: string; paramName?: string } | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 视频分析上游参考插件（C35）：协议模板目录 + 请求构建。 */
    forgeVideoAnalysis: ForgeVideoAnalysisService;
  }
}

export class ForgeVideoAnalysisService extends Service {
  readonly config: VideoAnalysisConfigValues;

  constructor(ctx: Context, config: VideoAnalysisConfigOptions = {}) {
    super(ctx, 'forgeVideoAnalysis');
    this.config = resolveVideoAnalysisConfig(config);
  }

  providers(): readonly string[] {
    return VIDEO_ANALYSIS_PROTOCOLS.map((protocol) => protocol.name);
  }

  protocol(name: string): VideoProtocol | undefined {
    return getVideoAnalysisProtocol(name);
  }

  /** 以 config（或显式覆盖）解析 provider 的 analyze 请求。 */
  analyze(providerName: string, input: VideoAnalysisRequestInput): BuiltVideoAnalysisRequest {
    const protocol = getVideoAnalysisProtocol(providerName);
    if (!protocol) throw new Error(`unknown video-analysis provider: ${providerName}`);
    const resolved = resolveCapability(protocol, this.capabilityName(protocol));
    const vars: ProtocolVars = {
      videoUrl: input.videoUrl,
      prompt: input.prompt,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.model ?? this.config.model ? { model: input.model ?? this.config.model } : {}),
    };
    const baseUrl = this.config.baseUrl ?? protocol.baseUrl;
    const request = buildRequest(baseUrl, resolved.submit, vars);
    return {
      provider: providerName,
      method: request.method,
      url: request.url,
      body: request.body,
      resultPath: resolved.submit.response?.result,
      auth: protocol.auth,
    };
  }

  /** 从原生响应提取结果文本。 */
  extractResult(providerName: string, body: unknown): unknown {
    const protocol = getVideoAnalysisProtocol(providerName);
    if (!protocol) throw new Error(`unknown video-analysis provider: ${providerName}`);
    const resolved = resolveCapability(protocol, this.capabilityName(protocol));
    return extractJsonPath(body, resolved.submit.response?.result);
  }

  private capabilityName(protocol: VideoProtocol): string {
    return protocol.capabilities.analyze_url ? 'analyze_url' : 'analyze';
  }
}

export default ForgeVideoAnalysisService;
