/**
 * config — F052 自主守护进程默认配置验证。
 *
 * 覆盖：常量值 / TODO 模式命中 / makeAutonomousConfig /
 * makeScannerConfig 默认值与覆盖。
 *
 * @module @flowforge/forgekin-autonomous/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONSUMER_INTERVAL_SECONDS,
  DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
  DEFAULT_MAX_CONCURRENT_TASKS,
  DEFAULT_MAX_TASKS_PER_SCAN,
  DEFAULT_SCAN_INTERVAL_SECONDS,
  DOC_CHECKLIST,
  INVALID_OUTPUT_MARKERS,
  MIN_VALID_OUTPUT_LENGTH,
  SCAN_EXCLUDED_DIRS,
  TODO_PATTERNS,
  makeAutonomousConfig,
  makeScannerConfig,
} from '../src/config.js';

describe('常量默认值', () => {
  it('扫描间隔 600s / 并发 3 / 每轮限量 5 / 消费 5s / 保活 10s', () => {
    expect(DEFAULT_SCAN_INTERVAL_SECONDS).toBe(600);
    expect(DEFAULT_MAX_CONCURRENT_TASKS).toBe(3);
    expect(DEFAULT_MAX_TASKS_PER_SCAN).toBe(5);
    expect(DEFAULT_CONSUMER_INTERVAL_SECONDS).toBe(5);
    expect(DEFAULT_KEEPALIVE_INTERVAL_SECONDS).toBe(10);
  });

  it('文档清单与排除目录', () => {
    expect(DOC_CHECKLIST).toContain('docs/spec.md');
    expect(DOC_CHECKLIST).toContain('docs/arch.md');
    expect(SCAN_EXCLUDED_DIRS.has('node_modules')).toBe(true);
    expect(SCAN_EXCLUDED_DIRS.has('.venv')).toBe(true);
    expect(SCAN_EXCLUDED_DIRS.has('__pycache__')).toBe(true);
  });

  it('无效产出标记覆盖 CLI 错误前缀', () => {
    expect(INVALID_OUTPUT_MARKERS).toContain('[CLI 错误]');
    expect(INVALID_OUTPUT_MARKERS).toContain('余额不足');
    expect(MIN_VALID_OUTPUT_LENGTH).toBe(20);
  });
});

describe('TODO_PATTERNS', () => {
  it('命中 TODO / FIXME / NotImplementedError / placeholder', () => {
    expect(TODO_PATTERNS.some((p) => p.test('# TODO: fix'))).toBe(true);
    expect(TODO_PATTERNS.some((p) => p.test('# todo: fix'))).toBe(true);
    expect(TODO_PATTERNS.some((p) => p.test('# FIXME refactor'))).toBe(true);
    expect(TODO_PATTERNS.some((p) => p.test('raise NotImplementedError'))).toBe(true);
    expect(TODO_PATTERNS.some((p) => p.test('pass  # placeholder'))).toBe(true);
  });

  it('不命中普通注释', () => {
    expect(TODO_PATTERNS.some((p) => p.test('# 正常注释'))).toBe(false);
    expect(TODO_PATTERNS.some((p) => p.test('x = 1'))).toBe(false);
  });
});

describe('makeAutonomousConfig', () => {
  it('默认值完整', () => {
    const config = makeAutonomousConfig();
    expect(config.scan_interval_seconds).toBe(600);
    expect(config.max_concurrent_tasks).toBe(3);
    expect(config.max_tasks_per_scan).toBe(5);
  });

  it('部分覆盖生效', () => {
    const config = makeAutonomousConfig({ scan_interval_seconds: 1, max_concurrent_tasks: 1 });
    expect(config.scan_interval_seconds).toBe(1);
    expect(config.max_concurrent_tasks).toBe(1);
    expect(config.max_tasks_per_scan).toBe(5);
  });
});

describe('makeScannerConfig', () => {
  it('默认值对齐 Python（flowforge 源目录 + 三核心模块）', () => {
    const config = makeScannerConfig();
    expect(config.sourceDirName).toBe('flowforge');
    expect(config.sourceExtensions).toEqual(['.py']);
    expect(config.coreModules.length).toBe(3);
    expect(config.testsDirName).toBe('tests');
    expect(config.testFilePrefix).toBe('test_');
    expect(config.testFileExtension).toBe('.py');
    expect(config.importPrefix).toBe('flowforge');
  });

  it('部分覆盖生效', () => {
    const config = makeScannerConfig({ sourceDirName: 'src', coreModules: ['a.py'] });
    expect(config.sourceDirName).toBe('src');
    expect(config.coreModules).toEqual(['a.py']);
    expect(config.testFilePrefix).toBe('test_');
  });
});
