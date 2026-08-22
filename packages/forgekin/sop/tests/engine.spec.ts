/**
 * SOPExecutor + YAML 加载 — T7.24 SOP 执行引擎核心语义验证。
 *
 * 对齐 Python `sop/engine.py`：
 * - execute_stage 门禁语义（blocker/warn、可选阶段降级）
 * - execute_sop 顺序执行 + for-break-success 语义
 * - advance_stage / get_progress / reset / resume_from_current
 * - load_sop_from_yaml / load_sops_from_dir（snake_case → camelCase）
 *
 * @module @flowforge/forgekin-sop/tests
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadSopFromYaml,
  loadSopsFromDir,
  SOPExecutor,
} from '../src/engine.js';
import {
  makeHardRule,
  makePitfall,
  makePredicateConfig,
  makeSOPDefinition,
  makeSOPStage,
  PredicateType,
  Severity,
  SOPDefinition,
} from '../src/models.js';
import { PredicateChecker } from '../src/predicate.js';

/** manual_only 恒过规则 */
function passRule(id: string, text: string, severity: Severity = Severity.BLOCKER) {
  return makeHardRule({
    id,
    text,
    severity,
    predicate: makePredicateConfig({ type: PredicateType.MANUAL_ONLY, reason: 'ok' }),
  });
}

/** always_fail 必败规则（自定义注册检查器） */
function failRule(id: string, text: string, severity: Severity = Severity.BLOCKER) {
  return makeHardRule({
    id,
    text,
    severity,
    predicate: makePredicateConfig({ type: 'always_fail' as PredicateType }),
  });
}

function failPitfall(id: string, text: string, severity: Severity = Severity.BLOCKER) {
  return makePitfall({
    id,
    text,
    severity,
    predicate: makePredicateConfig({ type: 'always_fail' as PredicateType }),
  });
}

function makeChecker(): PredicateChecker {
  const checker = new PredicateChecker();
  checker.register('always_fail', async () => ({
    passed: false,
    message: 'intentional failure',
    evidence: {},
  }));
  return checker;
}

function makeSop(stages: ReturnType<typeof makeSOPStage>[]): SOPDefinition {
  return makeSOPDefinition({ id: 'test-sop', label: 'Test SOP', stages });
}

describe('executeStage 门禁语义', () => {
  it('未知阶段 → passed=false + blocker 提示', async () => {
    const executor = new SOPExecutor(makeSop([]), makeChecker());
    const result = await executor.executeStage('ghost');
    expect(result.passed).toBe(false);
    expect(result.blockerMessages).toEqual([
      "stage 'ghost' not found in SOP 'test-sop'",
    ]);
  });

  it('blocker hard_rule 未过 → 阶段阻断', async () => {
    const sop = makeSop([
      makeSOPStage({
        id: 'kickoff',
        label: 'Kickoff',
        hardRules: [passRule('r-ok', 'ok rule'), failRule('r-bad', 'bad rule')],
      }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeStage('kickoff');
    expect(result.passed).toBe(false);
    expect(result.blockerMessages).toHaveLength(1);
    expect(result.blockerMessages[0]).toContain('[r-bad] bad rule');
    expect(result.hardRuleResults).toHaveLength(2);
    expect(result.hardRuleResults[1]!.passed).toBe(false);
  });

  it('warn hard_rule 未过 → 仅警告不阻断', async () => {
    const sop = makeSop([
      makeSOPStage({
        id: 'kickoff',
        hardRules: [failRule('r-warn', 'warn rule', Severity.WARN)],
      }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeStage('kickoff');
    expect(result.passed).toBe(true);
    expect(result.blockerMessages).toHaveLength(0);
    expect(result.warningMessages).toHaveLength(1);
  });

  it('非可选阶段 pitfall blocker → 阻断', async () => {
    const sop = makeSop([
      makeSOPStage({ id: 'impl', pitfalls: [failPitfall('p-1', 'trap')] }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeStage('impl');
    expect(result.passed).toBe(false);
    expect(result.blockerMessages[0]).toContain('[p-1] trap');
  });

  it('可选阶段 pitfall blocker → 降级 warning 且阶段通过', async () => {
    const sop = makeSop([
      makeSOPStage({
        id: 'bonus',
        optional: true,
        pitfalls: [failPitfall('p-1', 'trap')],
      }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeStage('bonus');
    expect(result.passed).toBe(true);
    expect(result.blockerMessages).toHaveLength(0);
    expect(result.warningMessages[0]).toContain('(optional stage) [p-1]');
  });

  it('可选阶段 hard_rule blocker → 降级并清空，阶段通过', async () => {
    const sop = makeSop([
      makeSOPStage({
        id: 'bonus',
        optional: true,
        hardRules: [failRule('r-bad', 'bad rule')],
      }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeStage('bonus');
    expect(result.passed).toBe(true);
    expect(result.blockerMessages).toHaveLength(0);
    expect(result.warningMessages.some((m) => m.startsWith('(optional, downgraded)'))).toBe(true);
  });

  it('阶段结果记录到 state.stageResults', async () => {
    const sop = makeSop([makeSOPStage({ id: 's1', hardRules: [passRule('r', 'ok')] })]);
    const executor = new SOPExecutor(sop, makeChecker());
    await executor.executeStage('s1');
    expect(executor.state.stageResults.s1?.passed).toBe(true);
  });
});

describe('executeSop 流转语义', () => {
  it('全部阶段通过 → success + completed', async () => {
    const sop = makeSop([
      makeSOPStage({ id: 's1', label: 'S1', hardRules: [passRule('r1', 'ok')] }),
      makeSOPStage({ id: 's2', label: 'S2', hardRules: [passRule('r2', 'ok')] }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeSop('feat-001');
    expect(result.success).toBe(true);
    expect(result.sopId).toBe('test-sop');
    expect(result.featureId).toBe('feat-001');
    expect(result.stageResults).toHaveLength(2);
    expect(result.finalStageId).toBe('s2');
    expect(result.completedAt).not.toBeNull();
    expect(executor.state.completed).toBe(true);
  });

  it('第二阶段 blocker → halt，success=false，finalStageId 为阻断阶段', async () => {
    const sop = makeSop([
      makeSOPStage({ id: 's1', hardRules: [passRule('r1', 'ok')] }),
      makeSOPStage({ id: 's2', hardRules: [failRule('r2', 'bad')] }),
      makeSOPStage({ id: 's3', hardRules: [passRule('r3', 'ok')] }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeSop('feat-002');
    expect(result.success).toBe(false);
    expect(result.stageResults).toHaveLength(2);
    expect(result.finalStageId).toBe('s2');
    expect(result.blockerMessages).toHaveLength(1);
    expect(executor.state.completed).toBe(false);
    expect(executor.state.stageIndex).toBe(1);
  });

  it('重复执行时重置状态', async () => {
    const sop = makeSop([makeSOPStage({ id: 's1', hardRules: [passRule('r1', 'ok')] })]);
    const executor = new SOPExecutor(sop, makeChecker());
    await executor.executeSop('feat-a');
    const second = await executor.executeSop('feat-b');
    expect(second.featureId).toBe('feat-b');
    expect(second.stageResults).toHaveLength(1);
  });
});

describe('阶段推进与进度', () => {
  it('advanceStage 推进到末阶段后返回 false 并标记 completed', () => {
    const sop = makeSop([
      makeSOPStage({ id: 's1', label: 'A' }),
      makeSOPStage({ id: 's2', label: 'B' }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    expect(executor.advanceStage()).toBe(true);
    expect(executor.getCurrentStage().id).toBe('s2');
    expect(executor.advanceStage()).toBe(false);
    expect(executor.state.completed).toBe(true);
  });

  it('getProgress 反映当前进度', () => {
    const sop = makeSop([
      makeSOPStage({ id: 's1', label: 'A' }),
      makeSOPStage({ id: 's2', label: 'B' }),
    ]);
    const executor = new SOPExecutor(sop, makeChecker());
    let progress = executor.getProgress();
    expect(progress).toMatchObject({
      sopId: 'test-sop',
      currentStageIndex: 0,
      totalStages: 2,
      completedStages: 0,
      remainingStages: 2,
      currentStageId: 's1',
      currentStageLabel: 'A',
      isCompleted: false,
    });
    executor.advanceStage();
    progress = executor.getProgress();
    expect(progress.currentStageIndex).toBe(1);
    expect(progress.remainingStages).toBe(1);
  });

  it('空 stages 的 SOP：getCurrentStage 抛 RangeError', () => {
    const executor = new SOPExecutor(makeSop([]), makeChecker());
    expect(() => executor.getCurrentStage()).toThrow(RangeError);
    expect(executor.advanceStage()).toBe(false);
    expect(executor.getProgress().currentStageId).toBe('');
  });

  it('getStage 按 ID 查找，未找到返回 null', () => {
    const sop = makeSop([makeSOPStage({ id: 's1' })]);
    const executor = new SOPExecutor(sop, makeChecker());
    expect(executor.getStage('s1')?.id).toBe('s1');
    expect(executor.getStage('nope')).toBeNull();
  });

  it('reset 与 resumeFromCurrent', () => {
    const sop = makeSop([makeSOPStage({ id: 's1' }), makeSOPStage({ id: 's2' })]);
    const executor = new SOPExecutor(sop, makeChecker());
    executor.advanceStage();
    executor.advanceStage(); // completed=true
    executor.resumeFromCurrent();
    expect(executor.state.completed).toBe(false);
    expect(executor.state.stageIndex).toBe(1);
    executor.reset();
    expect(executor.state.stageIndex).toBe(0);
    expect(Object.keys(executor.state.stageResults)).toHaveLength(0);
  });
});

describe('YAML 加载', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sop-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loadSopFromYaml：snake_case 字段转 camelCase 并填默认值', async () => {
    const yamlText = `
id: development
label: Development SOP
stages:
  - id: kickoff
    label: Kickoff
    suggested_skill: skill-a
    hard_rules:
      - id: rule-1
        text: must check spec
        predicate:
          type: manual_only
          reason: confirm spec
    pitfalls:
      - id: pit-1
        text: watch env
        predicate:
          type: env_check
          env_vars:
            - FOO
  - id: bonus
    optional: true
`;
    const path = join(dir, 'development.yaml');
    await writeFile(path, yamlText, 'utf-8');
    const sop = await loadSopFromYaml(path);
    expect(sop.id).toBe('development');
    expect(sop.domain).toBe('engineering');
    expect(sop.stages).toHaveLength(2);
    const kickoff = sop.stages[0]!;
    expect(kickoff.suggestedSkill).toBe('skill-a');
    expect(kickoff.hardRules[0]!.severity).toBe(Severity.BLOCKER);
    expect(kickoff.hardRules[0]!.predicate.type).toBe(PredicateType.MANUAL_ONLY);
    expect(kickoff.hardRules[0]!.predicate.reason).toBe('confirm spec');
    expect(kickoff.pitfalls[0]!.severity).toBe(Severity.WARN);
    expect(kickoff.pitfalls[0]!.predicate.envVars).toEqual(['FOO']);
    expect(sop.stages[1]!.optional).toBe(true);
  });

  it('缺 id / predicate 的 YAML 抛错', async () => {
    const path = join(dir, 'broken.yaml');
    await writeFile(path, 'stages: []\n', 'utf-8');
    await expect(loadSopFromYaml(path)).rejects.toThrow('id is required');

    const path2 = join(dir, 'broken2.yaml');
    await writeFile(
      path2,
      'id: x\nstages:\n  - id: s1\n    hard_rules:\n      - id: r1\n        text: t\n',
      'utf-8',
    );
    await expect(loadSopFromYaml(path2)).rejects.toThrow('predicate');
  });

  it('loadSopsFromDir：加载 *.yaml，坏文件跳过，非 yaml 忽略', async () => {
    await writeFile(
      join(dir, 'a.yaml'),
      'id: sop-a\nstages:\n  - id: s1\n',
      'utf-8',
    );
    await writeFile(join(dir, 'b.yaml'), '{{{not yaml', 'utf-8');
    await writeFile(join(dir, 'c.yml'), 'id: sop-c\n', 'utf-8');
    const sops = await loadSopsFromDir(dir);
    expect([...sops.keys()]).toEqual(['sop-a']);
    expect(sops.get('sop-a')!.stages).toHaveLength(1);
  });

  it('loadSopsFromDir：目录不存在 → 空 Map', async () => {
    const sops = await loadSopsFromDir(join(dir, 'no-such-dir'));
    expect(sops.size).toBe(0);
  });

  it('内置 development.yaml 保真加载（对齐 config/sops/development.yaml）', async () => {
    const sop = await loadSopFromYaml(
      join(import.meta.dirname, '..', 'sops', 'development.yaml'),
    );
    expect(sop.id).toBe('development');
    expect(sop.domain).toBe('engineering');
    expect(sop.stages.length).toBeGreaterThanOrEqual(2);
    expect(sop.stages[0]!.id).toBe('kickoff');
    // 含 git_state_predicate 阻断规则（main 双向同步）
    const impl = sop.stages.find((s) => s.id === 'impl');
    expect(
      impl!.hardRules.some((r) => r.predicate.type === PredicateType.GIT_STATE_PREDICATE),
    ).toBe(true);
    const executor = new SOPExecutor(sop, makeChecker());
    expect(executor.getProgress().totalStages).toBe(sop.stages.length);
  });

  it('加载的 SOP 可直接驱动 SOPExecutor', async () => {
    const path = join(dir, 'flow.yaml');
    await writeFile(
      path,
      `
id: mini
stages:
  - id: only
    hard_rules:
      - id: r1
        text: manual gate
        predicate:
          type: manual_only
`,
      'utf-8',
    );
    const sop = await loadSopFromYaml(path);
    const executor = new SOPExecutor(sop, makeChecker());
    const result = await executor.executeSop('feat-x');
    expect(result.success).toBe(true);
  });
});
