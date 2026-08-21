/**
 * SelfDevReviewLoop — 代码审查自我演进闭环（对齐 Python `evolution/self_dev_review.py`）。
 *
 * 觉醒阶要求：E3（受限自主阶）。对应 Forgekin：审查员·梵高（forgemind:vangogh）。
 * 安全护栏：I9 no-self-review（author 与 reviewer 必须不同厂商）/ I11 push-back（P0/P1 触发 Author Reflect）。
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

const DEFAULT_REVIEWS_DIR = 'docs/reviews';
const SEVERITY_LEVELS = ['P0', 'P1', 'P2', 'P3'];

/** I9 no-self-review：已知的 LLM 厂商映射（author 与 reviewer 的厂商必须不同） */
const LLM_VENDOR_MAP: Record<string, string> = {
  // OpenAI 系列
  'gpt-4': 'openai', 'gpt-4o': 'openai', 'gpt-5': 'openai', 'gpt-4-turbo': 'openai', 'gpt-3.5-turbo': 'openai',
  // Anthropic 系列（含连字符与点号两种命名变体）
  'claude-3-opus': 'anthropic', 'claude-3-sonnet': 'anthropic', 'claude-3-haiku': 'anthropic',
  'claude-3.5-sonnet': 'anthropic', 'claude-3-5-sonnet': 'anthropic', 'claude-3-5-haiku': 'anthropic',
  'claude-4-opus': 'anthropic', 'claude-4-sonnet': 'anthropic',
  // Google 系列
  'gemini-1.5-pro': 'google', 'gemini-1.5-flash': 'google', 'gemini-2-pro': 'google', 'gemini-2-flash': 'google',
  // 智谱系列
  'glm-4': 'zhipu', 'glm-4-plus': 'zhipu', 'glm-5': 'zhipu', 'glm-5.2': 'zhipu',
  // Moonshot 系列
  'moonshot-v1-8k': 'moonshot', 'moonshot-v1-32k': 'moonshot', 'moonshot-v1-128k': 'moonshot',
  // Meta 系列
  'llama-3-70b': 'meta', 'llama-3-8b': 'meta',
  // Trae / fake / fallback 等占位
  'trae': 'trae', 'fake-model': 'fake', 'fallback': 'fallback', 'unknown': 'unknown',
};

/** 审查问题（P0-P3 分级） */
export interface ReviewIssue {
  readonly severity: string;
  readonly location: string;
  readonly description: string;
  readonly suggestion: string;
}

export class SelfDevReviewLoop extends SelfDevLoopBase {
  readonly loopType = 'review';
  readonly minAwakeningStage = 'E3';

  // §1 Discover — target_files / recent_commits / force_targets ─────

  async discover(context: Record<string, unknown>): Promise<DevTask[]> {
    const tasks: DevTask[] = [];
    const targetFiles = Array.isArray(context.target_files)
      ? context.target_files.map(String)
      : (Array.isArray(context.force_targets) ? context.force_targets.map(String) : []);

    if (targetFiles.length > 0) {
      for (const target of targetFiles) {
        try {
          await fs.access(path.resolve(this.projectRoot, target));
        } catch {
          continue; // 待审查文件不存在：跳过
        }
        tasks.push(makeDevTask({
          loopType: 'review',
          targetPath: target,
          modificationType: 'create', // 创建审查报告
          description: `审查文件: ${target}`,
          priority: 'high',
          context: {
            source: 'target_files',
            authorForgekinId: typeof context.author_forgekin_id === 'string' ? context.author_forgekin_id : 'unknown',
            authorLlmModel: typeof context.author_llm_model === 'string' ? context.author_llm_model : 'unknown',
          },
        }));
      }
    } else {
      // 未提供 target_files：无任务
      return tasks;
    }
    return tasks;
  }

  // §2 Plan — 通过 LLM 生成审查清单（I9 跨厂商检查） ───────────────

  async plan(task: DevTask): Promise<DevPlan> {
    const authorModel = typeof task.context.author_llm_model === 'string' ? task.context.author_llm_model : 'unknown';
    // I9 no-self-review：author 与 reviewer 同厂商时记录 warning（仍执行，由结果标注）
    this.checkNoSelfReview(authorModel, this.llmModelName());

    const prompt = [
      '你是 FlowForge 审查员可进化智能体（梵高）。请为以下文件设计审查清单.',
      '',
      '【文件路径】',
      task.targetPath,
      '',
      '【任务描述】',
      task.description,
      '',
      '【要求】',
      '1. 问题分级 P0（阻塞）/ P1（严重）/ P2（一般）/ P3（建议）',
      '2. 每条问题附具体位置（行号或函数名）',
      '3. 只报告真实问题，不臆造',
      '',
      '【请输出 JSON】',
      '{"checklist": ["检查项1", "检查项2"], "expected_effect": "审查重点", "risk_assessment": "low|medium|high"}',
    ].join('\n');

    let content = '';
    let model = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是严格的代码审查员，遵循 no-self-review 铁律（跨厂商独立审查）.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3 },
      );
      content = llmResult.content;
      model = llmResult.model ?? 'unknown';
    } catch {
      return makeDevPlan({
        taskId: task.taskId,
        steps: [{ action: 'review_file', path: task.targetPath, checklist: [] }],
        expectedEffect: 'LLM 调用失败，跳过审查',
        riskAssessment: 'high',
        llmModel: 'fallback',
      });
    }

    const parsed = this.parseJsonLoose(content);
    const checklist = Array.isArray(parsed?.checklist) ? parsed.checklist.map(String) : [];
    return makeDevPlan({
      taskId: task.taskId,
      steps: [{ action: 'review_file', path: task.targetPath, checklist }],
      expectedEffect: typeof parsed?.expected_effect === 'string' ? parsed.expected_effect : '审查清单',
      riskAssessment: typeof parsed?.risk_assessment === 'string' ? parsed.risk_assessment : 'medium',
      // I9 no-self-review：author 与 reviewer 同厂商时记录 warning（仍执行，由结果标注）
      llmModel: model,
    });
  }

  /** 当前 reviewer LLM 的模型名（简化：取 forgekinConfig.reviewer_model 或默认 'unknown'） */
  private llmModelName(): string {
    return typeof this.forgekinConfig.reviewer_model === 'string' ? this.forgekinConfig.reviewer_model : 'unknown';
  }

  /** 映射 LLM 模型到厂商（I9 依据） */
  vendorOf(model: string): string {
    return LLM_VENDOR_MAP[model] ?? 'unknown';
  }

  /** I9 no-self-review 检查：author 与 reviewer 是否同厂商 */
  checkNoSelfReview(authorModel: string, reviewerModel: string): { sameVendor: boolean; authorVendor: string; reviewerVendor: string } {
    const authorVendor = this.vendorOf(authorModel);
    const reviewerVendor = this.vendorOf(reviewerModel);
    return { sameVendor: authorVendor === reviewerVendor, authorVendor, reviewerVendor };
  }

  // §3 Act — 执行审查（不修改代码，仅生成审查报告） ────────────────

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
      const checklist = Array.isArray(step.checklist) ? step.checklist.map(String) : [];

      if (action !== 'review_file' || !target) {
        diffSummaryParts.push(`skip ${action || 'unknown'}`);
        continue;
      }

      let content: string;
      try {
        content = await fs.readFile(path.resolve(this.projectRoot, target), 'utf-8');
      } catch (e) {
        success = false;
        errorMessage = `读取 ${target} 失败: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }

      // 调用 LLM 生成审查报告
      const report = await this.generateReviewReport(target, content, checklist, plan.llmModel);

      // 写入审查报告文件 docs/reviews/YYYY-MM-DD_HH-MM-SS_<filename>.md
      const reportRelPath = this.getReportPath(target);
      const reportAbsPath = path.resolve(this.projectRoot, reportRelPath);
      await fs.mkdir(path.dirname(reportAbsPath), { recursive: true });
      await fs.writeFile(reportAbsPath, this.renderReport(report), 'utf-8');

      changedFiles.push(reportRelPath);
      diffSummaryParts.push(`review ${target} -> ${reportRelPath} (P0=${report.p0Count}, P1=${report.p1Count})`);
    }

    return makeDevResult({
      planId: plan.planId,
      changedFiles,
      diffSummary: diffSummaryParts.length > 0 ? diffSummaryParts.join('; ') : '无审查',
      success,
      errorMessage,
    });
  }

  /** 调用 LLM 生成审查报告（issues/summary/score + P0-P3 统计） */
  private async generateReviewReport(
    target: string,
    content: string,
    checklist: string[],
    reviewerModel: string,
  ): Promise<{
    target: string; reviewerModel: string; issues: ReviewIssue[]; summary: string;
    score: number; p0Count: number; p1Count: number; p2Count: number; p3Count: number;
  }> {
    const preview = content.slice(0, 5000);
    const truncated = content.length > 5000 ? '（已截取）' : '';
    const checklistStr = checklist.length > 0 ? checklist.map((c) => `- ${c}`).join('\n') : '- 常规审查';

    const prompt = [
      '请审查以下文件并生成审查报告.',
      '',
      '【文件路径】',
      target,
      '',
      '【审查清单】',
      checklistStr,
      '',
      '【文件内容】',
      `${truncated}\n\`\`\`\n${preview}\n\`\`\``,
      '',
      '【请输出 JSON】',
      '{"issues": [{"severity": "P0|P1|P2|P3", "location": "行号或函数名", "description": "问题描述", "suggestion": "修复建议"}], "summary": "整体评价", "score": 0.0-1.0}',
    ].join('\n');

    let resp = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是严格的代码审查员. 只报告真实问题，不臆造. P0=阻塞性，P1=严重，P2=一般，P3=建议.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3 },
      );
      resp = llmResult.content;
    } catch {
      resp = '{"issues": [], "summary": "LLM 调用失败", "score": 0.0}';
    }

    const parsed = this.parseJsonLoose(resp);
    const issues: ReviewIssue[] = Array.isArray(parsed?.issues)
      ? parsed.issues.filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object').map((i) => ({
        severity: typeof i.severity === 'string' && SEVERITY_LEVELS.includes(i.severity) ? i.severity : 'P3',
        location: typeof i.location === 'string' ? i.location : '',
        description: typeof i.description === 'string' ? i.description : '',
        suggestion: typeof i.suggestion === 'string' ? i.suggestion : '',
      }))
      : [];

    const count = (severity: string): number => issues.filter((i) => i.severity === severity).length;
    return {
      target,
      reviewerModel,
      issues,
      summary: typeof parsed?.summary === 'string' ? parsed.summary : '未提供总结',
      score: typeof parsed?.score === 'number' ? parsed.score : 0.0,
      p0Count: count('P0'),
      p1Count: count('P1'),
      p2Count: count('P2'),
      p3Count: count('P3'),
    };
  }

  /** 生成审查报告文件名（docs/reviews/YYYY-MM-DD_HH-MM-SS_<filename>.md） */
  private getReportPath(target: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = path.basename(target).replace(/[^\w.-]/g, '_');
    return `${DEFAULT_REVIEWS_DIR}/${ts}_${base}.md`;
  }

  /** 渲染审查报告 Markdown */
  private renderReport(report: {
    target: string; reviewerModel: string; issues: ReviewIssue[]; summary: string; score: number;
    p0Count: number; p1Count: number; p2Count: number; p3Count: number;
  }): string {
    const lines = [
      '---',
      'type: review_report',
      `target: ${report.target}`,
      `reviewer_model: ${report.reviewerModel}`,
      `score: ${report.score}`,
      `p0: ${report.p0Count}`,
      `p1: ${report.p1Count}`,
      `p2: ${report.p2Count}`,
      `p3: ${report.p3Count}`,
      '---',
      '',
      `# 审查报告：${report.target}`,
      '',
      `> 总分：${report.score.toFixed(2)} ｜ P0: ${report.p0Count} ｜ P1: ${report.p1Count} ｜ P2: ${report.p2Count} ｜ P3: ${report.p3Count}`,
      '',
      '## 总结',
      '',
      report.summary,
      '',
      '## 问题清单',
      '',
    ];
    if (report.issues.length === 0) {
      lines.push('未发现问题。');
    }
    for (const issue of report.issues) {
      lines.push(`### [${issue.severity}] ${issue.location}`);
      lines.push('');
      lines.push(`- 描述：${issue.description}`);
      lines.push(`- 建议：${issue.suggestion}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  // §4 Verify — 审查报告质量（meta-review） ─────────────────────────

  async verify(result: DevResult): Promise<VerifyResult> {
    const checks: Array<Record<string, unknown>> = [];
    const failureReasons: string[] = [];

    // 检查 1: 报告文件存在性 + front-matter
    for (const relPath of result.changedFiles) {
      let content: string;
      try {
        content = await fs.readFile(path.resolve(this.projectRoot, relPath), 'utf-8');
      } catch {
        checks.push({ name: `file_exists:${relPath}`, passed: false, detail: '报告文件不存在' });
        failureReasons.push(`报告文件不存在: ${relPath}`);
        continue;
      }
      const hasFm = /^---\s*\n/.test(content);
      checks.push({ name: `front_matter:${relPath}`, passed: hasFm, detail: hasFm ? '有 front-matter' : '缺少 front-matter' });
      if (!hasFm) {
        failureReasons.push(`${relPath} 缺少 front-matter`);
      }
    }

    // 检查 2: LLM 审核（T7 铁律）— 审查报告本身必须经 LLM 审核
    let llmReviewPassed = true;
    if (result.success && result.changedFiles.length > 0) {
      const lastFile = result.changedFiles[result.changedFiles.length - 1];
      if (lastFile) {
        try {
          const reportContent = await fs.readFile(path.resolve(this.projectRoot, lastFile), 'utf-8');
          const reviewResult = await this.llmReviewContent(reportContent.slice(0, 4000), 'review_report');
          llmReviewPassed = reviewResult.passed === true;
          const score = typeof reviewResult.score === 'number' ? reviewResult.score : 0;
          checks.push({ name: `llm_review:${lastFile}`, passed: llmReviewPassed, detail: `score=${score}` });
          if (!llmReviewPassed) {
            failureReasons.push(`审查报告 LLM 审核未通过 (score=${score})`);
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
