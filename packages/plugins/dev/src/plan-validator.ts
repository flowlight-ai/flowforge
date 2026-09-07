/**
 * @flowforge/plugin-dev — No-Placeholder plan validator (EP0-2).
 *
 * Enforces the writing-plans (②) iron law: every step must carry the real
 * content an executor needs. Blocks the `plan → implement` transition when a
 * plan contains placeholders, lazy references, or tasks without code/test
 * steps. Backs the `ff_doctor plan` command (T0.4.1) and the state-machine
 * gate (planValidated).
 *
 * @module @flowforge/plugin-dev/plan-validator
 */

/** One validation finding, tied to a 1-based line number. */
export interface PlanIssue {
  readonly line: number
  readonly severity: 'error' | 'warning'
  readonly code:
    | 'PLACEHOLDER'
    | 'LAZY_REFERENCE'
    | 'MISSING_HEADER'
    | 'NO_TASKS'
    | 'TASK_NO_STEPS'
    | 'TASK_NO_CODE'
    | 'TASK_NO_TEST'
  readonly message: string
}

/** Aggregate result of {@link validatePlan}. */
export interface PlanValidationResult {
  readonly passed: boolean
  readonly errors: readonly PlanIssue[]
  readonly warnings: readonly PlanIssue[]
  readonly taskCount: number
}

/** Placeholder tokens that make a step unexecutable. */
const PLACEHOLDER_PATTERNS: ReadonlyArray<{ pattern: RegExp; token: string }> = [
  { pattern: /\bTBD\b/, token: 'TBD' },
  { pattern: /\bTODO\b/, token: 'TODO' },
  { pattern: /待补充|待完善|待填写|待确定|待定\b/, token: '待补充类' },
  { pattern: /以后实现|后续补充|稍后补充|回头再/, token: '以后实现' },
  { pattern: /细节略|此处略|内容略|过程略/, token: '细节略' },
  { pattern: /加上适当的|适当的错误处理|处理边界情况(?![：:])/, token: '加适当的错误处理（无具体内容）' },
]

/** Lazy references that force the executor to guess or read out of order. */
const LAZY_REFERENCE_PATTERNS: ReadonlyArray<{ pattern: RegExp; token: string }> = [
  { pattern: /类似任务\s*\d+|同任务\s*\d+/, token: '类似任务 N' },
  { pattern: /同上(述)?(?![一-龥A-Za-z])/, token: '同上' },
  { pattern: /(实现)?与(上述|之前)(任务|步骤)相同/, token: '与之前任务相同' },
  { pattern: /为(上述|以上)(代码|内容)编写?测试|为上述写测试/, token: '为上述写测试' },
]

/** Required plan-header sections (writing-plans 第 4 步 任务结构). */
const REQUIRED_HEADERS: ReadonlyArray<{ section: RegExp; label: string }> = [
  { section: /\*\*目标\*\*|##\s*目标\s*\(|Goal\s*[（(）)]/u, label: '目标（Goal）' },
  { section: /\*\*架构\*\*|##\s*架构\s*\(|Architecture\s*[（(）)]/u, label: '架构（Architecture）' },
  { section: /\*\*技术栈\*\*|##\s*技术栈|Tech Stack/u, label: '技术栈（Tech Stack）' },
  { section: /\*\*规格\*\*|规格（|Spec 引用|##\s*规格/u, label: '规格引用（Spec）' },
  { section: /##\s*全局约束|Global Constraints/u, label: '全局约束（Global Constraints）' },
]

const TASK_HEADING = /^#{2,4}\s*(任务|Task)\s*[\dN]+[：:）)\s]/u
const CHECKBOX_STEP = /^\s*[-*]\s*\[[ xX]\]\s*\*?\*?步骤|^#{2,4}\s*(?:步骤|Steps)\b/mu
const TEST_HINT = /tests?\/|\.spec\.|\.test\.|写失败测试|失败测试|确认失败|测试通过|测试确认/u
const FENCE = /^```/

interface TaskSpan {
  readonly headingLine: number
  readonly text: string
}

/** Split markdown into (line-numbered) code fences and prose. */
function splitFences(
  lines: readonly string[],
): { prose: Array<{ line: number; text: string }>; fenceCount: number } {
  const prose: Array<{ line: number; text: string }> = []
  let inFence = false
  let fenceCount = 0
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? ''
    if (FENCE.test(text.trim())) {
      if (!inFence) fenceCount += 1
      inFence = !inFence
      continue
    }
    if (!inFence) prose.push({ line: index + 1, text })
  }
  return { prose, fenceCount }
}

/** Locate `### 任务 N` sections (heading line to next same-or-higher heading). */
function findTaskSpans(lines: readonly string[]): TaskSpan[] {
  const spans: TaskSpan[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (TASK_HEADING.test(lines[index] ?? '')) {
      const buffer: string[] = []
      for (let cursor = index; cursor < lines.length; cursor += 1) {
        const line = lines[cursor] ?? ''
        if (cursor > index && /^#{1,3}\s/.test(line)) break
        buffer.push(line)
      }
      spans.push({ headingLine: index + 1, text: buffer.join('\n') })
    }
  }
  return spans
}

function lineOfFirstMatch(
  entries: ReadonlyArray<{ line: number; text: string }>,
  pattern: RegExp,
): number | undefined {
  for (const entry of entries) {
    if (pattern.test(entry.text)) return entry.line
  }
  return undefined
}

/**
 * Validate a plan document against the No-Placeholders iron law.
 *
 * @param markdown full plan file content (UTF-8).
 * @param options.fastpass hotfix 快速模式：跳过任务级代码/测试步骤校验（门禁仍需根因记录）。
 */
export function validatePlan(
  markdown: string,
  options: { fastpass?: boolean } = {},
): PlanValidationResult {
  const lines = markdown.split(/\r?\n/)
  const { prose } = splitFences(lines)
  const errors: PlanIssue[] = []
  const warnings: PlanIssue[] = []

  // 1. Placeholder scan — prose only, so legitimate code samples keep working.
  for (const { pattern, token } of PLACEHOLDER_PATTERNS) {
    const line = lineOfFirstMatch(prose, pattern)
    if (line !== undefined) {
      errors.push({
        line,
        severity: 'error',
        code: 'PLACEHOLDER',
        message: `占位符 "${token}"（第 ${line} 行）：步骤必须包含执行者需要的真实内容`,
      })
    }
  }

  // 2. Lazy references — "同任务 N" forces out-of-order reads.
  for (const { pattern, token } of LAZY_REFERENCE_PATTERNS) {
    const line = lineOfFirstMatch(prose, pattern)
    if (line !== undefined) {
      errors.push({
        line,
        severity: 'error',
        code: 'LAZY_REFERENCE',
        message: `惰性引用 "${token}"（第 ${line} 行）：必须重复代码，执行者可能乱序读任务`,
      })
    }
  }

  // 3. Plan header five essentials.
  const wholeText = lines.join('\n')
  for (const { section, label } of REQUIRED_HEADERS) {
    if (!section.test(wholeText)) {
      errors.push({
        line: 1,
        severity: 'error',
        code: 'MISSING_HEADER',
        message: `任务头缺少必备节：${label}（writing-plans 第 4 步）`,
      })
    }
  }

  // 4. Task structure.
  const tasks = findTaskSpans(lines)
  if (tasks.length === 0) {
    errors.push({
      line: 1,
      severity: 'error',
      code: 'NO_TASKS',
      message: '未找到任何 "### 任务 N" 小节：计划必须切分为可独立测试的任务',
    })
  }
  for (const task of tasks) {
    if (!CHECKBOX_STEP.test(task.text)) {
      errors.push({
        line: task.headingLine,
        severity: 'error',
        code: 'TASK_NO_STEPS',
        message: `任务（第 ${task.headingLine} 行）缺少 checkbox 步骤（- [ ] 步骤 N）`,
      })
    }
    if (!options.fastpass) {
      const taskFences = (task.text.match(/^```/gm) ?? []).length / 2
      if (taskFences < 1) {
        errors.push({
          line: task.headingLine,
          severity: 'error',
          code: 'TASK_NO_CODE',
          message: `任务（第 ${task.headingLine} 行）无任何代码块：代码步骤必须带代码`,
        })
      }
      if (!TEST_HINT.test(task.text)) {
        errors.push({
          line: task.headingLine,
          severity: 'error',
          code: 'TASK_NO_TEST',
          message: `任务（第 ${task.headingLine} 行）无测试步骤或测试文件：plan→implement 门禁校验项`,
        })
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    taskCount: tasks.length,
  }
}
