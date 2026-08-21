/**
 * @flowforge/forgekin-knowledge — 阶段7 T7.4/T7.23 MindCodex 可检索知识库
 *
 * 本地化自 flowforge Python `core/memory_federation/mind_codex.py`（412 行）：
 * roleagent.md §4.3 L5 MindCodex 层 —— SpiritForge 蒸馏产出存储层，跨代际持续。
 *
 * 检索设计（roleagent.md §4.1 简单系统优先）：
 * - 子串匹配（grep 风格，零幻觉）：标题 +0.5 / 内容 +0.3 / 标签 +0.2
 * - 关键词重叠（语义补充）：+0.1 × overlap/|query_terms|
 * - 消费加权排名（F38）：条目使用次数提升排名
 *
 * @module @flowforge/forgekin-knowledge/mind-codex
 */

import { randomUUID } from 'node:crypto';

/** MindCodex 条目 — 蒸馏的经验单元（跨代际持续） */
export interface MindCodexEntry {
  codexId: string;
  /** 经验标题（人类可读，突出可复用核心经验） */
  title: string;
  /** 经验内容（结构化文本：情境 / 动作 / 结果三要素） */
  content: string;
  /** 所属领域（programming / finance / medicine / general） */
  domain: string;
  /** 技能标签列表（用于检索匹配 + Index 入口） */
  skillTags: string[];
  /** 来源经验标识（episode_id / trace_id） */
  derivedFrom: string;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 使用次数（消费加权排名，F38） */
  usageCount: number;
}

export function makeMindCodexEntry(init: Pick<MindCodexEntry, 'title' | 'content'> & Partial<Omit<MindCodexEntry, 'title' | 'content'>>): MindCodexEntry {
  return {
    codexId: randomUUID(),
    domain: 'general',
    skillTags: [],
    derivedFrom: '',
    createdAt: new Date().toISOString(),
    usageCount: 0,
    ...init,
  };
}

/** 从经验蒸馏的输入（对齐 Python derive_from_experience experience dict） */
export interface ExperienceInput {
  title: string;
  content: string;
  domain?: string;
  skillTags?: string[];
  sourceId?: string;
}

/** LLM 蒸馏客户端接口协议（对齐 Python async complete(prompt) -> str） */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

/** 检索命中（含评分，供上层调试/排名展示） */
export interface CodexHit {
  entry: MindCodexEntry;
  /** 子串匹配 + 关键词重叠 + 消费加权的综合分 */
  score: number;
}

export interface MindCodexOptions {
  /** 可选 LLM 客户端（deriveFromExperience 蒸馏；未注入走规则化 fallback） */
  readonly llmClient?: LlmClient | undefined;
  /** 蒸馏提示词模板（铁律 5+P16：无模板即使有 LLM 也不调用） */
  readonly distillPromptTemplate?: string | undefined;
}

export class MindCodex {
  private readonly entries: MindCodexEntry[] = [];
  private readonly llmClient: LlmClient | undefined;
  private readonly distillPromptTemplate: string | undefined;

  constructor(options: MindCodexOptions = {}) {
    this.llmClient = options.llmClient;
    this.distillPromptTemplate = options.distillPromptTemplate;
  }

  /** 添加条目 */
  async addEntry(entry: MindCodexEntry): Promise<void> {
    this.entries.push(entry);
  }

  /** 列出所有条目（trace / 调试） */
  listEntries(): MindCodexEntry[] {
    return [...this.entries];
  }

  /**
   * 检索条目（评分降序，消费加权排名）：
   * 标题命中 +0.5 / 内容命中 +0.3 / 标签命中 +0.2 / 关键词重叠 +0.1×overlap + 使用加权
   */
  async search(query: string, topK = 5): Promise<MindCodexEntry[]> {
    if (!query) return [];
    const queryLower = query.toLowerCase();
    const queryTerms = new Set(queryLower.split(/\s+/).filter(Boolean));
    const scored: CodexHit[] = [];

    for (const entry of this.entries) {
      const titleLower = entry.title.toLowerCase();
      const contentLower = entry.content.toLowerCase();
      const tagsText = entry.skillTags.map((t) => t.toLowerCase()).join(' ');

      let score = 0;
      if (queryLower !== '' && titleLower.includes(queryLower)) score += 0.5;
      if (queryLower !== '' && contentLower.includes(queryLower)) score += 0.3;
      if (queryLower !== '' && tagsText.includes(queryLower)) score += 0.2;

      if (queryTerms.size > 0) {
        const allText = `${titleLower} ${contentLower} ${tagsText}`;
        const entryTerms = new Set(allText.split(/\s+/).filter(Boolean));
        let overlap = 0;
        for (const term of queryTerms) {
          if (entryTerms.has(term)) overlap += 1;
        }
        score += 0.1 * overlap / Math.max(queryTerms.size, 1);
      }

      if (score > 0) {
        scored.push({ entry, score: score + entry.usageCount * 0.01 });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((h) => h.entry);
  }

  /**
   * 从经验蒸馏条目（v7.0 SpiritForge 产出 → MindCodex 存储）。
   * 同时注入 llmClient + 模板 → LLM 蒸馏；否则规则化 fallback（铁律 5+P16）。
   */
  async deriveFromExperience(experience: ExperienceInput): Promise<MindCodexEntry> {
    let title = experience.title || 'untitled_experience';
    let content = experience.content || '';
    let skillTags = [...(experience.skillTags ?? [])];
    const domain = experience.domain ?? 'general';
    const sourceId = experience.sourceId ?? '';

    if (this.llmClient && this.distillPromptTemplate) {
      try {
        const distilled = await this.llmDistill(title, content, domain, skillTags);
        title = distilled.title ?? title;
        content = distilled.content ?? content;
        skillTags = distilled.skillTags ?? skillTags;
      } catch {
        // LLM 蒸馏失败走规则化 fallback（原始经验字段）
      }
    }

    const entry = makeMindCodexEntry({
      title,
      content,
      domain,
      skillTags,
      derivedFrom: sourceId,
    });
    await this.addEntry(entry);
    return entry;
  }

  /** 记录一次消费（F38 消费加权排名） */
  async recordConsumption(codexId: string): Promise<void> {
    const entry = this.entries.find((e) => e.codexId === codexId);
    if (entry) entry.usageCount += 1;
  }

  /** 从 LLM 响应中提取 JSON 块（纯 JSON / ```json``` / 首尾大括号） */
  static extractJson(text: string): string | undefined {
    const trimmed = text.trim();
    if (trimmed.includes('```')) {
      const parts = trimmed.split('```');
      for (let i = 1; i < parts.length; i += 2) {
        let part = parts[i]!.trim();
        if (part.startsWith('json')) part = part.slice(4).trim();
        if (part.startsWith('{') && part.endsWith('}')) return part;
      }
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
    return undefined;
  }

  // ── 内部 ───────────────────────────────────────────────────────────────

  private async llmDistill(
    title: string,
    content: string,
    domain: string,
    skillTags: string[],
  ): Promise<{ title?: string; content?: string; skillTags?: string[] }> {
    const template = this.distillPromptTemplate;
    if (!template) return { title, content, skillTags };
    const prompt = template
      .replaceAll('{title}', title)
      .replaceAll('{content}', content)
      .replaceAll('{domain}', domain)
      .replaceAll('{skill_tags}', skillTags.length > 0 ? skillTags.join(', ') : '(none)');

    const response = await this.llmClient!.complete(prompt);
    const result: { title?: string; content?: string; skillTags?: string[] } = {
      content: response,
    };
    const jsonStr = MindCodex.extractJson(response);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
        if (typeof parsed.title === 'string') result.title = parsed.title;
        if (typeof parsed.content === 'string') result.content = parsed.content;
        if (Array.isArray(parsed.skill_tags)) result.skillTags = parsed.skill_tags.map(String);
      } catch {
        // 解析失败使用原始响应
      }
    }
    return result;
  }
}
