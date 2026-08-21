/**
 * SelfDevFrameworkLoop — 框架自我演进闭环（对齐 Python `evolution/self_dev_framework.py`）。
 *
 * 觉醒阶要求：E5（完全自主阶）。对应 Forgekin：架构师·鲁班（forgemind:luban）。
 * 安全护栏：I8 Framework 需 approval — 所有 Act 必须 operator 显式批准。
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
import { ApprovalRequiredError } from '../errors.js';
import { SelfDevLoopBase, SelfDevLoopOptions } from '../self-dev-loop.js';

const DEFAULT_CONFIG_PATTERNS = ['**/*.yaml', '**/*.yml'];
const DEFAULT_ADR_DIR = 'docs/decisions';

/** I8 approval 回调：operator 显式批准（plan, task）→ boolean */
export type ApprovalCallback = (plan: DevPlan, task: DevTask) => Promise<boolean> | boolean;

export class SelfDevFrameworkLoop extends SelfDevLoopBase {
  readonly loopType = 'framework';
  readonly minAwakeningStage = 'E5';

  private readonly approvalCallback: ApprovalCallback | undefined;

  constructor(options: SelfDevLoopOptions) {
    super(options);
    this.approvalCallback = typeof options.forgekinConfig.approval_callback === 'function'
      ? options.forgekinConfig.approval_callback as ApprovalCallback
      : undefined;
  }

  // §1 Discover — 架构偏离 / 配置不一致 / 依赖图问题 ───────────────

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
          loopType: 'framework',
          targetPath: target,
          modificationType: modType,
          description: `定向调整框架配置: ${target}`,
          priority: 'high',
          context: { source: 'force_targets' },
        }));
      }
    } else if (taskSource === 'architecture_drift') {
      tasks.push(...await this.discoverArchitectureDrift());
    } else if (taskSource === 'config_inconsistency') {
      tasks.push(...await this.discoverConfigInconsistency());
    } else if (taskSource === 'dependency_graph') {
      tasks.push(...await this.discoverDependencyGraphIssues());
    }

    return tasks;
  }

  /** 检测架构偏离：ADR 中标记 "status: superseded" 的条目 */
  private async discoverArchitectureDrift(): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    const adrDir = path.resolve(this.projectRoot, DEFAULT_ADR_DIR);
    let files: string[];
    try {
      files = await fs.readdir(adrDir);
    } catch {
      return tasks;
    }
    for (const name of files) {
      if (!name.endsWith('.md')) {
        continue;
      }
      let content: string;
      try {
        content = await fs.readFile(path.join(adrDir, name), 'utf-8');
      } catch {
        continue;
      }
      if (/status:\s*superseded/.test(content)) {
        const relPath = `${DEFAULT_ADR_DIR}/${name}`;
        tasks.push(makeDevTask({
          loopType: 'framework',
          targetPath: relPath,
          modificationType: 'update',
          description: `ADR 已被取代（superseded），需检查架构偏离: ${name}`,
          priority: 'high',
          context: { source: 'architecture_drift' },
        }));
      }
    }
    return tasks;
  }

  /** 检测配置不一致：YAML 顶层键含 TODO 占位（简化：只扫根目录，对齐 Python rglob 语义） */
  private async discoverConfigInconsistency(): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    const seenFiles = new Set<string>();
    for (const pattern of DEFAULT_CONFIG_PATTERNS) {
      // 解析 pattern 提取扩展名："**/*.yaml" → ext="yaml"
      const extMatch = /\.(ya?ml)$/.exec(pattern);
      if (!extMatch || !extMatch[1]) {
        continue;
      }
      const ext = extMatch[1];
      let names: string[];
      try {
        names = await fs.readdir(path.resolve(this.projectRoot, ''));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(`.${ext}`) || seenFiles.has(name)) {
          continue;
        }
        seenFiles.add(name);
        const relPath = name;
        let content: string;
        try {
          content = await fs.readFile(path.resolve(this.projectRoot, relPath), 'utf-8');
        } catch {
          continue;
        }
        if (/TODO|FIXME|待定/.test(content)) {
          tasks.push(makeDevTask({
            loopType: 'framework',
            targetPath: relPath,
            modificationType: 'update',
            description: `配置含 TODO/待定占位，需与代码对齐: ${name}`,
            priority: 'normal',
            context: { source: 'config_inconsistency' },
          }));
        }
      }
    }
    return tasks;
  }

  /** 检测依赖图问题：包内 import 出现循环引用标记（简化启发式） */
  private async discoverDependencyGraphIssues(): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    const pkgJsonPath = path.resolve(this.projectRoot, 'package.json');
    try {
      const pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
      const workspace = pkg.workspaces;
      if (Array.isArray(workspace)) {
        tasks.push(makeDevTask({
          loopType: 'framework',
          targetPath: 'package.json',
          modificationType: 'update',
          description: '检测到 monorepo workspace 配置，需人工确认依赖图无循环（依赖图检查占位）',
          priority: 'low',
          context: { source: 'dependency_graph', workspaces: workspace },
        }));
      }
    } catch {
      // package.json 不存在：跳过
    }
    return tasks;
  }

  // §2 Plan — 通过 LLM 设计架构调整方案（I8 requiresApproval 强制） ─

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
      ? `【现有内容（前 2000 字符）】\n\`\`\`\n${existingContent.slice(0, 2000)}\n\`\`\`\n\n`
      : '【现有内容】\n（文件不存在，需创建）\n\n';

    const prompt = [
      '你是 FlowForge 架构师可进化智能体（鲁班）。请为以下框架/架构任务设计修改方案.',
      '',
      '【任务信息】',
      `目标路径: ${task.targetPath}`,
      `修改类型: ${task.modificationType}`,
      `任务描述: ${task.description}`,
      `上下文: ${JSON.stringify(task.context)}`,
      '',
      existingSection,
      '【要求】',
      '1. 框架级变更必须标注 requires_approval=true（I8：operator 显式批准）',
      '2. 不修改 VISION.md / CONTRIBUTING.md / SOP.md / decisions/（I2）',
      '3. 新建 ADR 使用 create_adr action',
      '',
      '【请输出 JSON】',
      '{"steps": [{"action": "update_yaml"|"create_adr"|"update_dependency", "path": "目标路径", "content": "内容"}], "expected_effect": "预期效果", "risk_assessment": "low|medium|high", "requires_approval": true}',
    ].join('\n');

    let content = '';
    let model = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是严格的架构师，框架变更必须获得 operator 批准.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2 },
      );
      content = llmResult.content;
      model = llmResult.model ?? 'unknown';
    } catch (e) {
      return makeDevPlan({
        taskId: task.taskId,
        steps: [{ action: 'update_yaml', path: task.targetPath, content: `# LLM 调用失败，待人工介入: ${e instanceof Error ? e.message : String(e)}\n` }],
        expectedEffect: 'LLM 调用失败，写入占位符待人工修复',
        riskAssessment: 'high',
        requiresApproval: true,
        llmModel: 'fallback',
      });
    }

    const parsed = this.parseJsonLoose(content);
    const steps = Array.isArray(parsed?.steps) && parsed.steps.length > 0
      ? parsed.steps
      : [{ action: 'update_yaml', path: task.targetPath, content }];
    return makeDevPlan({
      taskId: task.taskId,
      steps,
      expectedEffect: typeof parsed?.expected_effect === 'string' ? parsed.expected_effect : '架构调整方案',
      riskAssessment: typeof parsed?.risk_assessment === 'string' ? parsed.risk_assessment : 'high',
      // I8：Framework 闭环的所有 Plan 必须 requiresApproval（operator 显式批准）
      requiresApproval: true,
      llmModel: model,
    });
  }

  // §3 Act — 执行架构修改（I8 approval 强制） ──────────────────────

  async act(plan: DevPlan): Promise<DevResult> {
    // ── I8 approval 检查：未批准则抛 ApprovalRequiredError ──
    if (plan.requiresApproval) {
      const approved = await this.requestApproval(plan);
      if (!approved) {
        const target = typeof plan.steps[0]?.path === 'string' ? plan.steps[0].path : '';
        throw new ApprovalRequiredError(plan.planId, target);
      }
    }

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

      const absPath = path.resolve(this.projectRoot, target);
      try {
        if (action === 'update_yaml' || action === 'update_dependency' || action === 'create_adr') {
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, content, 'utf-8');
          changedFiles.push(target);
          diffSummaryParts.push(`${action} ${target} (${content.length} chars)`);
        } else {
          diffSummaryParts.push(`skip unknown action: ${action}`);
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

  /** I8 approval 请求 — 调用 approvalCallback 获得 operator 批准 */
  private async requestApproval(plan: DevPlan): Promise<boolean> {
    if (this.approvalCallback === undefined) {
      return false; // 未配置 callback：所有 Act 都被阻止
    }
    const task = makeDevTask({
      loopType: 'framework',
      targetPath: typeof plan.steps[0]?.path === 'string' ? plan.steps[0].path : '',
      modificationType: 'framework',
      description: plan.expectedEffect,
    });
    const result = await this.approvalCallback(plan, task);
    return result === true;
  }

  // §4 Verify — 文件存在 / YAML 语法 / ADR front-matter / LLM 审核 ─

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

    // 检查 2: YAML 语法检查（简单结构校验：顶层键对齐）与 3: ADR front-matter
    for (const relPath of result.changedFiles) {
      const absPath = path.resolve(this.projectRoot, relPath);
      let content: string;
      try {
        content = await fs.readFile(absPath, 'utf-8');
      } catch {
        continue;
      }

      if (relPath.endsWith('.yaml') || relPath.endsWith('.yml')) {
        const linesOk = content.split('\n').every((line) => {
          const trimmed = line.trim();
          return trimmed === '' || trimmed.startsWith('#') || /^[a-zA-Z_][\w-]*:/.test(trimmed) || trimmed.startsWith('-') || trimmed.startsWith('  ') || trimmed.startsWith('\t');
        });
        checks.push({ name: `yaml_syntax:${relPath}`, passed: linesOk, detail: linesOk ? '结构合法' : '疑似缩进/键格式错误' });
        if (!linesOk) {
          failureReasons.push(`${relPath} YAML 语法检查失败`);
        }
      }

      if (relPath.startsWith('docs/decisions/')) {
        const hasFm = /^---\s*\n/.test(content);
        checks.push({ name: `adr_front_matter:${relPath}`, passed: hasFm, detail: hasFm ? '有 front-matter' : '缺少 front-matter' });
        if (!hasFm) {
          failureReasons.push(`${relPath} 缺少 ADR front-matter`);
        }
      }
    }

    // 检查 4: LLM 内容审核（T7 铁律）
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
        const reviewResult = await this.llmReviewContent(contentToReview.slice(0, 4000), 'config');
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
