/**
 * evidence-sensors — Layer3 验证现实测试（对齐 Python test_evidence_sensors.py）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import {
  createSensorReading,
  EvidenceCollector,
  EvidenceSource,
  SensorBase,
  type SensorReading,
} from '../src/evidence-sensors.js';

describe('EvidenceCollector 采集', () => {
  it('collect 计算 sha256 哈希 + 自动验证', async () => {
    const collector = new EvidenceCollector();
    const evidence = await collector.collect(EvidenceSource.COMMIT, 'abc123', {
      commit_url: 'https://example.com/c/abc123',
    });
    expect(evidence.evidence_id).toMatch(/^ev-[0-9a-f]{12}$/);
    expect(evidence.hash).toHaveLength(64); // sha256 hex
    expect(evidence.verified).toBe(true);
    expect(evidence.metadata['commit_url']).toBe('https://example.com/c/abc123');
    expect(collector.getEvidence(evidence.evidence_id)).toBe(evidence);
  });

  it('未启用来源 → 抛错', async () => {
    const collector = new EvidenceCollector({
      enabledSources: [EvidenceSource.COMMIT, EvidenceSource.TEST],
    });
    await expect(
      collector.collect(EvidenceSource.SCREENSHOT, 'shot'),
    ).rejects.toThrow('not enabled');
  });

  it('autoVerify=false 时 verified=false', async () => {
    const collector = new EvidenceCollector({ autoVerify: false });
    const evidence = await collector.collect(EvidenceSource.LOG, 'line1');
    expect(evidence.verified).toBe(false);
    // 手动校验通过
    expect(await collector.verify(evidence)).toBe(true);
  });

  it('哈希不一致 → verify 失败（证据被篡改）', async () => {
    const collector = new EvidenceCollector({ autoVerify: false });
    const evidence = await collector.collect(EvidenceSource.TEST, 'original');
    const tampered = { ...evidence, content: 'tampered' };
    expect(await collector.verify(tampered)).toBe(false);
  });

  it('listEvidence 按来源过滤', async () => {
    const collector = new EvidenceCollector();
    await collector.collect(EvidenceSource.COMMIT, 'c1');
    await collector.collect(EvidenceSource.TEST, 't1');
    await collector.collect(EvidenceSource.TEST, 't2');
    expect(collector.listEvidence().length).toBe(3);
    expect(collector.listEvidence(EvidenceSource.TEST).length).toBe(2);
  });
});

describe('SensorBase 传感器', () => {
  it('自定义传感器 observe 返回读数 + 异常标记', async () => {
    class FakeSensor extends SensorBase {
      constructor() {
        super('latency-sensor', 'Trace Latency');
      }

      async observe(): Promise<SensorReading> {
        return createSensorReading(this.sensorId, 250, {
          unit: 'ms',
          anomaly: 250 > 200,
        });
      }
    }

    const sensor = new FakeSensor();
    expect(sensor.name).toBe('Trace Latency');
    const reading = await sensor.observe();
    expect(reading.sensor_id).toBe('latency-sensor');
    expect(reading.value).toBe(250);
    expect(reading.unit).toBe('ms');
    expect(reading.anomaly).toBe(true);
    expect(reading.reading_id).toMatch(/^rd-[0-9a-f]{12}$/);
  });

  it('name 缺省时回落为 sensor_id', () => {
    class MinimalSensor extends SensorBase {
      async observe(): Promise<SensorReading> {
        return createSensorReading(this.sensorId, 1);
      }
    }
    expect(new MinimalSensor('s1').name).toBe('s1');
  });
});
