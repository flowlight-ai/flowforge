/**
 * rich-block-plaintext 契约测试。
 * 覆盖 card / checklist / diff / audio / media_gallery 纯文本渲染。
 */

import { describe, expect, it } from 'vitest';

import type { RichBlock } from '@flowforge/cats-shared';
import { renderAllRichBlocksPlaintext, renderRichBlockPlaintext } from '../src/index.ts';

const base = { v: 1 as const, id: 'b1' };

describe('renderRichBlockPlaintext', () => {
  it('card 渲染标题 + 正文 + 字段', () => {
    const block: RichBlock = {
      ...base,
      kind: 'card',
      title: '风险提示',
      bodyMarkdown: 'Token 即将过期',
      fields: [{ label: '种类', value: '安全' }],
    };
    expect(renderRichBlockPlaintext(block)).toContain('📋 风险提示');
    expect(renderRichBlockPlaintext(block)).toContain('Token 即将过期');
    expect(renderRichBlockPlaintext(block)).toContain('种类: 安全');
  });

  it('checklist 渲染勾选状态', () => {
    const block: RichBlock = {
      ...base,
      kind: 'checklist',
      title: 'Regression',
      items: [
        { text: '通过', checked: true },
        { text: '待办', checked: false },
      ],
    };
    const out = renderRichBlockPlaintext(block);
    expect(out).toContain('✅ 通过');
    expect(out).toContain('☐ 待办');
  });

  it('diff / audio 渲染', () => {
    const diff: RichBlock = { ...base, kind: 'diff', filePath: 'src/a.ts', diff: '-x\n+y' };
    expect(renderRichBlockPlaintext(diff)).toContain('📝 src/a.ts');

    const audio: RichBlock = { ...base, kind: 'audio', text: '语音说明', url: 'https://cdn/a.mp3' };
    expect(renderRichBlockPlaintext(audio)).toBe('🔊 语音说明');
  });

  it('media_gallery 渲染标题与条目描述', () => {
    const gallery: RichBlock = {
      ...base,
      kind: 'media_gallery',
      title: '截图',
      items: [{ url: '/uploads/1.png', caption: '主界面' }],
    };
    const out = renderRichBlockPlaintext(gallery);
    expect(out).toContain('🖼️ 截图');
    expect(out).toContain('主界面');
  });

  it('renderAllRichBlocksPlaintext 用空行连接多块', () => {
    const blocks: RichBlock[] = [
      { ...base, kind: 'card' as const, title: 'A', bodyMarkdown: undefined },
      { ...base, id: 'b2', kind: 'checklist' as const, title: 'Todo', items: [] },
    ];
    expect(renderAllRichBlocksPlaintext(blocks)).toBe('📋 A\n\n☑️ Todo');
  });
});