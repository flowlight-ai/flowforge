/**
 * @flowforge/infrastructure-document — C33 document 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/document/PandocService.ts`（F088 Phase J2）：
 *   - Markdown → PDF/DOCX 经 pandoc CLI 转换
 *   - 优雅降级：pandoc 未安装时回落为 .md
 *   - PDF 失败（无 LaTeX）→ 尝试 DOCX → 最终 .md
 *   - randomBytes nonce 防并发碰撞（P1-2）
 *
 * 插件化改造：
 *   - clowder FastifyBaseLogger → 注入式 DocumentLogger 接口（缺省 console）
 *   - 临时文件写入 tmpdir（T9：运行时数据不污染代码目录）
 *
 * @module @flowforge/infrastructure-document
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Context, Service } from '@flowforge/cordis';

const execFileAsync = promisify(execFile);

export type DocumentFormat = 'pdf' | 'docx' | 'md';

export interface GeneratedDocument {
  /** Absolute path to the generated file */
  absPath: string;
  /** Display name for the file (e.g. "调研报告.pdf") */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** Actual format generated (may differ from requested if pandoc unavailable) */
  format: DocumentFormat;
}

const MIME_TYPES: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
};

/** Timeout for pandoc conversion (30 seconds) */
const PANDOC_TIMEOUT_MS = 30_000;

export interface DocumentLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

/**
 * Pandoc 文档生成服务 — Markdown → PDF/DOCX（pandoc CLI）。
 * pandoc 不可用时降级为 .md；PDF 失败回退 DOCX 再回退 .md。
 */
export class PandocService {
  private pandocAvailable: boolean | null = null;
  private readonly log: DocumentLogger;

  constructor(log: DocumentLogger) {
    this.log = log;
  }

  /** 检测系统 pandoc 可用性（首次后缓存）。 */
  async isPandocAvailable(): Promise<boolean> {
    if (this.pandocAvailable !== null) return this.pandocAvailable;
    try {
      const { stdout } = await execFileAsync('pandoc', ['--version'], { timeout: 5_000 });
      const version = stdout.split('\n')[0] ?? 'unknown';
      this.log.info(`[PandocService] pandoc detected: ${version}`);
      this.pandocAvailable = true;
    } catch {
      this.log.warn('[PandocService] pandoc not found — document generation will fall back to .md');
      this.pandocAvailable = false;
    }
    return this.pandocAvailable;
  }

  /**
   * 从 Markdown 内容生成文档。
   * pandoc 不可用或转换失败时自动降级为 .md。
   */
  async generate(markdown: string, baseName: string, format: DocumentFormat): Promise<GeneratedDocument | null> {
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    const nonce = randomBytes(6).toString('hex');

    if (format === 'md') {
      return this.saveMd(markdown, safeBaseName, nonce);
    }

    const hasPandoc = await this.isPandocAvailable();
    if (!hasPandoc) {
      this.log.warn(`[PandocService] pandoc unavailable, degrading to .md (requested: ${format})`);
      return this.saveMd(markdown, safeBaseName, nonce);
    }

    return this.convertWithPandoc(markdown, safeBaseName, nonce, format);
  }

  private async saveMd(markdown: string, baseName: string, nonce: string): Promise<GeneratedDocument> {
    const fileName = `${baseName}.md`;
    const absPath = join(tmpdir(), `ff-doc-${baseName}-${nonce}.md`);
    await writeFile(absPath, markdown, 'utf-8');
    this.log.info(`[PandocService] saved .md file: ${absPath}`);
    return { absPath, fileName, mimeType: MIME_TYPES.md, format: 'md' };
  }

  private async convertWithPandoc(
    markdown: string,
    baseName: string,
    nonce: string,
    format: 'pdf' | 'docx',
  ): Promise<GeneratedDocument | null> {
    const inputPath = join(tmpdir(), `ff-doc-${baseName}-${nonce}.md`);
    const outputPath = join(tmpdir(), `ff-doc-${baseName}-${nonce}.${format}`);
    const fileName = `${baseName}.${format}`;

    try {
      await writeFile(inputPath, markdown, 'utf-8');
      const args = [inputPath, '-o', outputPath, '--standalone'];
      if (format === 'pdf') {
        args.push('--pdf-engine=tectonic');
      }
      await execFileAsync('pandoc', args, { timeout: PANDOC_TIMEOUT_MS });
      this.log.info(`[PandocService] conversion success: ${outputPath}`);
      return { absPath: outputPath, fileName, mimeType: MIME_TYPES[format], format };
    } catch (err) {
      this.log.warn(`[PandocService] pandoc conversion failed (${format}): ${(err as Error).message}`);
      // PDF 失败 → 尝试 DOCX
      if (format === 'pdf') {
        this.log.info('[PandocService] PDF failed, attempting DOCX fallback');
        const docxResult = await this.convertWithPandoc(markdown, baseName, nonce, 'docx');
        if (docxResult) return docxResult;
      }
      // 最终回退 .md
      this.log.warn('[PandocService] all conversions failed, saving as .md');
      return this.saveMd(markdown, baseName, nonce);
    } finally {
      await unlink(inputPath).catch(() => {});
    }
  }

  /** 重置缓存可用性（测试用）。 */
  _resetCache(): void {
    this.pandocAvailable = null;
  }

  /** 覆盖可用性（测试用）。 */
  _setAvailable(available: boolean): void {
    this.pandocAvailable = available;
  }
}

export interface DocumentConfig {
  /** logger（缺省 console）。 */
  log?: DocumentLogger;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** document 域（C33）：Markdown → PDF/DOCX 文档生成 */
    forgeDocument: ForgeDocumentService;
  }
}

/**
 * document 域服务 — 挂载 `ctx.forgeDocument`。
 * 包装 PandocService，暴露 generate / isPandocAvailable。
 */
export class ForgeDocumentService extends Service {
  private readonly pandoc: PandocService;

  constructor(ctx: Context, config: DocumentConfig = {}) {
    super(ctx, 'forgeDocument');
    this.pandoc = new PandocService(config.log ?? console);
  }

  isPandocAvailable(): Promise<boolean> {
    return this.pandoc.isPandocAvailable();
  }

  generate(markdown: string, baseName: string, format: DocumentFormat): Promise<GeneratedDocument | null> {
    return this.pandoc.generate(markdown, baseName, format);
  }
}

export default ForgeDocumentService;
