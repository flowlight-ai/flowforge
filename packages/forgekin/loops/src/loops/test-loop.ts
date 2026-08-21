/**
 * SelfDevTestLoop — 自动化测试自我演进闭环（对齐 Python `evolution/self_dev_test.py`）。
 *
 * 觉醒阶要求：E3（受限自主阶）。对应 Forgekin：测试员·达芬奇（forgemind:davinci）。
 * 安全护栏：I10 不删除/不覆盖已有测试（红线 8）+ T1-T8 铁律检查（仅警告，不阻止写入）。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  DevPlan,
  DevResult,
  DevTask,
  VerifyResult,
  makeDevPlan,
  makeDevResult,
  makeDevTask,
  makeVerifyResult,
} from '../models.js';
import { SelfDevLoopBase } from '../self-dev-loop.js';

/** T1: 禁止 Mock LLM */
const T1_MOCK_LLM_PATTERNS = [
  /mock\s*\(\s*LLMClient\b/,
  /patch\s*\(\s*['"].*LLMClient['"]/,
  /MagicMock\s*\(\s*spec\s*=\s*LLMClient\b/,
  /@patch\s*\(\s*['"].*trae_client['"]/,
];

/** T2: 禁止假数据 */
const T2_FAKE_DATA_PATTERNS = [
  /['"]test['"]\s*[,)]/,
  /['"]hello['"]/,
  /['"]dummy['"]/,
  /['"]fake['"]/,
  /['"]sample['"]/,
];

/** T3: 必须有具体断言（不能只检查 status in ("completed", "error")） */
const T3_VAGUE_ASSERT_PATTERNS = [
  /assert\s+status\s+in\s*\(\s*['"]completed['"]\s*,\s*['"]error['"]\s*\)/,
  /assert\s+result\s+is\s+not\s+None\s*$/,
];

/** T7: LLM 内容必须经 LLM 审核（检查测试代码是否调用 llm_review） */
const T7_REVIEW_PATTERN = /llm_review_content\s*\(/;

export class SelfDevTestLoop extends SelfDevLoopBase {
  readonly loopType = 'test';
  readonly minAwakeningStage = 'E3';

  // §1 Discover — target_files / coverage_gap / test_failure / test_expired ─

  async discover(context: Record<string, unknown>): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    const taskSource = typeof context.task_source === 'string' ? context.task_source : '';
    const targetFiles = Array.isArray(context.target_files) ? context.target_files.map(String) : [];

    if (targetFiles.length > 0) {
      // target_files 模式：为指定源码生成测试
      for (const target of targetFiles) {
        tasks.push(makeDevTask({
          loopType: 'test',
          targetPath: this.inferTestPath(target),
          modificationType: 'create',
          description: `为 ${target} 生成测试`,
          priority: 'high',
          context: { source: 'target_files', sourceFile: target },
        }));
      }
    } else if (taskSource === 'test_failure') {
      const output = typeof context.pytest_output === 'string' ? context.pytest_output : '';
      for (const line of output.split('\n')) {
        const match = /FAILED\s+([^\s:]+\.py)::(\S+)/.exec(line);
        if (match && match[1] && match[2]) {
          tasks.push(makeDevTask({
            loopType: 'test',
            targetPath: match[1],
            modificationType: 'update',
            description: `修复测试失败: ${match[1]}::${match[2]}`,
            priority: 'critical',
            context: { source: 'test_failure', testName: match[2] },
          }));
        }
      }
    } else if (taskSource === 'coverage_gap') {
      const source = typeof context.source_file === 'string' ? context.source_file : '';
      if (source) {
        tasks.push(makeDevTask({
          loopType: 'test',
          targetPath: this.inferTestPath(source),
          modificationType: 'create',
          description: `补全 ${source} 的覆盖缺口`,
          priority: 'normal',
          context: { source: 'coverage_gap', sourceFile: source },
        }));
      }
    }

    return tasks;
  }

  /** 从源码路径推断测试路径（src/x.ts → tests/x.spec.ts） */
  private inferTestPath(source: string): string {
    const base = path.basename(source).replace(/\.[^.]+$/, '');
    return `tests/${base}.spec.ts`;
  }

  // §2 Plan — 通过 LLM 生成测试方案 ────────────────────────────────

  async plan(task: DevTask): Promise<DevPlan> {
    let existingContent = '';
    try {
      existingContent = await fs.readFile(path.resolve(this.projectRoot, task.targetPath), 'utf-8');
    } catch {
      // 测试文件不存在：新建
    }

    const existingSection = existingContent
      ? '【现有测试内容】\n（文件已存在，将追加新用例，不覆盖）\n\n'
      : '【现有测试内容】\n（文件不存在，将新建）\n\n';

    const prompt = [
      '你是 FlowForge 测试员可进化智能体（达芬奇）。请为以下测试任务设计测试方案.',
      '',
      '【任务信息】',
      `目标路径: ${task.targetPath}`,
      `修改类型: ${task.modificationType}`,
      `任务描述: ${task.description}`,
      '',
      existingSection,
      '【要求】',
      '1. 测试必须具体断言，禁止只检查 not None（T3）',
      '2. 禁止 Mock LLM（T1）',
      '3. 禁止假数据占位字符串（T2）',
      '4. 测试代码必须调用 llm_review_content 审核（T7）',
      '',
      '【请输出 JSON】',
      '{"steps": [{"action": "write_file"|"append", "path": "目标路径", "content": "测试代码"}], "expected_effect": "预期效果", "risk_assessment": "low|medium|high"}',
    ].join('\n');

    let content = '';
    let model = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是专业的测试工程师，遵循 T1-T8 测试铁律.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3 },
      );
      content = llmResult.content;
      model = llmResult.model ?? 'unknown';
    } catch (e) {
      return makeDevPlan({
        taskId: task.taskId,
        steps: [{ action: 'write_file', path: task.targetPath, content: `// LLM 调用失败，待人工介入: ${e instanceof Error ? e.message : String(e)}\n` }],
        expectedEffect: 'LLM 调用失败，写入占位符待人工修复',
        riskAssessment: 'high',
        llmModel: 'fallback',
      });
    }

    const parsed = this.parseJsonLoose(content);
    const steps = Array.isArray(parsed?.steps) && parsed.steps.length > 0
      ? parsed.steps
      : [{ action: existingContent ? 'append' : 'write_file', path: task.targetPath, content }];
    return makeDevPlan({
      taskId: task.taskId,
      steps,
      expectedEffect: typeof parsed?.expected_effect === 'string' ? parsed.expected_effect : '测试方案',
      riskAssessment: typeof parsed?.risk_assessment === 'string' ? parsed.risk_assessment : 'medium',
      llmModel: model,
    });
  }

  // §3 Act — 生成测试文件（I10 不覆盖已有）+ T1-T8 检查 ────────────

  async act(plan: DevPlan): Promise<DevResult> {
    const changedFiles: string[] = [];
    const diffSummaryParts: string[] = [];
    let success = true;
    let errorMessage = '';

    for (let idx = 0; idx < plan.steps.length; idx += 1) {
      const step = plan.steps[idx];
      if (!step) {
        continue;
      }
      let action = typeof step.action === 'string' ? step.action : '';
      const target = typeof step.path === 'string' ? step.path : '';
      const content = typeof step.content === 'string' ? step.content : '';

      if (!target) {
        diffSummaryParts.push(`skip step ${idx + 1} (缺少 path)`);
        continue;
      }

      // ── I10 安全护栏：禁止覆盖已有测试文件（自动改为 append）──
      const absPath = path.resolve(this.projectRoot, target);
      if (action === 'write_file') {
        try {
          await fs.access(absPath);
          action = 'append';
        } catch {
          // 文件不存在：保持 write_file
        }
      }

      // ── T1-T8 铁律检查（仅警告，不阻止写入）──
      const violations = this.checkTestQuality(content, target);
      if (violations.length > 0) {
        diffSummaryParts.push(`T 铁律警告: ${violations.join('; ')}`);
      }

      try {
        if (action === 'write_file') {
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, content, 'utf-8');
          changedFiles.push(target);
          diffSummaryParts.push(`write ${target} (${content.length} chars)`);
        } else if (action === 'append') {
          await fs.appendFile(absPath, content, 'utf-8');
          changedFiles.push(target);
          diffSummaryParts.push(`append ${content.length} chars to ${target}`);
        } else {
          diffSummaryParts.push(`skip ${action}`);
        }
      } catch (e) {
        success = false;
        errorMessage = `步骤 ${idx + 1} 失败: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
    }

    return makeDevResult({
      planId: plan.planId,
      changedFiles,
      diffSummary: diffSummaryParts.length > 0 ? diffSummaryParts.join('; ') : '无变更',
      success,
      errorMessage,
    });
  }

  /** T1-T8 铁律检查 — 返回违规列表（仅警告，不阻止写入） */
  private checkTestQuality(content: string, target: string): string[] {
    const violations: string[] = [];
    if (!target.endsWith('.py')) {
      return violations;
    }

    // T1: Mock LLM
    for (const re of T1_MOCK_LLM_PATTERNS) {
      if (re.test(content)) {
        violations.push('T1 违规：检测到 Mock LLM');
        break;
      }
    }
    // T2: 假数据
    for (const re of T2_FAKE_DATA_PATTERNS) {
      if (re.test(content)) {
        violations.push('T2 违规：检测到假数据占位字符串');
        break;
      }
    }
    // T3: 模糊断言
    for (const re of T3_VAGUE_ASSERT_PATTERNS) {
      if (re.test(content)) {
        violations.push('T3 违规：检测到模糊断言');
        break;
      }
    }
    // T7: LLM 审核必经（仅对涉及 LLM 的测试）
    if (/llm|client/i.test(content) && !T7_REVIEW_PATTERN.test(content)) {
      violations.push('T7 违规：涉及 LLM 的测试未调用 llm_review_content 审核');
    }

    return violations;
  }

  // §4 Verify — 文件存在 / T1-T8 复查 / LLM 审核 ───────────────────

  async verify(result: DevResult): Promise<VerifyResult> {
    const checks: Array<Record<string, unknown>> = [];
    const failureReasons: string[] = [];

    // 检查 1: 文件存在性 + T1-T8 复查
    for (const relPath of result.changedFiles) {
      let content: string;
      try {
        content = await fs.readFile(path.resolve(this.projectRoot, relPath), 'utf-8');
      } catch {
        checks.push({ name: `file_exists:${relPath}`, passed: false, detail: '测试文件不存在' });
        failureReasons.push(`测试文件不存在: ${relPath}`);
        continue;
      }
      const violations = this.checkTestQuality(content, relPath);
      checks.push({ name: `t_rules:${relPath}`, passed: violations.length === 0, detail: violations.join('; ') || '通过' });
      if (violations.length > 0) {
        failureReasons.push(`${relPath} T 铁律违规: ${violations.join('; ')}`);
      }
    }

    // 检查 2: LLM 审核（T7 铁律）
    let llmReviewPassed = true;
    if (result.success && result.changedFiles.length > 0) {
      const lastFile = result.changedFiles[result.changedFiles.length - 1];
      if (lastFile) {
        try {
          const contentToReview = await fs.readFile(path.resolve(this.projectRoot, lastFile), 'utf-8');
          const reviewResult = await this.llmReviewContent(contentToReview.slice(0, 4000), 'test_code');
          llmReviewPassed = reviewResult.passed === true;
          const score = typeof reviewResult.score === 'number' ? reviewResult.score : 0;
          checks.push({ name: `llm_review:${lastFile}`, passed: llmReviewPassed, detail: `score=${score}` });
          if (!llmReviewPassed) {
            failureReasons.push(`测试代码 LLM 审核未通过 (score=${score})`);
          }
        } catch (e) {
          llmReviewPassed = false;
          failureReasons.push(`LLM 审核调用失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return makeVerifyResult({
      resultId: result.resultId,
      passed: failureReasons.length === 0,
      checks,
      failureReasons,
      llmReviewPassed,
    });
  }
}
