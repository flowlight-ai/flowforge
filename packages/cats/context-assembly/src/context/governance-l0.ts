/**
 * Governance L0 compilation (self-contained port of clowder `governance-l0.ts`).
 *
 * Deterministically projects `shared-rules.md` into the compact always-on
 * governance L0 block. This is intentionally not a summarizer: required
 * headings/table anchors must exist, and missing anchors fail closed.
 *
 * File reads go through the injected `FileSystemSeam` (EP2 wires the host's real
 * filesystem; tests inject the in-memory implementation). `compileGovernanceL0FromMarkdown`
 * is pure and dependency-free.
 */

import type { FileSystemSeam } from '../ports/file-system.ts';

export type GovernanceL0Source = 'base' | 'local' | 'override';

export interface CompiledGovernanceL0 {
  content: string;
  sourcePath: string;
  source: GovernanceL0Source;
  overlayPath: string | null;
  generatedFrom: 'cat-cafe-skills/refs/shared-rules.md';
}

export const SHARED_RULES_RELPATH = 'cat-cafe-skills/refs/shared-rules.md';

function localPaths(basePath: string): { override: string; local: string } {
  const separator = basePath.lastIndexOf('.');
  const stem = separator > 0 ? basePath.slice(0, separator) : basePath;
  const ext = separator > 0 ? basePath.slice(separator) : '';
  return {
    override: `${stem}.local-override${ext}`,
    local: `${stem}.local${ext}`,
  };
}

function normalizeInline(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function assertPresent(markdown: string, needle: string): void {
  if (!markdown.includes(needle)) {
    throw new Error(`compileGovernanceL0: missing required shared-rules anchor "${needle}"`);
  }
}

function extractProtocolLabel(markdown: string, coreAnchor: string): string {
  const matches = [...markdown.matchAll(/^###\s+(.+)$/gm)]
    .map((match) => normalizeInline(match[1] ?? ''))
    .filter((heading) => heading.includes(coreAnchor));
  if (matches.length === 0) {
    throw new Error(`compileGovernanceL0: missing required shared-rules anchor "${coreAnchor}"`);
  }
  if (matches.length > 1) {
    throw new Error(`compileGovernanceL0: duplicate required shared-rules anchor "${coreAnchor}"`);
  }
  return (
    matches[0]
      ?.replace(/\s*（[^）]*）\s*$/, '')
      .replace(/协议$/, '')
      .trim() ?? ''
  );
}

function extractFirstParagraphAfterHeading(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) {
    throw new Error(`compileGovernanceL0: missing required shared-rules heading "${heading}"`);
  }
  const bodyStart = start + heading.length;
  const nextHeading = markdown.slice(bodyStart).search(/\n##\s+/);
  const body = nextHeading >= 0 ? markdown.slice(bodyStart, bodyStart + nextHeading) : markdown.slice(bodyStart);
  const paragraph = body
    .trim()
    .split(/\n\s*\n/)
    .map((part) => normalizeInline(part))
    .find((part) => part.length > 0);
  if (!paragraph) {
    throw new Error(`compileGovernanceL0: empty required shared-rules heading "${heading}"`);
  }
  return paragraph;
}

function extractNumberedHeadings(markdown: string, prefix: 'P' | 'W', expected: number): string[] {
  const re = new RegExp(`^###\\s+(${prefix}[1-${expected}])\\.\\s+(.+)$`, 'gm');
  const byKey = new Map<string, string[]>();
  for (const match of markdown.matchAll(re)) {
    const key = match[1] ?? '';
    const text = normalizeInline(match[2] ?? '');
    const values = byKey.get(key) ?? [];
    values.push(`- **${key}** ${text}`);
    byKey.set(key, values);
  }
  const ordered: string[] = [];
  for (let i = 1; i <= expected; i += 1) {
    const key = `${prefix}${i}`;
    const values = byKey.get(key) ?? [];
    if (values.length === 0) {
      throw new Error(`compileGovernanceL0: missing ${prefix} heading ${key}`);
    }
    if (values.length > 1) {
      throw new Error(`compileGovernanceL0: duplicate ${prefix} heading ${key}`);
    }
    ordered.push(values[0] ?? '');
  }
  return ordered;
}

function extractMagicWords(markdown: string): string[] {
  const rows = [...markdown.matchAll(/^\|\s*「([^」]+)」\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)]
    .filter((m) => !m[1]?.includes('拉闸词'))
    .map((m) => `-「${normalizeInline(m[1] ?? '')}」= ${normalizeInline(m[2] ?? '')} → ${normalizeInline(m[3] ?? '')}`);
  if (rows.length < 9) {
    throw new Error(`compileGovernanceL0: expected ≥9 Magic Words rows, found ${rows.length}`);
  }
  return rows;
}

/**
 * Deterministic projection from shared-rules.md into the compact always-on
 * governance L0 block. Pure: no file access.
 */
export function compileGovernanceL0FromMarkdown(markdown: string): string {
  for (const anchor of [
    '## Rule 0',
    '### Push Back 协议',
    '## 第一性原理',
    '## 世界观',
    '## Magic Words',
    '## 10. @ 路由与球权',
    '## 14. 共享状态文件只在 main 改',
    '## 16. 实事求是',
    '### 46 hotfix 标签 + 跨猫升级 review',
    'fallback 层数检测协议',
    '创意-实现解耦协议',
    '## 0. 身份契约',
    '## 17. 决策漏斗',
  ]) {
    assertPresent(markdown, anchor);
  }

  const principles = extractNumberedHeadings(markdown, 'P', 5);
  const worldviews = extractNumberedHeadings(markdown, 'W', 8);
  const magicWords = extractMagicWords(markdown);
  const identityContract = extractFirstParagraphAfterHeading(markdown, '## 0. 身份契约');
  const fallbackProtocolLabel = extractProtocolLabel(markdown, 'fallback 层数检测协议');
  const creativeProtocolLabel = extractProtocolLabel(markdown, '创意-实现解耦协议');

  return [
    '## 3. 家规（shared-rules.md）',
    'Rule 0: 规则是边界不是全部。边界之内保留判断力；认为不适用时用证据说话。Push Back 协议：证据 + 适用性论证 + 替代方案。判断力三问：我现在在做什么 / 我的信息源可靠吗 / 方案感觉笨重？',
    '',
    '### 第一性原理 P1-P5',
    ...principles,
    '',
    '### 世界观 W1-W8',
    ...worldviews,
    '',
    '### 纪律',
    `- 身份契约：${identityContract}`,
    '- 用自己的身份签名 `[昵称/模型🐾]`，签名必须含模型型号；commit body 写 Why。',
    '- 实事求是：结论必须基于多源证据（代码 / commit / PR / 文档）；没查完就说还没查完。',
    '- @ 是路由指令；收到 @ 后三选一：接 / 退 / 升。状态描述不是球权声明。',
    '- 球权只有第一人称；唯一凭据是 @ 或 hold_ball 动作本身。',
    '- 等外部条件走 `cat_cafe_hold_ball(...)` 或结构化回调，不把云端 / GitHub bot 投射成本地猫。',
    '- 共享状态文件只在 main 改，改完立刻 `git commit + git push`。',
    '- 跨 thread 阻塞依赖双写到可追溯状态；消息不是真相源。',
    '',
    '### 质量覆盖',
    '- Bug 先定位根因再修；不确定方向：停 → 搜 → 问 → 确认 → 再动手。',
    '- “完成”附证据；Bug 先红后绿；scope 失控要记录并沉淀。',
    '- 被co-creator纠正理解偏差时，先完成实际任务，再按 self-evolution 归档偏差根因。',
    '',
    '### Magic Words（co-creator专用拉闸词 — 仅co-creator当前指令触发）',
    ...magicWords,
    '',
    '### 治理协议（per-family）',
    '- 46 hotfix 止血：fix/hotfix/quick fix/minimal fix/band-aid/temp/workaround → hotfix；跨猫 review 铁律：hotfix PR 必须跨族或同族不同个体 review，不允许 self-merge；2 周升级 review 三选一。',
    `- ${fallbackProtocolLabel}：同一文件新增 ≥3 层 fallback → 坐标系自检、替代方案评估、说明每层为何不能去掉。`,
    `- ${creativeProtocolLabel}：发现问题 ≠ 动手实现；记录 + handoff；白名单外代码改动需要 Dry Run Gate。`,
    '',
    '### 决策漏斗（越宏观越关注，越细节越放手）',
    '- SOP 流程推进不是决策，是执行。SOP 写了下一步就照做，不问。能翻代码解决的不要问人。',
    '- 三层：宏观 operator 拍板 / 中间猫猫讨论 / 细节+流程猫猫自治（详见 `decision-matrix.md`）',
    '- 可逆性：≤1 commit 回滚 + 不影响外部用户/数据/契约 + 不碰硬排除（愿景/权限/生产数据/production data boundary/新外部依赖/契约/显著成本）→ 自决 + 事后通报',
    '- operator 升级必带 Decision Packet：给价值取舍题不给技术 A/B 题；缺 Packet = 打回',
  ].join('\n');
}

/**
 * Load and compile governance L0, honoring `.local-override` (replace) then
 * `.local` (append) overlays. File reads go through the injected seam.
 */
export function loadCompiledGovernanceL0Sync(fileSystem: FileSystemSeam): CompiledGovernanceL0 {
  const sourcePath = `${fileSystem.rootDir}/${SHARED_RULES_RELPATH}`.replace(/\/+/g, '/');
  const paths = localPaths(sourcePath);

  const override = fileSystem.readFileSync(paths.override);
  if (override !== null) {
    return {
      content: override.trimEnd(),
      sourcePath,
      source: 'override',
      overlayPath: paths.override,
      generatedFrom: SHARED_RULES_RELPATH,
    };
  }

  const base = fileSystem.readFileSync(sourcePath);
  if (base === null) {
    throw new Error(`compileGovernanceL0: shared-rules.md not found at ${sourcePath}`);
  }
  const compiled = compileGovernanceL0FromMarkdown(base);
  const local = fileSystem.readFileSync(paths.local);
  if (local !== null) {
    return {
      content: `${compiled}\n\n### 本地治理覆盖（shared-rules.local.md）\n${local.trimEnd()}`,
      sourcePath,
      source: 'local',
      overlayPath: paths.local,
      generatedFrom: SHARED_RULES_RELPATH,
    };
  }

  return {
    content: compiled,
    sourcePath,
    source: 'base',
    overlayPath: null,
    generatedFrom: SHARED_RULES_RELPATH,
  };
}