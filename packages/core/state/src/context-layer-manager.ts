/**
 * context-layer-manager — 多层上下文管理（TS 重写自 `core/context_layer_manager.py`，F27）。
 *
 * 长文创作工作流的分层上下文框架：L1 全文 / L2 章节摘要 / L3 卷摘要 /
 * L4 全书摘要 / WST 世界状态表。配置驱动（YAML → config dict），
 * Memory 与 LLM 依赖通过接口注入。
 *
 * @module @flowforge/core-state
 */

/** 标准上下文层级。 */
export enum ContextLayer {
  L1 = 'L1', // 全文
  L2 = 'L2', // 章节摘要
  L3 = 'L3', // 卷摘要
  L4 = 'L4', // 全书摘要
  WST = 'WST', // 世界状态表
}

/** Memory 最小接口（working 区读写 + 可选语义检索）。 */
export interface ContextMemoryLike {
  working: {
    get(key: string): unknown;
    save(key: string, data: unknown): Promise<void>;
  };
  semantic?: {
    search(query: string, options?: { top_k?: number }): Promise<unknown>;
  };
}

/** LLM 最小接口（执行 prompt 返回内容）。 */
export interface ContextLlmLike {
  execute(input: {
    params: Record<string, unknown>;
  }): Promise<{ result: { content?: string }; error?: string }>;
}

/** 上下文管理器配置。 */
export interface ContextLayerConfig {
  key_prefix?: string;
  layer_thresholds?: Array<[number, string]>;
  summary_target_len?: number;
  chunk_size?: number;
  volume_size?: number;
  full_summary_interval?: number;
  world_state_merge_fields?: string[];
  world_state_list_fields?: string[];
}

/** 任务上下文（state + input_data 最小视图）。 */
export interface TaskContextLike {
  state: Record<string, unknown>;
  input_data: Record<string, unknown>;
}

/** 章节记录。 */
export interface ChapterRecord {
  chapter_number: number;
  content?: string;
  summary?: string;
  version?: number;
}

/** 可配置的多层上下文管理器。 */
export class ContextLayerManager {
  static readonly DEFAULT_CONFIG: Required<ContextLayerConfig> = {
    key_prefix: 'novel',
    layer_thresholds: [
      [3, 'L1'],
      [10, 'L2'],
      [30, 'L3'],
      [999999, 'L4'],
    ],
    summary_target_len: 200,
    chunk_size: 500,
    volume_size: 10,
    full_summary_interval: 5,
    world_state_merge_fields: ['characters', 'timeline', 'geography', 'power_system'],
    world_state_list_fields: ['foreshadowing'],
  };

  readonly memory: ContextMemoryLike;
  readonly llmClient: ContextLlmLike | undefined;
  readonly config: Required<ContextLayerConfig>;

  constructor(
    memory: ContextMemoryLike,
    llmClient?: ContextLlmLike,
    config: ContextLayerConfig = {},
  ) {
    this.memory = memory;
    this.llmClient = llmClient;
    this.config = {
      ...ContextLayerManager.DEFAULT_CONFIG,
      ...config,
      layer_thresholds:
        config.layer_thresholds ?? ContextLayerManager.DEFAULT_CONFIG.layer_thresholds,
      world_state_merge_fields:
        config.world_state_merge_fields ??
        ContextLayerManager.DEFAULT_CONFIG.world_state_merge_fields,
      world_state_list_fields:
        config.world_state_list_fields ??
        ContextLayerManager.DEFAULT_CONFIG.world_state_list_fields,
    };
  }

  // ── Memory helpers ──

  private async store(key: string, data: unknown): Promise<void> {
    await this.memory.working.save(key, data);
  }

  private load(key: string): unknown {
    return this.memory.working.get(key);
  }

  private makeKey(entityId: string, suffix: string): string {
    return `${this.config.key_prefix}:${entityId}:${suffix}`;
  }

  // ── 主 API ──

  /** 为当前任务构建上下文层级（写入 context.state）。 */
  async buildContext(context: TaskContextLike): Promise<TaskContextLike> {
    const entityId = String(
      context.state['novel_id'] ?? context.state['entity_id'] ?? '',
    );
    const currentChapter = Number(context.state['current_chapter'] ?? 1);
    const chapters = await this.listChapters(entityId);
    const layer = this.determineLayer(chapters.length, currentChapter);
    context.state['context_layer'] = layer;

    context.state['previous_chapters'] = await this.collectChapters(
      chapters,
      currentChapter,
      layer,
    );
    context.state['world_state'] = await this.loadWorldState(
      entityId,
      currentChapter,
    );

    if (this.memory.semantic !== undefined) {
      try {
        context.state['semantic_results'] = await this.memory.semantic.search(
          String(context.input_data['task'] ?? ''),
          { top_k: 5 },
        );
      } catch {
        context.state['semantic_results'] = null;
      }
    } else {
      context.state['semantic_results'] = null;
    }

    const meta = await this.getMeta(entityId);
    context.state['full_book_summary'] = meta['summary'] ?? '';

    // 卷摘要（L3）
    let volumeSummary = '';
    const stateJson = meta['state_json'];
    if (stateJson !== undefined) {
      try {
        const state = parseJsonValue(stateJson) as Record<string, unknown>;
        const volumeNumber = Math.floor((currentChapter - 1) / this.config.volume_size) + 1;
        const summaries = (state['volume_summaries'] ?? {}) as Record<string, unknown>;
        volumeSummary = String(summaries[String(volumeNumber)] ?? '');
      } catch {
        // 解析失败 → 空摘要
      }
    }
    context.state['volume_summary'] = volumeSummary;

    // 上一章全文
    let prevChapterFullText = '';
    if (currentChapter > 1) {
      const prevCh = await this.getChapter(entityId, currentChapter - 1);
      if (prevCh !== undefined && prevCh.content) {
        prevChapterFullText = prevCh.content;
      }
    }
    context.state['prev_chapter_full_text'] = prevChapterFullText;

    // SOUL：风格画像 + 概念包
    const soul: Record<string, unknown> = {};
    const styleProfile = meta['style_profile'];
    if (styleProfile !== undefined) {
      soul['style_profile'] = parseJsonValue(styleProfile);
    }
    const conceptPackage = meta['concept_package'];
    if (conceptPackage !== undefined) {
      soul['concept_package'] = parseJsonValue(conceptPackage);
    }
    context.state['soul'] = soul;

    return context;
  }

  /** 章节完成后写入各上下文层级。 */
  async writeContextLayers(context: TaskContextLike): Promise<void> {
    const entityId = String(
      context.state['novel_id'] ?? context.state['entity_id'] ?? '',
    );
    const currentChapter = Number(context.state['current_chapter'] ?? 1);
    await this.writeChapterContext(
      entityId,
      currentChapter,
      String(context.state['chapter_content'] ?? ''),
    );
  }

  /** 写入已完成章节的上下文层级（两阶段并行：摘要+世界状态 → 卷+全书摘要）。 */
  async writeChapterContext(
    entityId: string,
    chapterNumber: number,
    content: string,
  ): Promise<void> {
    if (!content) {
      return;
    }

    // L1: 嵌入块（无 LLM）
    await this.saveEmbeddingChunks(entityId, chapterNumber, content);

    // ── Phase 1: 章节摘要 + 世界状态提取（并行）──
    const chapter = await this.getChapter(entityId, chapterNumber);

    const phase1Tasks: Promise<unknown>[] = [];
    if (chapter !== undefined && !chapter.summary) {
      phase1Tasks.push(
        (async () => {
          const summary = await this.generateSummary(
            content,
            this.config.summary_target_len,
          );
          await this.upsertChapter(entityId, chapterNumber, {
            content,
            summary,
            version: chapter.version ?? 1,
          });
        })(),
      );
    }
    phase1Tasks.push(
      this.extractAndUpdateWorldState(entityId, chapterNumber, content),
    );
    await Promise.allSettled(phase1Tasks);

    // 刷新章节列表（章节摘要可能刚持久化）
    const chapters = await this.listChapters(entityId);

    // ── Phase 2: 卷摘要 + 全书摘要（生成并行，保存串行防 meta 竞争）──
    const [volumeResult, fullResult] = await Promise.allSettled([
      this.generateVolumeSummaryData(entityId, chapters, chapterNumber),
      this.generateFullSummaryData(entityId, chapters),
    ]);

    if (volumeResult.status === 'fulfilled' && volumeResult.value !== null) {
      const [volumeNumber, volumeSummary] = volumeResult.value;
      await this.saveVolumeSummary(entityId, volumeNumber, volumeSummary);
    }
    if (fullResult.status === 'fulfilled' && fullResult.value !== null) {
      await this.saveFullSummary(entityId, fullResult.value);
    }
  }

  // ── 层级确定 ──

  /** 按总章节数与当前章节确定上下文层级。 */
  determineLayer(totalChapters: number, currentChapter: number): string {
    void currentChapter; // 保留参数：Python 版用于日志，此处仅保持 API 对齐
    for (const [threshold, layerName] of this.config.layer_thresholds) {
      if (totalChapters <= threshold) {
        return Object.values(ContextLayer).includes(layerName as ContextLayer)
          ? layerName
          : ContextLayer.L4;
      }
    }
    return ContextLayer.L4;
  }

  // ── 章节收集 ──

  /** 收集当前章节之前的章节（L1 全文 / 其余摘要，超长截断）。 */
  async collectChapters(
    chapters: ChapterRecord[],
    current: number,
    layer: string,
  ): Promise<Array<Record<string, unknown>>> {
    const result: Array<Record<string, unknown>> = [];
    for (const ch of chapters) {
      const chNum = ch.chapter_number;
      if (chNum >= current) {
        continue;
      }
      if (layer === ContextLayer.L1) {
        result.push({ number: chNum, content: ch.content ?? '' });
      } else {
        let fallback = (ch.content ?? '').slice(0, 500);
        if ((ch.content ?? '').length > 500) {
          fallback += '[摘要截断]';
        }
        result.push({ number: chNum, summary: ch.summary || fallback });
      }
    }
    return result;
  }

  // ── 世界状态 ──

  /** 加载某章节的世界状态（按 merge/list 字段过滤）。 */
  async loadWorldState(
    entityId: string,
    chapterNumber: number,
  ): Promise<Record<string, unknown>> {
    const wsData = await this.loadWorldStateData(entityId);
    if (wsData === null || typeof wsData !== 'object' || Array.isArray(wsData)) {
      return {};
    }
    const record = (wsData as Record<string, unknown>)[String(chapterNumber)];
    if (record === undefined || typeof record !== 'object') {
      return {};
    }
    const recordObj = record as Record<string, unknown>;
    const fields = [
      ...this.config.world_state_merge_fields,
      ...this.config.world_state_list_fields,
    ];
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      const isMerge = this.config.world_state_merge_fields.includes(field);
      out[field] =
        recordObj[field] ??
        (isMerge ? {} : []);
    }
    return out;
  }

  // ── L1: 嵌入块 ──

  /** 将内容切块并保存（覆盖同章节旧块）。 */
  async saveEmbeddingChunks(
    entityId: string,
    chapterNumber: number,
    content: string,
  ): Promise<void> {
    const chunkSize = this.config.chunk_size;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunkText = content.slice(i, i + chunkSize);
      if (chunkText.trim() !== '') {
        chunks.push(chunkText);
      }
    }
    let existing = await this.loadEmbeddings(entityId);
    existing = existing.filter((c) => c['chapter_number'] !== chapterNumber);
    for (let idx = 0; idx < chunks.length; idx += 1) {
      existing.push({
        entity_id: entityId,
        chapter_number: chapterNumber,
        chunk_index: idx,
        text: chunks[idx],
      });
    }
    await this.saveEmbeddings(entityId, existing);
  }

  // ── L3: 卷摘要 ──

  /** 生成（不持久化）卷摘要；无需生成时返回 null。 */
  async generateVolumeSummaryData(
    entityId: string,
    chapters: ChapterRecord[],
    currentChapter: number,
  ): Promise<[number, string] | null> {
    const volumeSize = this.config.volume_size;
    const volumeStart = Math.floor((currentChapter - 1) / volumeSize) * volumeSize + 1;
    const volumeEnd = Math.min(volumeStart + volumeSize - 1, chapters.length);
    const volumeNumber = Math.floor((currentChapter - 1) / volumeSize) + 1;

    const isVolumeEnd =
      currentChapter % volumeSize === 0 || currentChapter === chapters.length;
    if (!isVolumeEnd) {
      const existingSummary = await this.getVolumeSummary(entityId, volumeNumber);
      if (existingSummary !== '') {
        return null;
      }
    }

    const volumeChapters = chapters.filter(
      (ch) => ch.chapter_number >= volumeStart && ch.chapter_number <= volumeEnd,
    );
    if (volumeChapters.length === 0) {
      return null;
    }
    const volumeTexts: string[] = [];
    for (const ch of volumeChapters) {
      if (ch.summary) {
        volumeTexts.push(`第${ch.chapter_number}章：${ch.summary}`);
      } else if (ch.content) {
        volumeTexts.push(`第${ch.chapter_number}章：${ch.content.slice(0, 500)}[摘要截断]`);
      }
    }
    if (volumeTexts.length === 0) {
      return null;
    }
    const volumeSummary = await this.generateSummary(volumeTexts.join('\n'), 300);
    if (!volumeSummary) {
      return null;
    }
    return [volumeNumber, volumeSummary];
  }

  // ── L4: 全书摘要 ──

  /** 生成（不持久化）全书摘要；无需生成时返回 null。 */
  async generateFullSummaryData(
    entityId: string,
    chapters: ChapterRecord[],
  ): Promise<string | null> {
    let existingSummary = '';
    try {
      const meta = await this.getMeta(entityId);
      existingSummary = String(meta['summary'] ?? '');
    } catch {
      // 读取失败 → 视为无摘要
    }
    const currentChapter = chapters.length > 0 ? chapters[chapters.length - 1]!.chapter_number : 0;
    const interval = this.config.full_summary_interval;
    if (existingSummary !== '' && currentChapter % interval !== 0) {
      return null;
    }
    const allSummaries = chapters
      .map((ch) => ch.summary ?? '')
      .filter((s) => s !== '');
    if (allSummaries.length === 0) {
      return null;
    }
    const fullSummary = await this.generateSummary(allSummaries.join('\n'), 500);
    return fullSummary !== '' ? fullSummary : null;
  }

  // ── L5: 世界状态提取 ──

  /** 用 LLM 从章节内容提取实体并合并到世界状态。 */
  async extractAndUpdateWorldState(
    entityId: string,
    chapterNumber: number,
    content: string,
  ): Promise<void> {
    if (!this.llmClient || !content) {
      return;
    }
    try {
      const prompt =
        '请从以下内容中提取关键实体信息，输出 JSON 格式：\n' +
        '{"characters": {"角色名": "角色描述"}, ' +
        '"timeline": {"事件": "时间线描述"}, ' +
        '"foreshadowing": ["伏笔1", "伏笔2"], ' +
        '"geography": {"地名": "地点描述"}, ' +
        '"power_system": {"体系名": "体系描述"}}\n\n' +
        `内容：\n${content.slice(0, 6000)}\n\n` +
        '请直接输出 JSON，不要包含任何额外说明。';
      const llmResult = await this.llmClient.execute({
        params: { messages: [{ role: 'user', content: prompt }] },
      });
      const text = (llmResult.result?.content ?? '').trim();
      const entities = parseJsonLoose(text);
      if (Object.keys(entities).length === 0) {
        return;
      }
      const existing = await this.loadWorldState(entityId, chapterNumber);
      const merged = this.mergeWorldState(existing, entities);
      let wsData = await this.loadWorldStateData(entityId);
      if (wsData === null || typeof wsData !== 'object' || Array.isArray(wsData)) {
        wsData = {};
      }
      (wsData as Record<string, unknown>)[String(chapterNumber)] = merged;
      await this.saveWorldStateData(entityId, wsData as Record<string, unknown>);
    } catch {
      // 提取失败 → 跳过（对齐 Python warning 语义）
    }
  }

  /** 合并世界状态（merge 字段 dict update / list 字段 extend）。 */
  mergeWorldState(
    existing: Record<string, unknown>,
    newEntities: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = { ...existing };
    for (const field of this.config.world_state_merge_fields) {
      const entry = newEntities[field];
      if (entry !== undefined && typeof entry === 'object' && !Array.isArray(entry)) {
        const existingDict = merged[field];
        if (existingDict !== undefined && typeof existingDict === 'object' && !Array.isArray(existingDict)) {
          Object.assign(existingDict as Record<string, unknown>, entry);
        } else {
          merged[field] = { ...(entry as Record<string, unknown>) };
        }
      }
    }
    for (const field of this.config.world_state_list_fields) {
      const entry = newEntities[field];
      if (Array.isArray(entry)) {
        const existingList = merged[field];
        if (Array.isArray(existingList)) {
          existingList.push(...entry);
        } else {
          merged[field] = [...entry];
        }
      }
    }
    return merged;
  }

  // ── Shared helpers ──

  /** 生成摘要：短内容直接返回；长内容走 LLM（失败回退截断）。 */
  async generateSummary(content: string, targetLen: number): Promise<string> {
    if (!content) {
      return '';
    }
    if (content.length <= targetLen) {
      return content;
    }
    if (this.llmClient) {
      try {
        const prompt =
          `请将以下内容压缩为${targetLen}字以内的摘要，保留关键情节和重要细节。\n\n` +
          `原文：\n${content.slice(0, 8000)}\n\n` +
          '请直接输出摘要，不要包含任何额外说明。';
        const llmResult = await this.llmClient.execute({
          params: { messages: [{ role: 'user', content: prompt }] },
        });
        const summary = (llmResult.result?.content ?? '').trim();
        if (summary !== '' && summary.length <= targetLen * 2) {
          return summary;
        }
      } catch {
        // LLM 失败 → 回退截断
      }
    }
    const fallbackLen = Math.min(500, content.length);
    return content.slice(0, fallbackLen) + (content.length > fallbackLen ? '[摘要截断]' : '');
  }

  // ── 实体元数据 / 章节 / 世界状态 / 嵌入块内部存取 ──

  private async getMeta(entityId: string): Promise<Record<string, unknown>> {
    const meta = this.load(this.makeKey(entityId, 'meta'));
    return meta !== null && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};
  }

  private async saveMeta(
    entityId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.store(this.makeKey(entityId, 'meta'), meta);
  }

  /** 列出章节列表。 */
  async listChapters(entityId: string): Promise<ChapterRecord[]> {
    const chapters = this.load(this.makeKey(entityId, 'chapters'));
    return Array.isArray(chapters) ? (chapters as ChapterRecord[]) : [];
  }

  private async saveChapters(
    entityId: string,
    chapters: ChapterRecord[],
  ): Promise<void> {
    await this.store(this.makeKey(entityId, 'chapters'), chapters);
  }

  /** 按章节号获取章节。 */
  async getChapter(
    entityId: string,
    chapterNumber: number,
  ): Promise<ChapterRecord | undefined> {
    const chapters = await this.listChapters(entityId);
    return chapters.find((ch) => ch.chapter_number === chapterNumber);
  }

  /** 更新或追加章节。 */
  async upsertChapter(
    entityId: string,
    chapterNumber: number,
    updates: Partial<ChapterRecord>,
  ): Promise<ChapterRecord> {
    const chapters = await this.listChapters(entityId);
    let found = chapters.find((ch) => ch.chapter_number === chapterNumber);
    if (found !== undefined) {
      Object.assign(found, updates);
    } else {
      found = { chapter_number: chapterNumber, ...updates } as ChapterRecord;
      chapters.push(found);
      chapters.sort((a, b) => a.chapter_number - b.chapter_number);
    }
    await this.saveChapters(entityId, chapters);
    return found;
  }

  private async loadWorldStateData(
    entityId: string,
  ): Promise<unknown> {
    return this.load(this.makeKey(entityId, 'world_state'));
  }

  private async saveWorldStateData(
    entityId: string,
    ws: Record<string, unknown>,
  ): Promise<void> {
    await this.store(this.makeKey(entityId, 'world_state'), ws);
  }

  private async loadEmbeddings(
    entityId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const data = this.load(this.makeKey(entityId, 'embeddings'));
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  }

  private async saveEmbeddings(
    entityId: string,
    chunks: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.store(this.makeKey(entityId, 'embeddings'), chunks);
  }

  private async getVolumeSummary(
    entityId: string,
    volumeNumber: number,
  ): Promise<string> {
    try {
      const meta = await this.getMeta(entityId);
      const stateJson = meta['state_json'];
      if (stateJson === undefined) {
        return '';
      }
      const state = parseJsonValue(stateJson) as Record<string, unknown>;
      const summaries = (state['volume_summaries'] ?? {}) as Record<string, unknown>;
      return String(summaries[String(volumeNumber)] ?? '');
    } catch {
      return '';
    }
  }

  private async saveVolumeSummary(
    entityId: string,
    volumeNumber: number,
    volumeSummary: string,
  ): Promise<void> {
    try {
      const meta = await this.getMeta(entityId);
      const stateJson = meta['state_json'];
      const state =
        stateJson === undefined
          ? {}
          : (parseJsonValue(stateJson) as Record<string, unknown>);
      const summaries = (state['volume_summaries'] ?? {}) as Record<string, unknown>;
      summaries[String(volumeNumber)] = volumeSummary;
      state['volume_summaries'] = summaries;
      meta['state_json'] = JSON.stringify(state);
      await this.saveMeta(entityId, meta);
    } catch {
      // 保存失败 → 跳过（对齐 Python warning）
    }
  }

  private async saveFullSummary(
    entityId: string,
    fullSummary: string,
  ): Promise<void> {
    try {
      const meta = await this.getMeta(entityId);
      meta['summary'] = fullSummary;
      await this.saveMeta(entityId, meta);
    } catch {
      // 保存失败 → 跳过
    }
  }
}

/** 解析 JSON 字符串或透传对象。 */
function parseJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** 宽松 JSON 解析（提取首个 {…} 块）。 */
function parseJsonLoose(text: string): Record<string, unknown> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch !== null) {
    try {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      // 解析失败 → 空
    }
  }
  return {};
}
