/**
 * @flowforge/cats-packs — C30 PackKnowledgeScope（F129 Pack 知识隔离 AC-A10）
 *
 * TS 移植：clowder-ai `domains/packs/PackKnowledgeScope.ts`。
 * Phase A 基础：将 pack knowledge/ 文件注册进证据库，带 pack_id 作用域。
 * 全局搜索默认排除 pack 知识；真实 RAG 检索推迟到 Phase B。
 *
 * 插件化：上游 `IEvidenceStore`（clowder-ai memory 域）剥离为
 * `PackKnowledgeStore` 端口 —— 宿主注入结构兼容实现即可。
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/** 证据条目（结构兼容 clowder-ai memory 域 EvidenceItem 最小面） */
export interface PackKnowledgeItem {
  anchor: string;
  kind: string;
  status: string;
  title: string;
  summary: string;
  keywords: string[];
  sourcePath: string;
  sourceHash: string;
  updatedAt: string;
  packId: string;
}

/** Pack 知识存储端口（原 IEvidenceStore 剥离；宿主注入实现） */
export interface PackKnowledgeStore {
  upsert(items: readonly PackKnowledgeItem[]): Promise<unknown>;
  deleteByAnchor(anchorPattern: string): Promise<unknown>;
  /** 可选：按 pack_id 直删（无 limit、无搜索依赖） */
  deleteByPackId?(packId: string): Promise<unknown>;
}

export class PackKnowledgeScope {
  constructor(private readonly knowledgeStore: PackKnowledgeStore) {}

  /**
   * Register knowledge files from a pack's knowledge/ directory.
   * Each .md/.txt file gets an evidence entry with pack_id = packName.
   */
  async registerKnowledge(packName: string, knowledgeDir: string): Promise<number> {
    let entries: string[];
    try {
      const s = await stat(knowledgeDir);
      if (!s.isDirectory()) return 0;
      entries = await readdir(knowledgeDir);
    } catch {
      return 0; // No knowledge dir — ok
    }

    const items: PackKnowledgeItem[] = [];
    for (const entry of entries) {
      const ext = extname(entry).toLowerCase();
      if (ext !== '.md' && ext !== '.txt') continue;

      const filePath = join(knowledgeDir, entry);
      try {
        const content = await readFile(filePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
        const title = extractTitle(content, entry);

        items.push({
          anchor: `pack:${packName}:${basename(entry, ext)}`,
          kind: 'pack-knowledge',
          status: 'active',
          title,
          summary: content.slice(0, 500),
          keywords: [packName],
          sourcePath: filePath,
          sourceHash: hash,
          updatedAt: new Date().toISOString(),
          packId: packName,
        });
      } catch {
        // Skip unreadable files
      }
    }

    if (items.length > 0) {
      await this.knowledgeStore.upsert(items);
    }
    return items.length;
  }

  /**
   * Remove all knowledge entries for a pack.
   * Uses deleteByPackId when available (no limit, no search dependency);
   * otherwise falls back to anchor prefix pattern delete.
   */
  async removeKnowledge(packName: string): Promise<void> {
    if (this.knowledgeStore.deleteByPackId) {
      await this.knowledgeStore.deleteByPackId(packName);
    } else {
      // Fallback: delete by anchor prefix pattern
      await this.knowledgeStore.deleteByAnchor(`pack:${packName}:%`);
    }
  }
}

/** Extract title from markdown content or fall back to filename */
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || basename(filename, extname(filename));
}
