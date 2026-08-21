/**
 * SelfDevDocLoop — 文档自我演进闭环（对齐 Python `evolution/self_dev_doc.py`）。
 *
 * 觉醒阶要求：E3（受限自主阶）。处理 docs/** / README.md / SETUP.md 等文档。
 * 安全护栏：I2 Scope Guard（VISION/CONTRIBUTING/SOP/decisions 不可变）+ I4 LLM 审核（T7）。
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
import { SelfDevLoopBase, SelfDevLoopOptions } from '../self-dev-loop.js';

const DEFAULT_DOCS_DIR = 'docs';
const DEFAULT_MAX_AGE_DAYS = 90;

/** YAML front-matter（--- 包裹） */
const FRONT_MATTER_RE = /^---\s*\n(.*?\n)---\s*\n/s;
/** 标题层级（# 开头） */
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

export class SelfDevDocLoop extends SelfDevLoopBase {
  readonly loopType = 'doc';
  readonly minAwakeningStage = 'E3';

  private readonly docsDir: string;
  private readonly maxAgeDays: number;

  constructor(options: SelfDevLoopOptions) {
    super(options);
    this.docsDir = typeof options.forgekinConfig.docs_dir === 'string' ? options.forgekinConfig.docs_dir : DEFAULT_DOCS_DIR;
    this.maxAgeDays = typeof options.forgekinConfig.max_age_days === 'number' ? options.forgekinConfig.max_age_days : DEFAULT_MAX_AGE_DAYS;
  }

  // §1 Discover — 检测过期/格式/缺失文档 ──────────────────────────

  async discover(context: Record<string, unknown>): Promise<DevTask[]> {
    const forceTargets = Array.isArray(context.force_targets) ? context.force_targets.map(String) : [];
    const tasks: DevTask[] = [];

    // force_targets 模式：定向更新，跳过扫描
    if (forceTargets.length > 0) {
      for (const target of forceTargets) {
        tasks.push(makeDevTask({
          loopType: 'doc',
          targetPath: target,
          modificationType: 'update',
          description: `定向更新文档: ${target}`,
          priority: 'high',
          context: { source: 'force_targets' },
        }));
      }
      return this.sortByPriority(tasks);
    }

    // 扫描 docs/ 目录（递归收集 .md 文件）+ 顶层 README.md/SETUP.md
    const scanRoots = Array.isArray(context.scan_patterns)
      ? context.scan_patterns.map(String)
      : [this.docsDir, 'README.md', 'SETUP.md'];
    const maxAgeDays = typeof context.max_age_days === 'number' ? context.max_age_days : this.maxAgeDays;

    for (const pattern of scanRoots) {
      const absPath = path.resolve(this.projectRoot, pattern);
      try {
        const stat = await fs.stat(absPath);
        if (stat.isFile()) {
          const task = await this.checkStale(pattern, stat, maxAgeDays);
          if (task) {
            tasks.push(task);
            continue;
          }
          const formatTask = await this.checkFormatIssues(pattern);
          if (formatTask) {
            tasks.push(formatTask);
          }
        } else if (stat.isDirectory()) {
          const files = await this.walkMdFiles(absPath);
          for (const relPath of files) {
            const task = await this.checkStale(relPath, await fs.stat(path.resolve(this.projectRoot, relPath)), maxAgeDays);
            if (task) {
              tasks.push(task);
              continue;
            }
            const formatTask = await this.checkFormatIssues(relPath);
            if (formatTask) {
              tasks.push(formatTask);
            }
          }
        }
      } catch {
        // 路径不存在：跳过
      }
    }

    // 检测缺失文档（features/F0XX 存在但 design/D0XX 缺失）
    tasks.push(...await this.checkMissingDocs());

    return this.sortByPriority(tasks);
  }

  private async walkMdFiles(dir: string): Promise<string[]> {
    const result: string[] = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return result;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(this.projectRoot, abs).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        result.push(...await this.walkMdFiles(abs));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(rel);
      }
    }
    return result;
  }

  /** 检测过期文档（mtime 超过 max_age_days） */
  private async checkStale(relPath: string, stat: { mtimeMs: number }, maxAgeDays: number): Promise<DevTask | null> {
    const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
    if (ageDays > maxAgeDays) {
      return makeDevTask({
        loopType: 'doc',
        targetPath: relPath,
        modificationType: 'update',
        description: `文档已过期 ${Math.round(ageDays)} 天（阈值 ${maxAgeDays} 天），需检查内容是否与代码一致`,
        priority: 'normal',
        context: { source: 'stale_detect', ageDays: Math.round(ageDays) },
      });
    }
    return null;
  }

  /** 检测格式问题（无 front-matter / 标题层级错乱） */
  private async checkFormatIssues(relPath: string): Promise<DevTask | null> {
    let content: string;
    try {
      content = await fs.readFile(path.resolve(this.projectRoot, relPath), 'utf-8');
    } catch {
      return null;
    }
    const issues: string[] = [];

    // front-matter（仅 docs/ 下的文档强制要求）
    if (relPath.startsWith('docs/') && !FRONT_MATTER_RE.test(content)) {
      issues.push('缺少 front-matter（YAML 头部）');
    }

    // 标题层级（必须从 # 或 ## 开始，不能跳级）
    const headings = [...content.matchAll(HEADING_RE)];
    const firstHeading = headings[0];
    const firstLevel = firstHeading && firstHeading[1] ? firstHeading[1].length : 0;
    if (firstLevel > 2) {
      issues.push(`首个标题层级过深 (#${firstLevel}，应为 # 或 ##)`);
    }

    if (issues.length === 0) {
      return null;
    }
    return makeDevTask({
      loopType: 'doc',
      targetPath: relPath,
      modificationType: 'update',
      description: `格式问题: ${issues.join(', ')}`,
      priority: 'normal',
      context: { source: 'format_check', issues },
    });
  }

  /** 检测缺失文档（features/F0XX-xxx.md 存在但 design/D0XX-xxx.md 缺失） */
  private async checkMissingDocs(): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    const featuresDir = path.resolve(this.projectRoot, this.docsDir, 'features');
    const designDir = path.resolve(this.projectRoot, this.docsDir, 'design');
    let files: string[];
    try {
      files = await fs.readdir(featuresDir);
    } catch {
      return tasks;
    }
    for (const name of files) {
      const match = /^F(\d{3})-(.+)$/.exec(name);
      if (!match) {
        continue;
      }
      const designName = `D${match[1]}-${match[2]}`;
      try {
        await fs.access(path.join(designDir, designName));
      } catch {
        const relPath = `docs/design/${designName}`;
        tasks.push(makeDevTask({
          loopType: 'doc',
          targetPath: relPath,
          modificationType: 'create',
          description: `为 feature ${name} 创建对应的 design 文档`,
          priority: 'high',
          context: { source: 'missing_detect', featureFile: name },
        }));
      }
    }
    return tasks;
  }

  private sortByPriority(tasks: DevTask[]): DevTask[] {
    const order: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    return [...tasks].sort((a, b) => (order[a.priority] ?? 99) - (order[b.priority] ?? 99));
  }

  // §2 Plan — 通过 LLM 生成文档方案 ────────────────────────────────

  async plan(task: DevTask): Promise<DevPlan> {
    let existingContent = '';
    const absPath = path.resolve(this.projectRoot, task.targetPath);
    try {
      existingContent = await fs.readFile(absPath, 'utf-8');
    } catch {
      // 文件不存在：创建新文档
    }

    const preview = existingContent ? existingContent.slice(0, 2000) : '';
    const existingSection = existingContent
      ? `【现有文档内容（前 2000 字符）】\n\`\`\`\n${preview}\n\`\`\`\n\n`
      : '【现有文档内容】\n（文件不存在，需创建新文档）\n\n';

    const prompt = [
      '你是 FlowForge 文档员可进化智能体。请为以下文档任务设计修改方案.',
      '',
      '【任务信息】',
      `目标路径: ${task.targetPath}`,
      `修改类型: ${task.modificationType}`,
      `任务描述: ${task.description}`,
      `上下文: ${JSON.stringify(task.context)}`,
      '',
      existingSection,
      '【要求】',
      '1. 文档必须以 YAML front-matter 开头（--- 包裹），含 status/type/created_at 字段',
      '2. 标题层级从 # 或 ## 开始，不跳级',
      '3. 内容必须真实，不臆造信息（T2 铁律）',
      '4. 路径用相对路径，不硬编码绝对路径',
      '',
      '【请输出 JSON】',
      '{"steps": [{"action": "write_file"|"update_section"|"append", "path": "目标路径", "content": "文档内容", "section": "章节名（仅 update_section 需要）"}], "expected_effect": "预期效果", "risk_assessment": "low|medium|high"}',
    ].join('\n');

    let content = '';
    let model = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是 FlowForge 文档员可进化智能体（钢笔·文心），擅长编写符合项目规范的文档.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.4 }, // 文档生成需要适度创造性
      );
      content = llmResult.content;
      model = llmResult.model ?? 'unknown';
    } catch (e) {
      // LLM 调用失败：返回最小化方案（避免阻塞循环）
      return makeDevPlan({
        taskId: task.taskId,
        steps: [{ action: 'write_file', path: task.targetPath, content: `<!-- LLM 调用失败，待人工介入: ${e instanceof Error ? e.message : String(e)} -->\n` }],
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
      expectedEffect: typeof parsed?.expected_effect === 'string' ? parsed.expected_effect : '文档修改方案',
      riskAssessment: typeof parsed?.risk_assessment === 'string' ? parsed.risk_assessment : 'medium',
      llmModel: model,
    });
  }

  // §3 Act — 执行文档修改（write_file / update_section / append） ──

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
      const absPath = path.resolve(this.projectRoot, target);
      try {
        if (action === 'write_file') {
          await this.writeFile(absPath, content);
          changedFiles.push(target);
          diffSummaryParts.push(`write ${target} (${content.length} chars)`);
        } else if (action === 'update_section') {
          const section = typeof step.section === 'string' ? step.section : '';
          await this.updateSection(absPath, section, content);
          changedFiles.push(target);
          diffSummaryParts.push(`update section '${section}' in ${target}`);
        } else if (action === 'append') {
          await this.appendFile(absPath, content);
          changedFiles.push(target);
          diffSummaryParts.push(`append ${content.length} chars to ${target}`);
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

  private async writeFile(absPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf-8');
  }

  private async updateSection(absPath: string, section: string, newContent: string): Promise<void> {
    let original: string;
    try {
      original = await fs.readFile(absPath, 'utf-8');
    } catch {
      throw new Error(`文件不存在: ${absPath}`);
    }
    const pattern = new RegExp(`(##\\s+${this.escapeRegExp(section)}.*?)(?=\\n##\\s+|$)`, 's');
    const match = pattern.exec(original);
    let newFull: string;
    if (!match) {
      newFull = `${original.replace(/\s+$/, '')}\n\n## ${section}\n${newContent}\n`;
    } else {
      newFull = original.slice(0, match.index) + `## ${section}\n${newContent}` + original.slice(match.index + match[0].length);
    }
    await fs.writeFile(absPath, newFull, 'utf-8');
  }

  private async appendFile(absPath: string, content: string): Promise<void> {
    try {
      await fs.access(absPath);
      await fs.appendFile(absPath, content, 'utf-8');
    } catch {
      await this.writeFile(absPath, content);
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // §4 Verify — 文件存在 / front-matter / 标题层级 / LLM 审核 ─────

  async verify(result: DevResult): Promise<VerifyResult> {
    const checks: Array<Record<string, unknown>> = [];
    const failureReasons: string[] = [];

    // 检查 1: 文件存在性
    for (const relPath of result.changedFiles) {
      const absPath = path.resolve(this.projectRoot, relPath);
      let exists = false;
      try {
        await fs.access(absPath);
        exists = true;
      } catch {
        // 不存在
      }
      checks.push({ name: `file_exists:${relPath}`, passed: exists, detail: `路径 ${relPath} ${exists ? '存在' : '不存在'}` });
      if (!exists) {
        failureReasons.push(`文件不存在: ${relPath}`);
      }
    }

    // 检查 2 & 3: 格式检查（仅对存在的文件）
    for (const relPath of result.changedFiles) {
      const absPath = path.resolve(this.projectRoot, relPath);
      let content: string;
      try {
        content = await fs.readFile(absPath, 'utf-8');
      } catch {
        continue;
      }

      // front-matter（仅 docs/ 下强制）
      if (relPath.startsWith('docs/')) {
        const hasFm = FRONT_MATTER_RE.test(content);
        checks.push({ name: `front_matter:${relPath}`, passed: hasFm, detail: hasFm ? '有 front-matter' : '缺少 front-matter' });
        if (!hasFm) {
          failureReasons.push(`${relPath} 缺少 front-matter`);
        }
      }

      // 标题层级
      const headings = [...content.matchAll(HEADING_RE)];
      const firstHeading = headings[0];
      const firstLevel = firstHeading && firstHeading[1] ? firstHeading[1].length : 0;
      if (firstLevel > 0) {
        const levelOk = firstLevel <= 2;
        checks.push({ name: `heading_level:${relPath}`, passed: levelOk, detail: `首个标题 #${firstLevel}` });
        if (!levelOk) {
          failureReasons.push(`${relPath} 首个标题层级过深 (#${firstLevel})`);
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
        const reviewResult = await this.llmReviewContent(contentToReview.slice(0, 4000), 'doc');
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
        checks.push({ name: `llm_review:${lastFile}`, passed: false, detail: `调用异常: ${e instanceof Error ? e.message : String(e)}` });
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
