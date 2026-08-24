/**
 * qc-loop — T7.20 CL-034 QC Loop 7-Step 验证。
 *
 * 覆盖：7 步顺序 / 三层 reviewer 报告 / 报告结构 /
 * max_iterations 校验 / 假时钟可注入。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import { QC_STEPS, QCLoop, REVIEWER_LAYERS } from '../src/qc-loop.js';

describe('QCLoop', () => {
  it('max_iterations < 1 抛错', () => {
    expect(() => new QCLoop({ maxIterations: 0 })).toThrow(/max_iterations must be >= 1/);
  });

  it('run 顺序执行 7 步并生成报告（骨架单次不迭代）', async () => {
    const loop = new QCLoop({ maxIterations: 3, nowMs: () => 1000 });
    const report = await loop.run('target-1', { file_a: 'x', file_b: 'y' });

    expect(report.targetId).toBe('target-1');
    expect(report.iterationCount).toBe(1);
    expect(report.finalStatus).toBe('passed');

    const steps = report.stepResults.map((s) => s.step);
    expect(steps).toEqual([...QC_STEPS]);

    // 全部步骤 passed
    for (const step of report.stepResults) {
      expect(step.passed).toBe(true);
    }

    // prepare 步骤输出 scope
    const prepare = report.stepResults[0];
    expect(prepare?.output['scope']).toEqual(['file_a', 'file_b']);
    expect(prepare?.output['artifact_count']).toBe(2);

    // iterate 步骤输出 max_iterations
    const iterate = report.stepResults.find((s) => s.step === 'iterate');
    expect(iterate?.output['max_iterations']).toBe(3);
    expect(iterate?.output['continue_iteration']).toBe(false);
  });

  it('三层 reviewer 报告（architecture/logic/detail 骨架空报告）', async () => {
    const loop = new QCLoop();
    const report = await loop.run('t', {});
    expect(report.reviewerReports.map((r) => r.layer)).toEqual([...REVIEWER_LAYERS]);
    for (const r of report.reviewerReports) {
      expect(r.reviewerId).toContain('_reviewer_skeleton');
      expect(r.issues).toEqual([]);
      expect(r.passCount).toBe(1);
      expect(r.failCount).toBe(0);
    }
  });

  it('getLastReport 返回上次报告', async () => {
    const loop = new QCLoop();
    expect(loop.getLastReport()).toBeNull();
    const report = await loop.run('t', {});
    expect(loop.getLastReport()).toBe(report);
  });

  it('假时钟注入使 duration 可预测（0ms 差异）', async () => {
    const now = 0;
    const loop = new QCLoop({ nowMs: () => now });
    const report = await loop.run('t', { a: 1 });
    for (const step of report.stepResults) {
      expect(step.durationSeconds).toBe(0);
    }
  });
});
