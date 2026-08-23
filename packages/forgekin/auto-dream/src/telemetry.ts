/**
 * auto-dream telemetry — 4 信号 telemetry 计算（对齐 Python TelemetryCollector）。
 *
 * I3: dict 输出，可被 Prometheus 采集。
 *
 * @module @flowforge/forgekin-auto-dream
 */

import { MethodCard } from './models.js';

/** 梦境簇遥测输入（仅需 similarity_score，避免循环依赖） */
export interface TelemetryCluster {
  readonly similarity_score: number;
}

/** 4 信号 telemetry 结果 */
export interface DreamTelemetry {
  /** 整合速率 = processed / total（0.0~1.0） */
  consolidation_rate: number;
  /** 梦境连贯性 = 簇内平均相似度（0.0~1.0，越高越连贯） */
  coherence_score: number;
  /** 意外度 = 1 - 平均相似度（0.0~1.0，越高越意外） */
  surprise_index: number;
  /** 整合深度 = 蒸馏卡片数 / 簇数（0.0~∞，越深越整合） */
  integration_depth: number;
}

/** 4 信号 telemetry 计算（I3: dict 输出） */
export class TelemetryCollector {
  static compute(input: {
    totalEpisodes: number;
    processedEpisodes: number;
    clusters: readonly TelemetryCluster[];
    distilledCards: readonly MethodCard[];
  }): DreamTelemetry {
    const { totalEpisodes, processedEpisodes, clusters, distilledCards } = input;

    // 1. consolidation_rate
    const consolidationRate =
      totalEpisodes > 0 ? processedEpisodes / totalEpisodes : 0.0;

    // 2. coherence_score（簇内平均相似度）
    let coherenceScore = 0.0;
    if (clusters.length > 0) {
      coherenceScore =
        clusters.reduce((sum, c) => sum + c.similarity_score, 0) / clusters.length;
    }

    // 3. surprise_index（1 - 平均相似度，无簇时为 0）
    const surpriseIndex = clusters.length > 0 ? Math.max(0.0, 1.0 - coherenceScore) : 0.0;

    // 4. integration_depth（蒸馏卡片数 / 簇数）
    const integrationDepth =
      clusters.length > 0 ? distilledCards.length / clusters.length : 0.0;

    return {
      consolidation_rate: round4(consolidationRate),
      coherence_score: round4(coherenceScore),
      surprise_index: round4(surpriseIndex),
      integration_depth: round4(integrationDepth),
    };
  }
}

/** 保留 4 位小数（对齐 Python round(x, 4)） */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
