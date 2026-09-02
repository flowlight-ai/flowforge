/**
 * file-reference 包测试 — D39（@file token 语法 + 抽象服务）。
 *
 * 覆盖：activeAtToken（@path / @"quoted" / 邮箱不触发）；formatFileMention
 * （目录尾斜杠/引号保留/控制字符拒绝）；FILE_REFERENCE_PROMPT 引导文案。
 */

import { describe, expect, it } from 'vitest';

import { activeAtToken, FILE_REFERENCE_PROMPT, formatFileMention } from '../src/index.ts';

describe('activeAtToken', () => {
  it('普通 @path token', () => {
    expect(activeAtToken('open @src/', 10)).toEqual({ prefix: '@src/', query: 'src/', quoted: false });
    expect(activeAtToken('请查看 @README.md', 15)).toEqual({ prefix: '@README.md', query: 'README.md', quoted: false });
  });

  it('@"quoted path" 引号语法', () => {
    expect(activeAtToken('open @"my dir/', 14)).toEqual({ prefix: '@"my dir/', query: 'my dir/', quoted: true });
  });

  it('其他 token 内的 @ 不触发（邮箱）', () => {
    expect(activeAtToken('contact me@example.com', 15)).toBeUndefined();
  });
});

describe('formatFileMention', () => {
  it('文件/目录不同形态；目录尾斜杠', () => {
    expect(formatFileMention({ path: 'src/index.ts', kind: 'file' }, false)).toBe('@src/index.ts');
    expect(formatFileMention({ path: 'src', kind: 'directory' }, false)).toBe('@src/');
  });

  it('空白路径用引号；目录保持引号打开；控制字符拒绝', () => {
    expect(formatFileMention({ path: 'my dir/file.ts', kind: 'file' }, false)).toBe('@"my dir/file.ts"');
    expect(formatFileMention({ path: 'my dir', kind: 'directory' }, false)).toBe('@"my dir/');
    expect(formatFileMention({ path: 'a\u0000b', kind: 'file' }, false)).toBeUndefined();
  });

  it('preserveQuote 强制引号', () => {
    expect(formatFileMention({ path: 'plain.ts', kind: 'file' }, true)).toBe('@"plain.ts"');
  });

  it('引导文案描述 @ 引用语义', () => {
    expect(FILE_REFERENCE_PROMPT).toContain('workspace paths');
    expect(FILE_REFERENCE_PROMPT).toContain('read tool');
  });
});
