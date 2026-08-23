/**
 * scanner — 项目扫描三类任务发现验证（真实临时文件系统）。
 *
 * 覆盖：文档缺失 / TODO 扫描（排除目录+去重+限量）/
 * 测试缺失三级查找 / scanProject 汇总。
 *
 * @module @flowforge/forgekin-autonomous/tests
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeScannerConfig } from '../src/config.js';
import {
  scanCodeTodos,
  scanMissingDocs,
  scanMissingTests,
  scanProject,
} from '../src/scanner.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'autonomous-scan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 扫描配置：源目录 src / 测试目录 src/tests */
const config = () =>
  makeScannerConfig({
    sourceDirName: 'src',
    coreModules: ['mod_alpha.py', 'mod_beta.py'],
    docChecklist: ['docs/spec.md'],
  });

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

describe('scanMissingDocs', () => {
  it('缺失文档产生 doc_generation 任务', () => {
    const tasks = scanMissingDocs(root, config());
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.title).toBe('补充缺失文档: docs/spec.md');
    expect(tasks[0]?.requiredCapabilities).toEqual(['doc_generation']);
    expect(tasks[0]?.context['doc_path']).toBe('docs/spec.md');
  });

  it('文档存在时不产生任务', () => {
    write('docs/spec.md', '# Spec');
    expect(scanMissingDocs(root, config())).toEqual([]);
  });
});

describe('scanCodeTodos', () => {
  it('TODO 文件产生 code_generation 任务并携带命中数', () => {
    write('src/a.py', '# TODO: implement this\nx = 1\n# TODO: another\n');
    write('src/clean.py', 'x = 1\n');
    const tasks = scanCodeTodos(root, config());
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.title).toContain('a.py');
    expect(tasks[0]?.requiredCapabilities).toEqual(['code_generation']);
    expect(tasks[0]?.context['count']).toBe(2);
  });

  it('排除目录与 tests 目录不参与扫描', () => {
    write('src/node_modules/lib.py', '# TODO: skipped\n');
    write('src/tests/test_a.py', '# TODO: skipped tests\n');
    expect(scanCodeTodos(root, config())).toEqual([]);
  });

  it('同文件多个模式只提交一个任务（命中首个即停）', () => {
    write('src/b.py', '# TODO: one\n# FIXME: two\n');
    const tasks = scanCodeTodos(root, config());
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.context['count']).toBe(1);
  });

  it('isInProgress 谓词过滤进行中任务', () => {
    write('src/a.py', '# TODO: implement\n');
    const tasks = scanCodeTodos(root, config(), (title) => title.includes('a.py'));
    expect(tasks).toEqual([]);
  });

  it('源目录不存在时返回空', () => {
    expect(scanCodeTodos(root, makeScannerConfig({ sourceDirName: 'no_such_dir' }))).toEqual([]);
  });
});

describe('scanMissingTests', () => {
  it('无任何测试 → test_generation 任务（两模块各一）', () => {
    write('src/mod_alpha.py', 'def f(): pass\n');
    write('src/mod_beta.py', 'def g(): pass\n');
    const tasks = scanMissingTests(root, config());
    expect(tasks.map((t) => t.title)).toEqual(['补充测试: mod_alpha.py', '补充测试: mod_beta.py']);
    expect(tasks[0]?.requiredCapabilities).toEqual(['test_generation']);
    expect(tasks[0]?.priority).toBe('low');
    expect(tasks[0]?.context['module']).toBe('mod_alpha.py');
  });

  it('精确命名匹配 → 不产生任务', () => {
    write('src/mod_alpha.py', 'def f(): pass\n');
    write('src/tests/test_mod_alpha.py', 'import flowforge\n');
    const tasks = scanMissingTests(root, config());
    expect(tasks).toEqual([]);
  });

  it('模糊命名匹配（子目录 + 名称包含）→ 不产生任务', () => {
    write('src/mod_alpha.py', 'def f(): pass\n');
    write('src/tests/unit/test_core_mod_alpha_v2.py', 'x = 1\n');
    expect(scanMissingTests(root, config())).toEqual([]);
  });

  it('内容 import 匹配 → 不产生任务', () => {
    write('src/mod_alpha.py', 'def f(): pass\n');
    write('src/tests/test_other.py', 'from flowforge.mod_alpha import f\n');
    expect(scanMissingTests(root, config())).toEqual([]);
  });

  it('模块文件不存在时跳过', () => {
    // mod_alpha.py / mod_beta.py 均未创建
    expect(scanMissingTests(root, config())).toEqual([]);
  });

  it('isInProgress 谓词过滤', () => {
    write('src/mod_alpha.py', 'def f(): pass\n');
    const tasks = scanMissingTests(root, config(), (title) => title.includes('mod_alpha'));
    expect(tasks).toEqual([]);
  });
});

describe('scanProject 汇总', () => {
  it('三类任务合并返回', () => {
    write('src/mod_alpha.py', '# TODO: implement\n');
    write('src/mod_beta.py', 'def g(): pass\n');
    const tasks = scanProject(root, config());
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('补充缺失文档: docs/spec.md');
    expect(titles.some((t) => t.includes('修复代码 TODO'))).toBe(true);
    expect(titles).toContain('补充测试: mod_alpha.py');
    expect(titles).toContain('补充测试: mod_beta.py');
  });
});
