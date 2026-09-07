/**
 * @flowforge/plugin-dev — verification evidence (EP0-5 T0.5.1, wired into the
 * `ff_dev evidence` command). The verify→finish hard gate is only satisfied
 * by fresh evidence on disk: command + exit code + output summary + timestamp
 * (verification-before-completion ⑩ evidence standard).
 *
 * @module @flowforge/plugin-dev/evidence
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** One verification record — the atomic unit of finish-gate evidence. */
export interface EvidenceEntry {
  /** ISO timestamp (caller supplies; CLI stamps at invocation). */
  readonly timestamp: string
  /** The exact command that was run (fresh, never cached). */
  readonly command: string
  /** Process exit code; anything non-zero fails the evidence. */
  readonly exitCode: number
  /** Concrete output summary — numbers, not "跑过了" (T3 alignment). */
  readonly summary: string
  /** Optional measured duration in milliseconds (量化耗时规范). */
  readonly durationMs?: number
}

/** Default verification artifact directory inside a repo. */
export function verificationsDir(repoRoot: string): string {
  return join(resolve(repoRoot), 'docs', 'process', 'verifications')
}

/** Render one evidence entry as a markdown block (template-aligned). */
export function formatEvidenceEntry(entry: EvidenceEntry): string {
  const duration =
    entry.durationMs === undefined ? '' : `- **耗时**：${entry.durationMs}ms\n`
  return [
    `### [${entry.timestamp}] ${entry.command}`,
    '',
    `- **命令**：\`${entry.command}\``,
    `- **退出码**：${entry.exitCode}`,
    `- **输出摘要**：${entry.summary}`,
    duration.trimEnd(),
    `- **结论**：${entry.exitCode === 0 ? '通过' : '失败（禁止宣称完成）'}`,
    '',
  ]
    .filter(line => line !== '')
    .join('\n')
}

/** Append an evidence entry to `docs/process/verifications/<name>.md`. */
export function appendEvidence(repoRoot: string, instanceName: string, entry: EvidenceEntry): string {
  const path = join(verificationsDir(repoRoot), `${instanceName}.md`)
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(
      path,
      [
        `# ${instanceName} 验证证据（verification）`,
        '',
        '> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  appendFileSync(path, formatEvidenceEntry(entry), 'utf8')
  return path
}
