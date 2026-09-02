/**
 * video-gen 协议模板目录（C35，clowder protocols/jimeng.yaml + kling.yaml + zhipu.yaml 移植）。
 */

import type { VideoProtocol } from '@flowforge/plugins-video-protocol';

const jimengProtocol: VideoProtocol = {
  name: 'jimeng',
  version: 1,
  mode: 'async',
  baseUrl: 'https://visual.volcengineapi.com',
  capabilities: {
    text2video: {
      mode: 'async',
      submit: {
        method: 'POST',
        path: '/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
        body: {
          req_key: '{{model | default:jimeng_t2v_v30}}',
          prompt: '{{prompt}}',
          duration: '{{duration}}',
          aspect_ratio: '{{aspectRatio}}',
          negative_prompt: '{{negativePrompt}}',
        },
        response: { taskId: '$.data.task_id', codeField: '$.code', successCode: 10000 },
      },
      poll: {
        method: 'POST',
        path: '/?Action=CVSync2AsyncGetResult&Version=2022-08-31',
        interval: 8000,
        maxAttempts: 75,
        body: {
          req_key: '{{model | default:jimeng_t2v_v30}}',
          task_id: '{{taskId}}',
        },
        response: {
          status: '$.data.status',
          statusMap: { succeeded: ['done'], failed: ['failed', 'not_found'] },
          resultUrl: '$.data.video_url',
          fallbackResultUrl: '$.data.resp_data',
          codeField: '$.code',
          successCode: 10000,
        },
      },
    },
    image2video: {
      mode: 'async',
      submit: {
        method: 'POST',
        path: '/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
        body: {
          req_key: '{{model | default:jimeng_i2v_v20}}',
          prompt: '{{prompt}}',
          image_urls: ['{{imageUrl}}'],
        },
        response: { taskId: '$.data.task_id', codeField: '$.code', successCode: 10000 },
      },
      poll: {
        method: 'POST',
        path: '/?Action=CVSync2AsyncGetResult&Version=2022-08-31',
        interval: 8000,
        maxAttempts: 75,
        body: {
          req_key: '{{model | default:jimeng_i2v_v20}}',
          task_id: '{{taskId}}',
        },
        response: {
          status: '$.data.status',
          statusMap: { succeeded: ['done'], failed: ['failed', 'not_found'] },
          resultUrl: '$.data.video_url',
          fallbackResultUrl: '$.data.resp_data',
          codeField: '$.code',
          successCode: 10000,
        },
      },
    },
    text2image: {
      mode: 'async',
      submit: {
        method: 'POST',
        path: '/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
        body: {
          req_key: '{{model | default:jimeng_high_aes_general_v21}}',
          prompt: '{{prompt}}',
          width: '{{width}}',
          height: '{{height}}',
        },
        response: { taskId: '$.data.task_id', codeField: '$.code', successCode: 10000 },
      },
      poll: {
        method: 'POST',
        path: '/?Action=CVSync2AsyncGetResult&Version=2022-08-31',
        interval: 5000,
        maxAttempts: 60,
        body: {
          req_key: '{{model | default:jimeng_high_aes_general_v21}}',
          task_id: '{{taskId}}',
        },
        response: {
          status: '$.data.status',
          statusMap: { succeeded: ['done'], failed: ['failed', 'not_found'] },
          resultUrl: '$.data.image_urls[0]',
          fallbackResultUrl: '$.data.resp_data',
          codeField: '$.code',
          successCode: 10000,
        },
      },
    },
  },
};

const klingProtocol: VideoProtocol = {
  name: 'kling',
  version: 1,
  mode: 'async',
  baseUrl: 'https://api.klingai.com',
  capabilities: {
    text2video: {
      mode: 'async',
      submit: {
        method: 'POST',
        path: '/v1/videos/text2video',
        body: {
          model_name: '{{model | default:kling-v2.6-pro}}',
          prompt: '{{prompt}}',
          duration: '{{duration}}',
          aspect_ratio: '{{aspectRatio}}',
          negative_prompt: '{{negativePrompt}}',
        },
        response: {
          taskId: '$.data.task_id',
          status: '$.data.task_status',
          statusMap: {
            queued: ['submitted'],
            running: ['processing'],
            succeeded: ['succeed'],
            failed: ['failed'],
          },
        },
      },
      poll: {
        method: 'GET',
        path: '/v1/videos/text2video/{{taskId}}',
        interval: 10000,
        maxAttempts: 60,
        response: {
          status: '$.data.task_status',
          statusMap: {
            queued: ['submitted'],
            running: ['processing'],
            succeeded: ['succeed'],
            failed: ['failed'],
          },
          resultUrl: '$.data.task_result.videos[0].url',
          error: '$.data.task_status_msg',
        },
      },
    },
    image2video: {
      mode: 'async',
      submit: {
        method: 'POST',
        path: '/v1/videos/image2video',
        body: {
          model_name: '{{model | default:kling-v2.6-pro}}',
          prompt: '{{prompt}}',
          image_url: '{{imageUrl}}',
        },
        response: {
          taskId: '$.data.task_id',
          status: '$.data.task_status',
          statusMap: {
            queued: ['submitted'],
            running: ['processing'],
            succeeded: ['succeed'],
            failed: ['failed'],
          },
        },
      },
      poll: {
        method: 'GET',
        path: '/v1/videos/image2video/{{taskId}}',
        interval: 10000,
        maxAttempts: 60,
        response: {
          status: '$.data.task_status',
          statusMap: {
            queued: ['submitted'],
            running: ['processing'],
            succeeded: ['succeed'],
            failed: ['failed'],
          },
          resultUrl: '$.data.task_result.videos[0].url',
          error: '$.data.task_status_msg',
        },
      },
    },
  },
};

const zhipuProtocol: VideoProtocol = {
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
        body: {
          model: '{{model | default:cogvideox-flash}}',
          prompt: '{{prompt}}',
        },
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
        body: {
          model: '{{model | default:cogvideox-flash}}',
          prompt: '{{prompt}}',
          image_url: '{{imageUrl}}',
        },
        response: { taskId: '$.id' },
      },
    },
  },
};

export const VIDEO_GEN_PROTOCOLS: readonly VideoProtocol[] = [zhipuProtocol, klingProtocol, jimengProtocol];

export function getVideoGenProtocol(name: string): VideoProtocol | undefined {
  return VIDEO_GEN_PROTOCOLS.find((protocol) => protocol.name === name);
}
