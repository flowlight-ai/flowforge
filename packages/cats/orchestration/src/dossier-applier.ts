/**
 * DossierDraftApplier — F208 AC-E3 纯函数应用器。
 *
 * 移植自 clowder-ai `distillation/DossierDraftApplier.ts`（保持纯函数语义）：
 * - 校验提案 baseHash 与当前 cat-dossier.md 是否一致（KD-17 stale-write lock）
 * - 仅在目标猫的 `### ... cat:{catId}` section 边界内替换 beforeSnapshot→afterDraft
 *   （P1 fix：非锚定 replace 可能破坏其它猫的 section；找不到 section header 即
 *   fail-closed，绝不回退到全文件搜索）
 * - 零 I/O —— 调用方传入当前文件内容，产出修改后内容 + 结构化 commit message；
 *   git commit/push 与 store.markApplied() 由调用方编排（KD-18）
 *
 * @module @flowforge/cats-orchestration/dossier-applier
 */

import { createHash } from 'node:crypto'
import type { DossierDistillationProposal } from '@flowforge/cats-shared'

export interface ApplyDraftResult {
  /** The modified file content (ready to write to disk). */
  modifiedContent: string
  /** Relative path from repo root. */
  targetPath: string
  /** Structured commit message. */
  commitMessage: string
}

export interface ApplyDraftError {
  code: 'BASE_HASH_MISMATCH' | 'BEFORE_SNAPSHOT_NOT_FOUND' | 'NOT_APPROVED'
  message: string
  /** Current file hash (for diagnostics). */
  currentHash?: string
}

export type ApplyDraftOutcome = { ok: true; result: ApplyDraftResult } | { ok: false; error: ApplyDraftError }

/** Relative path from repo root to the cat dossier file. */
export const DOSSIER_RELATIVE_PATH = 'docs/team/cat-dossier.md'

/** Compute SHA-256 hex hash of file content (same algorithm used for `baseHash`). */
export function computeFileHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Validate and compute the modified dossier content for a given proposal.
 *
 * PURE function (no I/O) — caller provides the current file content.
 */
export function prepareDraft(proposal: DossierDistillationProposal, currentFileContent: string): ApplyDraftOutcome {
  // Gate: must be approved
  if (proposal.status !== 'approved') {
    return {
      ok: false,
      error: { code: 'NOT_APPROVED', message: `Proposal status is '${proposal.status}', expected 'approved'` },
    }
  }

  // Stale-write lock: compare baseHash with current file hash
  const currentHash = computeFileHash(currentFileContent)
  if (currentHash !== proposal.baseHash) {
    return {
      ok: false,
      error: {
        code: 'BASE_HASH_MISMATCH',
        message: `Dossier file has changed since proposal creation (expected ${proposal.baseHash.slice(0, 8)}…, got ${currentHash.slice(0, 8)}…). Re-propose against the new baseline.`,
        currentHash,
      },
    }
  }

  // Anchor to the target cat's section only; fail closed when the header is absent.
  const sectionStart = findTargetCatSectionStart(currentFileContent, proposal.targetCatId)
  if (sectionStart < 0) {
    return {
      ok: false,
      error: {
        code: 'BEFORE_SNAPSHOT_NOT_FOUND',
        message: `Target cat section header (cat:${proposal.targetCatId}) not found in dossier — cannot safely apply without section anchoring.`,
      },
    }
  }
  // Bound search to target section only (up to next ### header), not to EOF.
  const sectionEnd = findSectionEnd(currentFileContent, sectionStart)
  const searchScope = currentFileContent.slice(sectionStart, sectionEnd)

  if (!searchScope.includes(proposal.beforeSnapshot)) {
    return {
      ok: false,
      error: {
        code: 'BEFORE_SNAPSHOT_NOT_FOUND',
        message: `beforeSnapshot text not found in target cat section (cat:${proposal.targetCatId}) despite baseHash match — proposal may be malformed.`,
      },
    }
  }

  // Replace only the first occurrence within the target section
  const offsetInScope = searchScope.indexOf(proposal.beforeSnapshot)
  const absoluteOffset = sectionStart + offsetInScope
  const modifiedContent =
    currentFileContent.slice(0, absoluteOffset) +
    proposal.afterDraft +
    currentFileContent.slice(absoluteOffset + proposal.beforeSnapshot.length)

  const fieldsStr = proposal.targetFields.join(', ')
  const commitMessage = [
    `docs(F208): apply distillation to ${proposal.targetCatId} [${fieldsStr}]`,
    '',
    `Proposal: ${proposal.proposalId}`,
    `Source: ${proposal.sourceEvent} (${proposal.sourceId})`,
    `Rationale: ${proposal.rationale}`,
    '',
    `Approved by: ${proposal.approvedBy ?? 'unknown'}`,
    `Applied by distillation pipeline (KD-18).`,
  ].join('\n')

  return {
    ok: true,
    result: { modifiedContent, targetPath: DOSSIER_RELATIVE_PATH, commitMessage },
  }
}

/** Find the start index of the target cat's `### … cat:{catId}` section. -1 if absent. */
function findTargetCatSectionStart(content: string, targetCatId: string): number {
  const pattern = new RegExp(`^###\\s+.*\`cat:${escapeRegExp(targetCatId)}\``, 'm')
  const match = pattern.exec(content)
  return match ? match.index : -1
}

/** Find where the target cat's section ends (next L3 header or EOF). */
function findSectionEnd(content: string, sectionStart: number): number {
  const headerLineEnd = content.indexOf('\n', sectionStart)
  if (headerLineEnd < 0) return content.length
  const afterHeader = content.slice(headerLineEnd + 1)
  const nextL3 = afterHeader.search(/^###\s/m)
  return nextL3 >= 0 ? headerLineEnd + 1 + nextL3 : content.length
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
