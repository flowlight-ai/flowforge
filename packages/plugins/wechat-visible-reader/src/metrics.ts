/**
 * WeChat Visible Reader Metrics（C35，自包含移植）。
 *
 * 隐私安全的运行时遥测：只记录结果（成功/失败/错误码），从不记录 OCR
 * 文本、哈希或截图。
 */

import type { WeChatVisibleErrorCode, WeChatVisibleReadResult } from './types.ts';

const RECENT_WINDOW_SIZE = 20;
const PASSIVE_LAYOUT_SUCCESS_FLOOR = 0.8;

export interface WeChatVisibleReaderMetricsSnapshot {
  totalReadAttempts: number;
  totalSuccesses: number;
  typedErrors: Partial<Record<WeChatVisibleErrorCode, number>>;
  recentWindowSize: number;
  recentSuccessRate: number | null;
  layoutPauseRecommended: boolean;
}

export class WeChatVisibleReaderMetrics {
  private totalReadAttempts = 0;
  private totalSuccesses = 0;
  private readonly typedErrors: Partial<Record<WeChatVisibleErrorCode, number>> = {};
  private readonly recentSuccesses: boolean[] = [];

  record(result: WeChatVisibleReadResult): void {
    this.totalReadAttempts += 1;
    this.recentSuccesses.push(result.ok);
    if (this.recentSuccesses.length > RECENT_WINDOW_SIZE) this.recentSuccesses.shift();

    if (result.ok) {
      this.totalSuccesses += 1;
      return;
    }
    this.typedErrors[result.error.code] = (this.typedErrors[result.error.code] ?? 0) + 1;
  }

  snapshot(): WeChatVisibleReaderMetricsSnapshot {
    const recentWindowSize = this.recentSuccesses.length;
    const recentSuccessRate =
      recentWindowSize === 0 ? null : this.recentSuccesses.filter((success) => success).length / recentWindowSize;
    return {
      totalReadAttempts: this.totalReadAttempts,
      totalSuccesses: this.totalSuccesses,
      typedErrors: { ...this.typedErrors },
      recentWindowSize,
      recentSuccessRate,
      layoutPauseRecommended:
        recentWindowSize === RECENT_WINDOW_SIZE &&
        recentSuccessRate !== null &&
        recentSuccessRate < PASSIVE_LAYOUT_SUCCESS_FLOOR,
    };
  }
}
