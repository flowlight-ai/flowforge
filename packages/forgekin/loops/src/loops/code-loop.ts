/**
 * SelfDevCodeLoop — 代码自我演进闭环（对齐 Python `evolution/self_dev_code.py`）。
 *
 * 觉醒阶要求：E4（自主阶）。对应 Forgekin：开发者·夏洛克（forgemind:sherlock）。
 * 安全护栏：I5 不删除测试（红线 8）/ I6 不绕过 DI（红线 12）/ I7 不硬编码（红线 11）。
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

/** I5 不删除测试：禁止删除的文件名模式（红线 8） */
const TEST_FILE_PATTERNS = [
  /^test_.*\.py$/,
  /.*_test\.py$/,
  /^conftest\.py$/,
];

/** I6 不绕过 DI：合法的依赖注入方式（任一匹配即通过） */
const DI_PATTERNS = [
  /def __init__\([^)]*\b\w+:\s*\w+Container\b/,
  /def __init__\([^)]*\b\w+:\s*[A-Z]\w+Client\b/,
  /def __init__\([^)]*\b\w+:\s*[A-Z]\w+Engine\b/,
  /def __init__\([^)]*\b\w+:\s*[A-Z]\w+Repository\b/,
  /@inject\b/,
  /container\.resolve\(/,
  /container\.get\(/,
];

/** I6 反模式：直接实例化（出现即违规） */
const DIRECT_INSTANTIATION_PATTERNS = [
  /^\s*from\s+flowforge\.llm\.trae\.client\s+import\s+TraeLLMClient\s*$/,
  /^\s*from\s+flowforge\.db\.session\s+import\s+Session\b.*$/,
  /^\s*cursor\.execute\(/,
  /^\s*Session\(\)/,
];

/** I7 不硬编码：禁止的模式 */
const HARDCODED_PATH_PATTERNS = [
  /['"](?:\/home\/|\/Users\/|C:\\Users\\|D:\\software\\)/,
  /['"](?:\/opt\/|\/var\/|\/etc\/)/,
];
const HARDCODED_SECRET_PATTERNS = [
  /api_key\s*=\s*['"]sk-[a-zA-Z0-9]+/,
  /password\s*=\s*['"][^'"]+['"]/,
  /secret\s*=\s*['"][^'"]+['"]/,
  /token\s*=\s*['"][^'"]+['"]/,
];
const HARDCODED_PORT_PATTERNS = [
  /port\s*=\s*\d{4,5}\b(?!.*\bconfig\b)/,
];

export class SelfDevCodeLoop extends SelfDevLoopBase {
  readonly loopType = 'code';
  readonly minAwakeningStage = 'E4';

  // §1 Discover — pytest 失败 / task.md / bug 报告 ─────────────────

  async discover(context: Record<string, unknown>): Promise<DevTask[]> {
    const tasks: DevTask[] = [];

    const taskSource = typeof context.task_source === 'string' ? context.task_source : '';
    const forceTargets = Array.isArray(context.force_targets) ? context.force_targets.map(String) : [];

    if (forceTargets.length > 0) {
      for (const target of forceTargets) {
        const absPath = path.resolve(this.projectRoot, target);
        let modType = 'create';
        try {
          await fs.access(absPath);
          modType = 'update';
        } catch {
          // 不存在 → create
        }
        tasks.push(makeDevTask({
          loopType: 'code',
          targetPath: target,
          modificationType: modType,
          description: `定向修改代码: ${target}`,
          priority: 'high',
          context: { source: 'force_targets' },
        }));
      }
    } else if (taskSource === 'pytest_failure') {
      const output = typeof context.pytest_output === 'string' ? context.pytest_output : '';
      tasks.push(...this.discoverFromPytestFailure(output));
    } else if (taskSource === 'task_md') {
      const taskMdPath = typeof context.task_md_path === 'string' ? context.task_md_path : '';
      tasks.push(...await this.discoverFromTaskMd(taskMdPath));
    } else if (taskSource === 'bug_report') {
      const bugReport = typeof context.bug_report === 'string' ? context.bug_report : '';
      tasks.push(...this.discoverFromBugReport(bugReport));
    }

    return tasks;
  }

  /** 从 pytest 失败输出提取待修复任务 */
  private discoverFromPytestFailure(pytestOutput: string): DevTask[] {
    const tasks: DevTask[] = [];
    if (!pytestOutput) {
      return tasks;
    }
    // 匹配 FAILED tests/test_x.py::test_y 行
    for (const line of pytestOutput.split('\n')) {
      const match = /FAILED\s+([^\s:]+\.py)::(\S+)/.exec(line);
      if (match && match[1] && match[2]) {
        const testFile = match[1];
        const sourceFile = this.inferSourceFromTest(testFile);
        tasks.push(makeDevTask({
          loopType: 'code',
          targetPath: sourceFile || testFile,
          modificationType: 'update',
          description: `修复测试失败: ${testFile}::${match[2]}`,
          priority: 'critical',
          context: { source: 'pytest_failure', testFile, testName: match[2] },
        }));
      }
    }
    return tasks;
  }

  /** 从测试文件路径推断源文件路径（tests/test_x.py → src/x.py） */
  private inferSourceFromTest(testFile: string): string {
    const base = path.basename(testFile).replace(/^test_/, '').replace(/_test\.py$/, '.py').replace(/\.py$/, '.py');
    const normalized = testFile.replaceAll('\\', '/');
    if (normalized.startsWith('tests/')) {
      return `src/${base}`;
    }
    return base;
  }

  /** 从 task.md 提取未实现项（匹配 "## N. xxx（未实现）" 行） */
  private async discoverFromTaskMd(taskMdPath: string): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    if (!taskMdPath) {
      return tasks;
    }
    let content: string;
    try {
      content = await fs.readFile(path.resolve(this.projectRoot, taskMdPath), 'utf-8');
    } catch {
      return tasks;
    }
    for (const line of content.split('\n')) {
      const match = /^##\s+\d+\.\s+(.+?)[（(]\s*未实现\s*[）)]/.exec(line);
      if (match && match[1]) {
        const desc = match[1].trim();
        tasks.push(makeDevTask({
          loopType: 'code',
          targetPath: '',
          modificationType: 'create',
          description: `实现未完成项: ${desc}`,
          priority: 'high',
          context: { source: 'task_md' },
        }));
      }
    }
    return tasks;
  }

  /** 从 bug 报告字符串提取任务（每行一个 bug） */
  private discoverFromBugReport(bugReport: string): DevTask[] {
    const tasks: DevTask[] = [];
    if (!bugReport) {
      return tasks;
    }
    for (const line of bugReport.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        tasks.push(makeDevTask({
          loopType: 'code',
          targetPath: '',
          modificationType: 'update',
          description: `修复 bug: ${trimmed.slice(0, 100)}`,
          priority: 'high',
          context: { source: 'bug_report' },
        }));
      }
    }
    return tasks;
  }

  // §2 Plan — 通过 LLM 生成代码方案 ────────────────────────────────

  async plan(task: DevTask): Promise<DevPlan> {
    let existingContent = '';
    if (task.targetPath) {
      try {
        existingContent = await fs.readFile(path.resolve(this.projectRoot, task.targetPath), 'utf-8');
      } catch {
        // 文件不存在
      }
    }

    const existingSection = existingContent
      ? `【现有代码内容（前 2000 字符）】\n\`\`\`\n${existingContent.slice(0, 2000)}\n\`\`\`\n\n`
      : '【现有代码内容】\n（文件不存在，需创建新文件）\n\n';

    const prompt = [
      '你是 FlowForge 开发者可进化智能体（夏洛克）。请为以下代码任务设计修改方案.',
      '',
      '【任务信息】',
      `目标路径: ${task.targetPath}`,
      `修改类型: ${task.modificationType}`,
      `任务描述: ${task.description}`,
      `上下文: ${JSON.stringify(task.context)}`,
      '',
      existingSection,
      '【要求】',
      '1. 不删除已有测试文件（红线 8）',
      '2. 依赖必须通过构造注入或 DI 容器（红线 12）',
      '3. 禁止硬编码路径/密钥/端口（红线 11）',
      '',
      '【请输出 JSON】',
      '{"steps": [{"action": "write_file"|"update_section"|"append", "path": "目标路径", "content": "代码内容"}], "expected_effect": "预期效果", "risk_assessment": "low|medium|high"}',
    ].join('\n');

    let content = '';
    let model = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是专业的代码实现助手，遵循项目铁律（I5/I6/I7）.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3 },
      );
      content = llmResult.content;
      model = llmResult.model ?? 'unknown';
    } catch (e) {
      return makeDevPlan({
        taskId: task.taskId,
        steps: [{ action: 'write_file', path: task.targetPath, content: `# LLM 调用失败，待人工介入: ${e instanceof Error ? e.message : String(e)}\n` }],
        expectedEffect: 'LLM 调用失败，写入占位符待人工修复',
        riskAssessment: 'high',
        llmModel: 'fallback',
      });
    }

    const parsed = this.parseJsonLoose(content);
    const steps = Array.isArray(parsed?.steps) && parsed.steps.length > 0
      ? parsed.steps
      : [{ action: 'write_file', path: task.targetPath, content }];
    return makeDevPlan({
      taskId: task.taskId,
      steps,
      expectedEffect: typeof parsed?.expected_effect === 'string' ? parsed.expected_effect : '代码修改方案',
      riskAssessment: typeof parsed?.risk_assessment === 'string' ? parsed.risk_assessment : 'medium',
      llmModel: model,
    });
  }

  // §3 Act — 执行代码修改（I5/I6/I7 前置检查） ─────────────────────

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
      const action = typeof step.action === 'string' ? step.action : '';
      const target = typeof step.path === 'string' ? step.path : '';
      const content = typeof step.content === 'string' ? step.content : '';

      if (!target) {
        diffSummaryParts.push(`skip step ${idx + 1} (缺少 path)`);
        continue;
      }

      // ── I5 安全护栏：禁止删除测试文件 ──
      if (action === 'delete' && this.isTestFile(target)) {
        success = false;
        errorMessage = `I5 违规：禁止删除测试文件 ${target}（红线 8）`;
        break;
      }

      const absPath = path.resolve(this.projectRoot, target);
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
        } else if (action === 'update_section') {
          // 简化：全量重写（与 write_file 同效），保留语义标记
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, content, 'utf-8');
          changedFiles.push(target);
          diffSummaryParts.push(`update ${target}`);
        } else {
          diffSummaryParts.push(`skip unknown action: ${action}`);
        }

        // ── I6/I7 检查（对新写入的代码内容）──
        if (content) {
          const violations = this.checkGuardrails(content);
          if (violations.length > 0) {
            success = false;
            errorMessage = `步骤 ${idx + 1} 安全护栏违规: ${violations.join('; ')}`;
            break;
          }
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

  /** I5 判断：是否为测试文件 */
  private isTestFile(target: string): boolean {
    const base = path.basename(target);
    return TEST_FILE_PATTERNS.some((re) => re.test(base));
  }

  /** I6/I7 安全护栏检查：返回违规列表 */
  private checkGuardrails(content: string): string[] {
    const violations: string[] = [];

    // I6 不绕过 DI：若出现直接实例化反模式，且无任何合法 DI 模式（对齐 Python：逐行匹配）
    const lines = content.split('\n');
    const hasDirect = DIRECT_INSTANTIATION_PATTERNS.some((re) => lines.some((line) => re.test(line)));
    const hasDi = DI_PATTERNS.some((re) => re.test(content));
    if (hasDirect && !hasDi) {
      violations.push('I6 违规：检测到直接实例化（未通过 DI 注入）');
    }

    // I7 不硬编码
    for (const re of HARDCODED_PATH_PATTERNS) {
      if (re.test(content)) {
        violations.push(`I7 违规：检测到硬编码绝对路径 ${JSON.stringify(re.source.slice(0, 40))}`);
        break;
      }
    }
    for (const re of HARDCODED_SECRET_PATTERNS) {
      if (re.test(content)) {
        violations.push(`I7 违规：检测到硬编码密钥/口令`);
        break;
      }
    }
    for (const re of HARDCODED_PORT_PATTERNS) {
      if (re.test(content)) {
        violations.push(`I7 违规：检测到硬编码端口`);
        break;
      }
    }

    return violations;
  }

  // §4 Verify — 文件存在 / 语法 / I6/I7 复查 / LLM 审核 ────────────

  async verify(result: DevResult): Promise<VerifyResult> {
    const checks: Array<Record<string, unknown>> = [];
    const failureReasons: string[] = [];

    // 检查 1: 文件存在性
    for (const relPath of result.changedFiles) {
      let exists = false;
      try {
        await fs.access(path.resolve(this.projectRoot, relPath));
        exists = true;
      } catch {
        // 不存在
      }
      checks.push({ name: `file_exists:${relPath}`, passed: exists, detail: `路径 ${relPath} ${exists ? '存在' : '不存在'}` });
      if (!exists) {
        failureReasons.push(`文件不存在: ${relPath}`);
      }
    }

    // 检查 2: I6/I7 安全护栏复查（对修改后的文件）
    for (const relPath of result.changedFiles) {
      let content: string;
      try {
        content = await fs.readFile(path.resolve(this.projectRoot, relPath), 'utf-8');
      } catch {
        continue;
      }
      const violations = this.checkGuardrails(content);
      checks.push({ name: `guardrails:${relPath}`, passed: violations.length === 0, detail: violations.join('; ') || '通过' });
      if (violations.length > 0) {
        failureReasons.push(`${relPath} 安全护栏违规: ${violations.join('; ')}`);
      }
    }

    // 检查 3: LLM 内容审核（T7 铁律）
    let llmReviewPassed = true;
    if (result.success && result.changedFiles.length > 0) {
      const lastFile = result.changedFiles[result.changedFiles.length - 1];
      if (!lastFile) {
        return makeVerifyResult({
          resultId: result.resultId,
          passed: failureReasons.length === 0,
          checks,
          failureReasons,
          llmReviewPassed,
        });
      }
      try {
        const contentToReview = await fs.readFile(path.resolve(this.projectRoot, lastFile), 'utf-8');
        const reviewResult = await this.llmReviewContent(contentToReview.slice(0, 4000), 'code');
        llmReviewPassed = reviewResult.passed === true;
        const score = typeof reviewResult.score === 'number' ? reviewResult.score : 0;
        const issues = Array.isArray(reviewResult.issues) ? reviewResult.issues.map(String) : [];
        checks.push({ name: `llm_review:${lastFile}`, passed: llmReviewPassed, detail: `score=${score}, issues=${issues.slice(0, 3)}` });
        if (!llmReviewPassed) {
          failureReasons.push(`LLM 审核未通过 (score=${score}): ${issues.slice(0, 2)}`);
        }
      } catch (e) {
        llmReviewPassed = false;
        failureReasons.push(`LLM 审核调用失败: ${e instanceof Error ? e.message : String(e)}`);
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
