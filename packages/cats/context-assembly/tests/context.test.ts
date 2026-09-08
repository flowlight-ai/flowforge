/**
 * Contract tests — Context subdomain (B12).
 *
 * Real in-memory ports (`MemoryFileSystem` / `MemoryCatContext`), no mocks.
 * Covers IntentParser, governance L0 compile/load with overlay fallbacks,
 * prompt-template-loader render/substitution/missing fallback, L0 staging
 * content lifecycle, ContextAssembler assembly + message formatting, and
 * SystemPromptBuilder multi-version building.
 */

import { describe, it, expect } from 'vitest';
import type { CatConfig, CatId } from '@flowforge/cats-shared';
import { MemoryFileSystem, MemoryCatContext, type StoredMessage } from '../src/index.ts';
import { parseIntent, stripIntentTags } from '../src/index.ts';
import {
  compileGovernanceL0FromMarkdown,
  loadCompiledGovernanceL0Sync,
} from '../src/index.ts';
import {
  renderTemplate,
  stripComments,
  loadMcpToolsSection,
  loadWorkflowTriggers,
  loadA2aBallCheck,
  loadHandoffDecisionTree,
} from '../src/index.ts';
import {
  buildStagingPrepend,
  loadStagingManifest,
  _resetStagingCache,
  loadStagingBody,
} from '../src/index.ts';
import {
  formatMessage,
  assembleContext,
  getSourceDisplayName,
  getSenderName,
  buildMessageMap,
} from '../src/index.ts';
import {
  buildSystemPrompt,
  buildStaticIdentity,
  buildInvocationContext,
  buildTeammateRoster,
  buildCallableMentions,
  buildReviewerSection,
  buildStaticIdentityPackOnly,
} from '../src/index.ts';

// ── Intents ─────────────────────────────────────────────────────────────

describe('IntentParser', () => {
  it('#ideate is explicit regardless of cat count', () => {
    const r = parseIntent('我们 #ideate 一下方案', 1);
    expect(r.intent).toBe('ideate');
    expect(r.explicit).toBe(true);
  });

  it('#execute is explicit', () => {
    const r = parseIntent('#execute 直接做', 2);
    expect(r.intent).toBe('execute');
    expect(r.explicit).toBe(true);
  });

  it('auto-infers ideate when ≥2 cats and no explicit tag', () => {
    expect(parseIntent('聊聊思路', 2).intent).toBe('ideate');
  });

  it('auto-infers execute for a single cat with no explicit tag', () => {
    expect(parseIntent('把代码跑了', 1).intent).toBe('execute');
    expect(parseIntent('把代码跑了', 1).explicit).toBe(false);
  });

  it('collects #critique as a prompt tag without changing intent', () => {
    const r = parseIntent('#critique 看看这个', 1);
    expect(r.promptTags).toContain('critique');
    expect(r.intent).toBe('execute');
  });

  it('wakes custody-recognition skill on strong custody signals', () => {
    const r = parseIntent('这个事就你来负责跟进吧', 1);
    expect(r.promptTags).toContain('skill:custody-recognition');
  });

  it('does not wake custody skill on plain chat', () => {
    const r = parseIntent('早上好', 1);
    expect(r.promptTags).not.toContain('skill:custody-recognition');
  });

  it('stripIntentTags removes intent/prompt tags but keeps unknown words', () => {
    const out = stripIntentTags('#critique #ideate 帮我看看 foo');
    expect(out).not.toContain('#critique');
    expect(out).not.toContain('#ideate');
    expect(out).toContain('foo');
  });
});

// ── Governance L0 ───────────────────────────────────────────────────────

/**
 * A minimal shared-rules.md covering every anchor the compiler requires.
 * This is a contract fixture, not the production ruleset.
 */
function sampleSharedRules(): string {
  const magicRows = Array.from({ length: 11 }, (_, i) => `| 「词${i + 1}」 | 含义${i + 1} | 行动${i + 1} |`).join('\n');
  const principles = Array.from({ length: 5 }, (_, i) => `### P${i + 1}. 第一性原理 ${i + 1}\n内容${i + 1}`).join('\n');
  const worldviews = Array.from({ length: 8 }, (_, i) => `### W${i + 1}. 世界观 ${i + 1}\n内容${i + 1}`).join('\n');
  return [
    '## Rule 0',
    '规则是边界。',
    '',
    '### Push Back 协议',
    '证据 + 适用性论证 + 替代方案。',
    '',
    '## 第一性原理',
    principles,
    '',
    '## 世界观',
    worldviews,
    '',
    '## Magic Words',
    magicRows,
    '',
    '## 10. @ 路由与球权',
    '接/退/升。',
    '',
    '## 14. 共享状态文件只在 main 改',
    '改完立刻 commit + push。',
    '',
    '## 16. 实事求是',
    '多源证据。',
    '',
    '### 46 hotfix 标签 + 跨猫升级 review',
    'hotfix 止血铁律。',
    '',
    '### 三级 fallback 层数检测协议（family）',
    '同一文件新增 ≥3 层 fallback 需自检。',
    '',
    '### 创意主创-实现主创 创意-实现解耦协议（per-family）',
    '发现 ≠ 实现。',
    '',
    '## 0. 身份契约',
    '用自己的身份签名，签名必须含模型型号。',
    '',
    '## 17. 决策漏斗',
    '越宏观越关注，越细节越放手。',
  ].join('\n\n');
}

describe('governance-l0 compile', () => {
  it('compiles a valid shared-rules markdown deterministically', () => {
    const out = compileGovernanceL0FromMarkdown(sampleSharedRules());
    expect(out).toContain('## 3. 家规（shared-rules.md）');
    expect(out).toContain('### 第一性原理 P1-P5');
    expect(out).toContain('### 世界观 W1-W8');
    expect(out).toContain('- **P1** 第一性原理 1');
    expect(out).toContain('- **W8** 世界观 8');
    expect(out).toContain('身份契约：用自己的身份签名，签名必须含模型型号');
    // Protocol labels strip 「协议」 trailing and 「（family）」 suffix.
    expect(out).toContain('三级 fallback 层数检测');
    expect(out).not.toContain('三级 fallback 层数检测协议');
    expect(out).toContain('创意主创-实现主创');
    expect(out).not.toContain('（family）');
  });

  it('fails closed when a required anchor is missing', () => {
    const missing = sampleSharedRules().replace('## Rule 0', '## Rule X');
    expect(() => compileGovernanceL0FromMarkdown(missing)).toThrow('missing required shared-rules anchor "## Rule 0"');
  });

  it('fails closed on duplicate numbered principle', () => {
    const dup = sampleSharedRules().replace('### P1. 第一性原理 1', '### P2. 世界观 2\n### P1. 第一性原理 1\n### P2. 世界观 2');
    expect(() => compileGovernanceL0FromMarkdown(dup)).toThrow(/duplicate P heading|missing P heading/);
  });
});

describe('governance-l0 load', () => {
  it('loads base file when no overlay exists', () => {
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/shared-rules.md': sampleSharedRules(),
    });
    const compiled = loadCompiledGovernanceL0Sync(fs);
    expect(compiled.source).toBe('base');
    expect(compiled.overlayPath).toBeNull();
    expect(compiled.content).toContain('## 3. 家规');
    expect(compiled.sourcePath).toBe('/cat-cafe-skills/refs/shared-rules.md');
  });

  it('append-local overlay union with compiled base', () => {
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/shared-rules.md': sampleSharedRules(),
      'cat-cafe-skills/refs/shared-rules.local.md': '本地追加规则',
    });
    const compiled = loadCompiledGovernanceL0Sync(fs);
    expect(compiled.source).toBe('local');
    expect(compiled.content).toContain('### 本地治理覆盖（shared-rules.local.md）');
    expect(compiled.content).toContain('本地追加规则');
  });

  it('override-local replaces content entirely', () => {
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/shared-rules.md': sampleSharedRules(),
      'cat-cafe-skills/refs/shared-rules.local-override.md': '完全替换',
    });
    const compiled = loadCompiledGovernanceL0Sync(fs);
    expect(compiled.source).toBe('override');
    expect(compiled.content.trimEnd()).toBe('完全替换');
    expect(compiled.content).not.toContain('家规');
  });

  it('throws when base file is missing', () => {
    const fs = new MemoryFileSystem('/', {});
    expect(() => loadCompiledGovernanceL0Sync(fs)).toThrow('shared-rules.md not found');
  });
});

// ── Prompt template loader ──────────────────────────────────────────────

describe('prompt-template-loader', () => {
  it('renderTemplate substitutes known keys and leaves unknown placeholders', () => {
    const out = renderTemplate('Hello {{NAME}} and {{MISSING}}', { NAME: 'world' });
    expect(out).toBe('Hello world and {{MISSING}}');
  });

  it('stripComments removes HTML comment lines only', () => {
    const out = stripComments('a\n<!-- note -->\nb');
    expect(out).toBe('a\nb');
  });

  it('loadMcpToolsSection renders with variables and falls back to template', () => {
    const fs = new MemoryFileSystem('/', {
      'assets/prompt-templates/mcp-tools.md': 'MCP tools: {{RICH_BLOCK_SHORT}}',
    });
    const out = loadMcpToolsSection(fs, { RICH_BLOCK_SHORT: 'RICH_BLOCK_SHORT' });
    expect(out).toBe('MCP tools: RICH_BLOCK_SHORT');
  });

  it('loadMcpToolsSection prefers .local overlay', () => {
    const fs = new MemoryFileSystem('/', {
      'assets/prompt-templates/mcp-tools.md': 'base',
      '.cat-cafe/prompt-overlays/mcp-tools.local.md': 'local value {{RICH_BLOCK_SHORT}}',
    });
    const out = loadMcpToolsSection(fs, { RICH_BLOCK_SHORT: 'RB' });
    expect(out).toBe('local value RB');
  });

  it('loadMcpToolsSection returns empty string when file absent', () => {
    const fs = new MemoryFileSystem('/', {});
    expect(loadMcpToolsSection(fs, { RICH_BLOCK_SHORT: 'x' })).toBe('');
  });

  it('loadWorkflowTriggers parses simple YAML block scalars into a breed map', () => {
    const fs = new MemoryFileSystem('/', {
      'assets/prompt-templates/workflow-triggers.yaml': [
        'architect: |',
        '  architecture trigger flow',
        'breeder: |',
        '  breeder trigger flow',
      ].join('\n'),
    });
    const triggers = loadWorkflowTriggers(fs);
    expect(Object.keys(triggers)).toEqual(['architect', 'breeder']);
    expect(triggers.architect).toContain('architecture trigger flow');
  });

  it('loadWorkflowTriggers returns empty map when missing', () => {
    expect(loadWorkflowTriggers(new MemoryFileSystem('/', {}))).toEqual({});
  });

  it('loadA2aBallCheck and loadHandoffDecisionTree strip comments and fall back to empty', () => {
    const fs = new MemoryFileSystem('/', {
      'assets/prompt-templates/a2a-ball-check.md': '<!-- c -->\nball check',
      'assets/prompt-templates/handoff-decision-tree.md': 'tree {{CC_MENTION}}',
    });
    expect(loadA2aBallCheck(fs)).toBe('ball check');
    expect(loadHandoffDecisionTree(fs, { CC_MENTION: '@cc' })).toBe('tree @cc');
    expect(loadA2aBallCheck(new MemoryFileSystem('/', {}))).toBe('');
  });
});

// ── L0 Staging content ──────────────────────────────────────────────────

function stagingFile(): string {
  const manifest = [
    '---',
    'staging_version: 1',
    'schema_doc: ../docs/ADR/ADR-038.md',
    'hard_cap_tokens: 2000',
    'soft_margin_tokens: 200',
    'items:',
    '  - id: s1',
    '    title: 共享惯例',
    '    family: shared',
    '    source: convention/README.md',
    '    added_at: 2026-08-01',
    '    estimated_tokens: 300',
    '    first_principles_check:',
    '      single_round_complete: true',
    '      compress_gap_harmful: false',
    '      referenced_by_l0: true',
    '      verdict: keep',
    '  - id: b1',
    '    title: 育种专属',
    '    family: breeder',
    '    source: breed.md',
    '    added_at: 2026-08-02',
    '    estimated_tokens: 150',
    '    first_principles_check:',
    '      single_round_complete: true',
    '      compress_gap_harmful: false',
    '      referenced_by_l0: true',
    '      verdict: keep',
    '---',
    '',
    '## L0 Staging Body',
    '前端端口 {{FRONTEND_PORT}} API端口 {{API_SERVER_PORT}}',
  ].join('\n');
  return manifest;
}

function catConfig(): CatConfig {
  return {
    id: 'cat1' as CatId,
    name: 'cat1',
    displayName: '猫一',
    avatar: 'a',
    color: 'orange',
    mentionPatterns: ['@cat1'],
    clientId: 'api',
    defaultModel: 'model-x',
    mcpSupport: true,
    roleDescription: 'roles',
    personality: 'persona',
  };
}

describe('staging content', () => {
  it('parses manifest and renders shared-only prepend header', () => {
    _resetStagingCache();
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/l0-staging-content.md': stagingFile(),
    });
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    const out = buildStagingPrepend('cat1', { fileSystem: fs, catContext: ctx });
    expect(out).toContain('L0 Staging Layer (ADR-038, 1 shared items, ~300 tokens');
    expect(out).toContain('outside L0 2000-cap');
    expect(out).toContain('前端端口 3003 API端口 3004');
    // Breed-scoped item is excluded.
    expect(out).not.toContain('育种专属');
  });

  it('returns empty string when no config for the cat', () => {
    _resetStagingCache();
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/l0-staging-content.md': stagingFile(),
    });
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    expect(buildStagingPrepend('unknown', { fileSystem: fs, catContext: ctx })).toBe('');
  });

  it('returns empty string when staging file missing', () => {
    _resetStagingCache();
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    expect(buildStagingPrepend('cat1', { fileSystem: new MemoryFileSystem('/', {}), catContext: ctx })).toBe('');
  });

  it('loadStagingManifest exposes soft margin and item counts', () => {
    _resetStagingCache();
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/l0-staging-content.md': stagingFile(),
    });
    const manifest = loadStagingManifest(fs);
    expect(manifest.soft_margin_tokens).toBe(200);
    expect(manifest.items).toHaveLength(2);
  });

  it('loadStagingBody renders runtime ports', () => {
    _resetStagingCache();
    const fs = new MemoryFileSystem('/', {
      'cat-cafe-skills/refs/l0-staging-content.md': stagingFile(),
    });
    expect(loadStagingBody(fs, { frontendPort: '9999' })).toContain('前端端口 9999 API端口 3004');
  });
});

// ── ContextAssembler ────────────────────────────────────────────────────

function storedMessage(id: string, overrides: Partial<StoredMessage> = {}, t = 1000): StoredMessage {
  return { id, threadId: 'T1', userId: 'user-1', catId: null, content: '', timestamp: t, ...overrides };
}

describe('ContextAssembler', () => {
  it('getSenderName maps user to co-creator and cat to its display name', () => {
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    expect(getSenderName(null, ctx)).toBe('co-creator');
    expect(getSenderName('cat1' as CatId, ctx)).toBe('猫一');
    expect(getSenderName('absent', ctx)).toBe('absent');
  });

  it('getSourceDisplayName formats group and p2p names safely', () => {
    expect(getSourceDisplayName({ label: 'Feishu' })).toBe('Feishu');
    expect(getSourceDisplayName({ label: 'Feishu', sender: { id: 'u1', name: '小明' } })).toBe('小明 via Feishu');
  });

  it('formatMessage renders timestamp sender content', () => {
    expect(formatMessage(storedMessage('m1', { content: 'hi' }, 1_700_000_000_000))).toMatch(/^\[.+ co-creator\] hi$/);
  });

  it('fresh cat messages format with sentinel name resolved via config', () => {
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    const msg = storedMessage('m1', { catId: 'cat1' as CatId, content: 'meow' }, 1_700_000_000_000);
    expect(formatMessage(msg, { catContext: ctx })).toContain('猫一');
  });

  it('assembleContext returns empty for no delivered messages', () => {
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    const a = assembleContext([], { catContext: ctx });
    expect(a).toEqual({ contextText: '', messageCount: 0, estimatedTokens: 0 });
  });

  it('assembleContext excludes system, briefing and [错误] messages', () => {
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    const msgs = [
      storedMessage('s', { userId: 'system', catId: 'system' as unknown as CatId, content: 'sys' }),
      storedMessage('b', { origin: 'briefing', content: 'brief' }),
      storedMessage('e', { catId: 'cat1' as CatId, content: '[错误] boom' }),
      storedMessage('g', { content: 'good content' }),
    ];
    const a = assembleContext(msgs, { catContext: ctx });
    expect(a.messageCount).toBe(1);
    expect(a.contextText).toContain('good content');
    expect(a.contextText).not.toContain('brief');
    expect(a.contextText).not.toContain('[错误]');
  });

  it('assembleContext respects token budget and includes most recent messages', () => {
    const ctx = new MemoryCatContext({ cat1: catConfig() });
    const msgs = Array.from({ length: 10 }, (_, i) =>
      storedMessage(`m${i}`, { content: `message number ${i}` }, 1000 + i),
    );
    const a = assembleContext(msgs, { maxTotalTokens: 120, catContext: ctx });
    expect(a.messageCount).toBeGreaterThan(0);
    // Budget is small enough that not everything is included.
    expect(a.messageCount).toBeLessThan(10);
    // The newest message is always included.
    expect(a.contextText).toContain('message number 9');
  });

  it('formatMessage inlines reply previews via the message map', () => {
    const parent = storedMessage('p', { content: 'original line' });
    const child = storedMessage('c', { content: 'reply', replyTo: 'p' });
    const map = buildMessageMap([parent, child]);
    const out = formatMessage(child, { messageMap: map });
    expect(out).toContain('co-creator');
    expect(out).toContain('original line');
  });
});

// ── SystemPromptBuilder ─────────────────────────────────────────────────

function multiCatContext(): MemoryCatContext {
  const a: CatConfig = {
    id: 'catA' as CatId,
    name: 'catA',
    displayName: '老A',
    avatar: 'a',
    color: 'blue',
    mentionPatterns: ['@catA'],
    clientId: 'api',
    defaultModel: 'openai/gpt-4o',
    mcpSupport: true,
    roleDescription: 'roles',
    personality: 'persona',
    teamStrengths: '架构',
    caution: null,
  };
  const b: CatConfig = {
    id: 'catB' as CatId,
    name: 'catB',
    displayName: '老B',
    avatar: 'b',
    color: 'green',
    mentionPatterns: ['@catB'],
    clientId: 'api',
    defaultModel: 'openai/gpt-4o-2024-08-01',
    mcpSupport: true,
    roleDescription: 'roles',
    personality: 'persona',
    teamStrengths: '实现',
  };
  const ctx = new MemoryCatContext({ catA: a, catB: b });
  ctx.withRoster({
    getRoster: () => ({ catA: { family: 'alpha' }, catB: { family: 'beta' } }),
    isCatLead: (id) => id === 'catA',
    catHasRole: () => true,
  });
  ctx.withDossier({
    getL0Pronouns: () => '它喵',
    getRosterSummary: (id) => (id === 'catA' ? '架构担当，长期经验' : '实现担当'),
    hasEntry: () => true,
  });
  return ctx;
}

describe('SystemPromptBuilder', () => {
  it('builds static identity via prompt pipeline seam', () => {
    const ctx = multiCatContext();
    const out = buildStaticIdentity(ctx, 'catA' as CatId, { mcpAvailable: true });
    expect(out).toBe('catA');
  });

  it('buildInvocationContext delegates to the pipeline', () => {
    const ctx = multiCatContext();
    const out = buildInvocationContext(ctx, { catId: 'catA' as CatId, mode: 'independent', teammates: [], mcpAvailable: true });
    expect(out).toBe('');
  });

  it('buildTeammateRoster excludes current cat and resolves models', () => {
    const ctx = multiCatContext();
    const roster = buildTeammateRoster(ctx, 'catA' as CatId);
    expect(roster).toContain('## 队友名册');
    expect(roster).toContain('@catB');
    expect(roster).not.toContain('@catA');
    expect(roster).toContain('openai/gpt-4o');
  });

  it('buildCallableMentions dedupes and lists teammate mentions', () => {
    const ctx = multiCatContext();
    const r = buildCallableMentions(ctx, 'catA' as CatId);
    expect(r.mentions).toContain('@catB');
    expect(r.mentions).not.toContain('@catA');
  });

  it('buildReviewerSection lists cross-family reviewers per policy', () => {
    const ctx = multiCatContext();
    const section = buildReviewerSection(ctx, 'catA' as CatId);
    expect(section).toContain('## 你当前的 Reviewers');
    // catB is beta, catA is alpha → different family → cross-family.
    expect(section).toContain('@catB');
    expect(section).toContain('beta');
  });

  it('buildStaticIdentityPackOnly returns empty without pack blocks', () => {
    const ctx = multiCatContext();
    expect(buildStaticIdentityPackOnly(ctx, 'catA' as CatId)).toBe('');
  });

  it('buildSystemPrompt composes static + reviewer + invocation parts', () => {
    const ctx = multiCatContext();
    const out = buildSystemPrompt(ctx, { catId: 'catA' as CatId, mode: 'independent', teammates: [], mcpAvailable: true });
    expect(out).toContain('catA');
    expect(out).toContain('## 你当前的 Reviewers');
  });

  it('buildSystemPrompt returns empty for unknown cat', () => {
    const ctx = multiCatContext();
    expect(buildSystemPrompt(ctx, { catId: 'nope' as CatId, mode: 'independent', teammates: [], mcpAvailable: true })).toBe('');
  });
});