/**
 * Shared invariants + constants for `@flowforge/cats-session`.
 *
 * Batch 6.3 ports the clowder-ai session transcript domain (writer/reader)
 * into Cordis services. Thresholds are centralised here (F233 Phase A
 * convention: 集中归置不散落各处).
 *
 * @module @flowforge/cats-session/invariant
 */

/** Transcript 根目录默认值（受 CATS_TRANSCRIPT_DIR 环境变量覆盖）。 */
export const DEFAULT_TRANSCRIPT_DIR = 'data/transcripts'

/** TranscriptWriter：稀疏索引步长（每 N 条事件记录一个字节偏移）。 */
export const TRANSCRIPT_INDEX_STRIDE = 100
