/**
 * video-analysis 协议模板目录（C35，clowder protocols/gemini.yaml + zhipu.yaml 移植）。
 */

import type { VideoProtocol } from '@flowforge/plugins-video-protocol';

const geminiProtocol: VideoProtocol = {
  name: 'gemini',
  version: 1,
  mode: 'sync',
  baseUrl: 'https://generativelanguage.googleapis.com',
  auth: { method: 'query-param', paramName: 'key' },
  capabilities: {
    analyze_url: {
      mode: 'sync',
      request: {
        method: 'POST',
        path: '/v1beta/models/{{model | default:gemini-2.0-flash}}:generateContent',
        body: {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData: {
                    mimeType: '{{mimeType | default:video/mp4}}',
                    fileUri: '{{videoUrl}}',
                  },
                },
                { text: '{{prompt}}' },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        },
        response: { result: '$.candidates[0].content.parts[0].text' },
      },
    },
  },
};

const zhipuProtocol: VideoProtocol = {
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
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '{{prompt}}' },
                { type: 'video_url', video_url: { url: '{{videoUrl}}' } },
              ],
            },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        },
        response: { result: '$.choices[0].message.content' },
      },
    },
  },
};

export const VIDEO_ANALYSIS_PROTOCOLS: readonly VideoProtocol[] = [geminiProtocol, zhipuProtocol];

export function getVideoAnalysisProtocol(name: string): VideoProtocol | undefined {
  return VIDEO_ANALYSIS_PROTOCOLS.find((protocol) => protocol.name === name);
}
