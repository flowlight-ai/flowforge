/**
 * auto-dream similarity — 关键词重叠相似度计算（对齐 Python SimilarityCalculator）。
 *
 * 骨架实现：生产环境应注入向量相似度计算器（如 sentence-transformers
 * cosine similarity），通过 DreamCycle 构造注入（红线 12 依赖注入）。
 *
 * @module @flowforge/forgekin-auto-dream
 */

import { createHash } from 'node:crypto';
import { EpisodeCard } from './models.js';

/**
 * 从 episode 中提取 domain（默认 'development'）。
 *
 * EpisodeCard 没有显式 domain 字段，从 task_snapshot 推断（对齐 Python
 * `_episode_domain`）。
 */
export function episodeDomain(episode: EpisodeCard): string {
  const snapshot = episode.task_snapshot.toLowerCase();
  if (snapshot.includes('医学') || snapshot.includes('medical')) {
    return 'medical';
  }
  if (snapshot.includes('法律') || snapshot.includes('legal')) {
    return 'legal';
  }
  return 'development';
}

/**
 * 基于关键词重叠的相似度计算器。
 *
 * 规则：同领域前提下，方法重叠权重 0.7 + 事实重叠权重 0.3；
 * 跨领域直接 0.0（不参与同簇）。
 */
export class SimilarityCalculator {
  /**
   * 计算 episode 签名（用于幂等性校验，I1）。
   *
   * 签名 = SHA256(task_snapshot|transferable_method|non_transferable_facts|
   * distillation_direction) 前 16 位。
   */
  static computeSignature(episode: EpisodeCard): string {
    const payload =
      `${episode.task_snapshot}|` +
      `${episode.transferable_method}|` +
      `${episode.non_transferable_facts}|` +
      `${episode.distillation_direction}`;
    return createHash('sha256').update(payload, 'utf-8').digest('hex').slice(0, 16);
  }

  /**
   * 计算两个 episode 的相似度（0.0~1.0）。
   */
  static similarity(a: EpisodeCard, b: EpisodeCard): number {
    if (episodeDomain(a) !== episodeDomain(b)) {
      return 0.0;
    }
    const methodOverlap = SimilarityCalculator.keywordOverlap(
      a.transferable_method,
      b.transferable_method,
    );
    const factsOverlap = SimilarityCalculator.keywordOverlap(
      a.non_transferable_facts,
      b.non_transferable_facts,
    );
    return 0.7 * methodOverlap + 0.3 * factsOverlap;
  }

  /**
   * 计算两个 episode 实例的相似度（实例方法，便于注入替换）。
   */
  computeSimilarity(a: EpisodeCard, b: EpisodeCard): number {
    return SimilarityCalculator.similarity(a, b);
  }

  /**
   * 计算 episode 实例签名（实例方法，便于注入替换）。
   */
  computeSignature(episode: EpisodeCard): string {
    return SimilarityCalculator.computeSignature(episode);
  }

  /** 关键词重叠度（Jaccard 相似度的变体） */
  static keywordOverlap(a: string, b: string): number {
    if (!a || !b) {
      return 0.0;
    }
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0.0;
    }
    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        intersection += 1;
      }
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0.0;
  }
}
