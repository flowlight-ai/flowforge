/**
 * telemetry — 4 信号 telemetry 计算验证。
 *
 * 覆盖：consolidation_rate / coherence_score / surprise_index /
 * integration_depth 及空输入边界。
 *
 * @module @flowforge/forgekin-auto-dream/tests
 */

import { describe, expect, it } from 'vitest';
import { MethodCard } from '../src/models.js';
import { TelemetryCollector, round4 } from '../src/telemetry.js';

describe('TelemetryCollector.compute', () => {
  it('正常输入：四信号按公式计算并保留 4 位小数', () => {
    const clusters = [{ similarity_score: 0.8 }, { similarity_score: 0.6 }];
    const cards = [
      new MethodCard({ title: 'a', domain: 'development', content: 'x' }),
      new MethodCard({ title: 'b', domain: 'development', content: 'y' }),
    ];
    const telemetry = TelemetryCollector.compute({
      totalEpisodes: 4,
      processedEpisodes: 3,
      clusters,
      distilledCards: cards,
    });
    expect(telemetry.consolidation_rate).toBe(0.75);
    expect(telemetry.coherence_score).toBe(0.7);
    expect(telemetry.surprise_index).toBe(0.3);
    expect(telemetry.integration_depth).toBe(1.0);
  });

  it('空输入：全零且不除零', () => {
    const telemetry = TelemetryCollector.compute({
      totalEpisodes: 0,
      processedEpisodes: 0,
      clusters: [],
      distilledCards: [],
    });
    expect(telemetry).toEqual({
      consolidation_rate: 0,
      coherence_score: 0,
      surprise_index: 0,
      integration_depth: 0,
    });
  });

  it('有簇无蒸馏卡片 → integration_depth 0；无簇有卡片 → 0', () => {
    const card = new MethodCard({ title: 'a', domain: 'development', content: 'x' });
    expect(
      TelemetryCollector.compute({
        totalEpisodes: 1,
        processedEpisodes: 1,
        clusters: [{ similarity_score: 1.0 }],
        distilledCards: [],
      }).integration_depth,
    ).toBe(0);
    expect(
      TelemetryCollector.compute({
        totalEpisodes: 1,
        processedEpisodes: 1,
        clusters: [],
        distilledCards: [card],
      }).integration_depth,
    ).toBe(0);
  });
});

describe('round4', () => {
  it('保留 4 位小数', () => {
    expect(round4(0.123456)).toBe(0.1235);
    expect(round4(1 / 3)).toBe(0.3333);
  });
});
