/**
 * @flowforge/cats-teamact — T7.17 TeamActState 状态机契约验证。
 *
 * 对齐 `core/teamact/state_machine.py`（F002 §2 + roleagent.md §2）：
 *   - advance 六步推进 + iteration 轮数 + EVIDENCE 自动标记 evidence_attached
 *   - checkTermination 自动推导（evidence / no_dangling）+ 显式标记
 *   - passBall 胶囊硬要求（isValid + to_agent 一致性）
 *   - escalate 升级 CVO/operator
 *   - toSummary / getOpenQuestions / hasEvidence / toJSON
 *
 * @module @flowforge/cats-teamact/tests
 */

import { describe, expect, it } from 'vitest';
import { BallStatus, TeamActStep, TerminationCondition } from '../src/types.js';
import { CVO_AGENT_ID, HistoryEntry, TeamActState, TerminationReport } from '../src/state-machine.js';
import { newHandoffCapsule } from '../src/handoff.js';

function makeState(taskId = 'task_1') {
  return new TeamActState({
    taskId,
    ballHolder: 'architect',
    currentStep: TeamActStep.STATE,
  });
}

describe('TerminationReport 五项条件', () => {
  it('初始全部未满足 → isTerminated=false', () => {
    const report = new TerminationReport();
    expect(report.isTerminated()).toBe(false);
    expect(report.missingConditions().length).toBe(5);
  });

  it('五项全标记 → isTerminated=true，metConditions 齐全', () => {
    const report = new TerminationReport();
    for (const cond of TerminationCondition.all()) {
      report.mark(cond, true);
    }
    expect(report.isTerminated()).toBe(true);
    expect(report.metConditions().length).toBe(5);
    expect(report.missingConditions()).toEqual([]);
  });

  it('toSummary 显示 TERMINATED/NOT_TERMINATED 与缺失项', () => {
    const report = new TerminationReport();
    expect(report.toSummary()).toContain('NOT_TERMINATED');
    report.mark(TerminationCondition.ACCEPTANCE_DONE, true);
    report.mark(TerminationCondition.EVIDENCE_ATTACHED, true);
    report.mark(TerminationCondition.CROSS_VALIDATED, true);
    report.mark(TerminationCondition.NO_DANGLING_OWNERSHIP, true);
    report.mark(TerminationCondition.VISION_CONVERGED, true);
    expect(report.toSummary()).toContain('TERMINATED');
    expect(report.toSummary()).toContain('missing=[(none)]');
  });
});

describe('TeamActState.advance 六步推进', () => {
  it('从 STATE 顺序推进六步', () => {
    const state = makeState();
    expect(state.advance()).toBe(TeamActStep.OWNER);
    expect(state.advance()).toBe(TeamActStep.ACTION);
    expect(state.advance()).toBe(TeamActStep.EVIDENCE);
    expect(state.advance()).toBe(TeamActStep.VERDICT);
    expect(state.advance()).toBe(TeamActStep.ROUTE);
  });

  it('ROUTE → STATE 时 iteration +1（完成一轮循环）', () => {
    const state = makeState();
    for (let i = 0; i < 6; i += 1) state.advance();
    expect(state.currentStep).toBe(TeamActStep.STATE);
    expect(state.iteration).toBe(1);
    expect(state.history.length).toBe(6);
  });

  it('EVIDENCE 步骤产出证据 → 自动标记 evidence_attached', () => {
    const state = makeState();
    state.currentStep = TeamActStep.EVIDENCE;
    state.advance('写测试', 'commit abc123');
    expect(state.terminationStatus.evidenceAttached).toBe(true);
  });

  it('advance 记录 history 条目（含 agent 与时间戳）', () => {
    const state = makeState();
    state.advance('读 spec', '');
    const entry = state.history[0]!;
    expect(entry).toBeInstanceOf(HistoryEntry);
    expect(entry.step).toBe(TeamActStep.STATE);
    expect(entry.agent).toBe('architect');
    expect(entry.timestamp).toBeInstanceOf(Date);
  });
});

describe('TeamActState 终止检查', () => {
  it('checkTermination 自动推导 evidence_attached', () => {
    const state = makeState();
    state.advance('动作', 'trace-1');
    const report = state.checkTermination();
    expect(report.evidenceAttached).toBe(true);
  });

  it('checkTermination 自动推导 no_dangling_ownership（全部胶囊无开放问题）', () => {
    const state = makeState();
    state.capsules.push(
      newHandoffCapsule({ fromAgent: 'a', toAgent: 'b', taskSummary: 's', nextStep: 'n', openQuestions: [] }),
    );
    const report = state.checkTermination();
    expect(report.noDanglingOwnership).toBe(true);
  });

  it('存在开放问题 → no_dangling_ownership 不满足', () => {
    const state = makeState();
    state.capsules.push(
      newHandoffCapsule({
        fromAgent: 'a',
        toAgent: 'b',
        taskSummary: 's',
        nextStep: 'n',
        openQuestions: ['如何刷新 token?'],
      }),
    );
    const report = state.checkTermination();
    expect(report.noDanglingOwnership).toBe(false);
  });

  it('markTermination 显式标记 vision_converged（CVO 确认不可被 proxy 替代）', () => {
    const state = makeState();
    state.markTermination(TerminationCondition.VISION_CONVERGED, true);
    expect(state.terminationStatus.visionConverged).toBe(true);
  });
});

describe('TeamActState.passBall 传球', () => {
  it('有效胶囊传球成功：更新持球者 + 记录胶囊与历史', () => {
    const state = makeState();
    const capsule = newHandoffCapsule({
      fromAgent: 'architect',
      toAgent: 'developer',
      taskSummary: '设计完成',
      nextStep: '实现',
    });
    const ok = state.passBall('developer', capsule);
    expect(ok).toBe(true);
    expect(state.ballHolder).toBe('developer');
    expect(state.ballStatus).toBe(BallStatus.PASSED);
    expect(state.capsules.length).toBe(1);
    expect(state.history.some((h) => h.action.includes('pass_ball'))).toBe(true);
  });

  it('胶囊 toAgent 与参数不一致 → 拒绝', () => {
    const state = makeState();
    const capsule = newHandoffCapsule({
      fromAgent: 'architect',
      toAgent: 'tester',
      taskSummary: 's',
      nextStep: 'n',
    });
    expect(state.passBall('developer', capsule)).toBe(false);
    expect(state.ballHolder).toBe('architect');
  });

  it('无效胶囊（自己交给自己）→ 拒绝', () => {
    const state = makeState();
    const capsule = newHandoffCapsule({
      fromAgent: 'architect',
      toAgent: 'architect',
      taskSummary: 's',
      nextStep: 'n',
    });
    expect(state.passBall('architect', capsule)).toBe(false);
  });
});

describe('TeamActState.escalate 升级', () => {
  it('升级给 CVO（默认）', () => {
    const state = makeState();
    state.escalate();
    expect(state.ballHolder).toBe(CVO_AGENT_ID);
    expect(state.ballStatus).toBe(BallStatus.ESCALATED);
  });

  it('升级给 operator（toCvo=false）', () => {
    const state = makeState();
    state.escalate(false);
    expect(state.ballHolder).toBe('operator');
  });
});

describe('TeamActState 摘要与序列化', () => {
  it('toSummary 包含 task/step/holder/ball/iter/terminated', () => {
    const s = makeState('task_x').toSummary();
    expect(s).toContain('task=task_x');
    expect(s).toContain('step=state');
    expect(s).toContain('holder=architect');
    expect(s).toContain('ball=held');
  });

  it('getOpenQuestions 汇总所有胶囊开放问题', () => {
    const state = makeState();
    state.capsules.push(
      newHandoffCapsule({ fromAgent: 'a', toAgent: 'b', taskSummary: 's', nextStep: 'n', openQuestions: ['q1'] }),
      newHandoffCapsule({ fromAgent: 'c', toAgent: 'd', taskSummary: 's', nextStep: 'n', openQuestions: ['q2', 'q3'] }),
    );
    expect(state.getOpenQuestions()).toEqual(['q1', 'q2', 'q3']);
  });

  it('hasEvidence 检查历史证据', () => {
    const state = makeState();
    expect(state.hasEvidence()).toBe(false);
    state.advance('', 'trace-9');
    expect(state.hasEvidence()).toBe(true);
  });

  it('toJSON 可序列化（无 Date 残留）', () => {
    const json = JSON.parse(JSON.stringify(makeState().toJSON()));
    expect(json.taskId).toBe('task_1');
    expect(json.currentStep).toBe('state');
    expect(typeof json.history).toBe('object');
  });
});
