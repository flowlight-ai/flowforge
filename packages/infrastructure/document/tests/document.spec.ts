/**
 * document 插件包测试 — C33（F088 Phase J2）。
 *
 * 覆盖：.md 始终生成（真实 FS）；pandoc 不可用 → 降级 .md（_setAvailable）；
 * 文件名净化 + nonce 防碰撞；Cordis 插件挂载 ctx.forgeDocument。
 * 注：pdf/docx 真实转换仅在 pandoc 可用时验证（with-key 类比，无 pandoc 自跳过）。
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeDocumentService, { PandocService } from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
const generatedFiles: string[] = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (generatedFiles.length > 0) {
    const f = generatedFiles.pop();
    if (f) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* tmp file already gone */
      }
    }
  }
});

describe('PandocService', () => {
  it('.md 格式始终生成（无需 pandoc）', async () => {
    const svc = new PandocService(console);
    const result = await svc.generate('# 标题\n\n正文内容', '测试报告', 'md');
    expect(result).not.toBeNull();
    expect(result!.format).toBe('md');
    expect(result!.mimeType).toBe('text/markdown');
    expect(result!.fileName).toBe('测试报告.md');
    expect(existsSync(result!.absPath)).toBe(true);
    expect(readFileSync(result!.absPath, 'utf-8')).toContain('标题');
    generatedFiles.push(result!.absPath);
  });

  it('pandoc 不可用 → pdf 请求降级为 .md', async () => {
    const svc = new PandocService(console);
    svc._setAvailable(false);
    const result = await svc.generate('# 内容', '报告', 'pdf');
    expect(result).not.toBeNull();
    expect(result!.format).toBe('md');
    expect(result!.fileName).toBe('报告.md');
    generatedFiles.push(result!.absPath);
  });

  it('文件名净化：特殊字符替换为 _', async () => {
    const svc = new PandocService(console);
    const result = await svc.generate('# x', '报告/..\\"', 'md');
    expect(result).not.toBeNull();
    expect(result!.fileName).not.toContain('/');
    expect(result!.fileName).not.toContain('\\');
    expect(result!.fileName).not.toContain('"');
    generatedFiles.push(result!.absPath);
  });

  it('nonce 防碰撞：同名并发生成路径不同', async () => {
    const svc = new PandocService(console);
    const [a, b] = await Promise.all([
      svc.generate('# a', '同名', 'md'),
      svc.generate('# b', '同名', 'md'),
    ]);
    expect(a!.absPath).not.toBe(b!.absPath);
    generatedFiles.push(a!.absPath, b!.absPath);
  });
});

describe('ForgeDocumentService（Cordis 插件）', () => {
  it('挂载 ctx.forgeDocument + generate .md', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDocumentService, {})) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);

    const svc = ctx.forgeDocument;
    expect(svc).toBeDefined();
    const result = await svc.generate('# Hello', 'doc', 'md');
    expect(result!.format).toBe('md');
    generatedFiles.push(result!.absPath);
  });
});
