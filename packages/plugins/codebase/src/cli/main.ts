/**
 * @flowforge/plugin-codebase — CLI entry (EP-CB0, T1.9).
 *
 * ff_codebase — codebase intelligence CLI over the knowledge-graph store:
 * index / query / search / schema / status / projects / delete.
 * Exit-code contract aligned with ff_dev/ff_doctor: 0 = ok, 1 = violation
 * (project not found, no results), 2 = usage error.
 *
 * @module @flowforge/plugin-codebase/cli/main
 */

import { resolve } from 'node:path'
import { CodebaseStore } from '../store.ts'
import { indexRepository } from '../indexer.ts'
import { INDEX_MODES } from '../indexer.ts'
import type { IndexMode } from '../indexer.ts'
import { deriveProjectName } from '../project.ts'
import { ProjectNotFoundError, UsageError, indexStatus, schemaFor, searchNodes } from '../query.ts'

const USAGE = `ff_codebase — FlowForge 代码智能 CLI（@flowforge/plugin-codebase）

用法：
  ff_codebase index   --repo <path> [--mode full|moderate|fast] [--name <n>] [--exclude a,b] [--db <path>]
  ff_codebase query   --repo <path> [--label <label>] [--name-pattern <re>] [--file-pattern <re>]
                      [--min-degree <n>] [--max-degree <n>] [--limit <n>] [--offset <n>] [--project <name>]
  ff_codebase search  --repo <path> --query "<bm25 tokens>" [--limit <n>] [--offset <n>] [--project <name>]
  ff_codebase schema  [--repo <path>] [--project <name>] [--db <path>]
  ff_codebase status  [--repo <path>] [--project <name>] [--db <path>]
  ff_codebase projects [--repo <path>] [--db <path>]
  ff_codebase delete  --project <name> [--repo <path>] [--db <path>]

默认 DB：<repo>/.flowforge/codebase.db（gitignore 内）。默认项目名：仓库目录名（安全化）。
退出码：0 = 成功；1 = 项目不存在/无结果；2 = 用法错误。`

interface ParsedArgs {
  readonly command: string
  readonly flags: Map<string, string | boolean>
  readonly positionals: readonly string[]
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = '', ...rest] = argv
  const flags = new Map<string, string | boolean>()
  const positionals: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = rest[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        index += 1
      } else {
        flags.set(key, true)
      }
    } else {
      positionals.push(token)
    }
  }
  return { command, flags, positionals }
}

function flagString(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key)
  return typeof value === 'string' ? value : undefined
}

function flagNumber(flags: Map<string, string | boolean>, key: string): number | undefined {
  const value = flagString(flags, key)
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    process.stderr.write(`ff_codebase: --${key} 需要整数，收到 "${value}"\n`)
    process.exit(2)
  }
  return parsed
}

function dbPathFor(flags: Map<string, string | boolean>, repo: string): string {
  return flagString(flags, 'db') ?? resolve(repo, '.flowforge', 'codebase.db')
}

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function failUsage(message: string): never {
  process.stderr.write(`ff_codebase: ${message}\n\n${USAGE}\n`)
  process.exit(2)
}

function failViolation(message: string): never {
  process.stderr.write(`ff_codebase: ${message}\n`)
  process.exit(1)
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv)
  const repoFlag = flagString(args.flags, 'repo') ?? '.'
  const repo = resolve(repoFlag)

  switch (args.command) {
    case 'index': {
      const mode = (flagString(args.flags, 'mode') ?? 'full') as IndexMode
      if (!INDEX_MODES.includes(mode)) failUsage(`未知索引模式 "${mode}"（full|moderate|fast）`)
      const excludeRaw = flagString(args.flags, 'exclude')
      const exclude = excludeRaw === undefined ? [] : excludeRaw.split(',').map(item => item.trim()).filter(item => item.length > 0)
      const nameFlag = flagString(args.flags, 'name')
      const store = new CodebaseStore(dbPathFor(args.flags, repo))
      try {
        const result = indexRepository({
          repoPath: repo,
          store,
          mode,
          ...(nameFlag === undefined ? {} : { projectName: nameFlag }),
          exclude,
        })
        emit(result)
        return 0
      } finally {
        store.dispose()
      }
    }
    case 'query':
    case 'search': {
      const project = flagString(args.flags, 'project') ?? deriveProjectName(repo)
      const label = flagString(args.flags, 'label')
      const namePattern = flagString(args.flags, 'name-pattern')
      const filePattern = flagString(args.flags, 'file-pattern')
      const minDegree = flagNumber(args.flags, 'min-degree')
      const maxDegree = flagNumber(args.flags, 'max-degree')
      const limit = flagNumber(args.flags, 'limit')
      const offset = flagNumber(args.flags, 'offset')
      return withStore(args.flags, repo, store => {
        const result = searchNodes(store, {
          project,
          ...(args.command === 'search' ? { query: flagString(args.flags, 'query') ?? failUsage('search 需要 --query "<bm25 tokens>"') } : {}),
          ...(label === undefined ? {} : { label }),
          ...(namePattern === undefined ? {} : { namePattern }),
          ...(filePattern === undefined ? {} : { filePattern }),
          ...(minDegree === undefined ? {} : { minDegree }),
          ...(maxDegree === undefined ? {} : { maxDegree }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        })
        if (result.rows.length === 0 && result.total === 0) {
          emit({ ...result, note: '无匹配结果（total=0）' })
          return 0
        }
        emit(result)
        return 0
      })
    }
    case 'schema': {
      const project = flagString(args.flags, 'project') ?? deriveProjectName(repo)
      return withStore(args.flags, repo, store => {
        emit(schemaFor(store, project))
        return 0
      })
    }
    case 'status': {
      const project = flagString(args.flags, 'project')
      return withStore(args.flags, repo, store => {
        const statuses = indexStatus(store, project)
        if (project !== undefined && statuses.length === 0) failViolation(`项目不存在：${project}`)
        emit(statuses)
        return 0
      })
    }
    case 'projects': {
      return withStore(args.flags, repo, store => {
        emit(store.listProjects())
        return 0
      })
    }
    case 'delete': {
      const project = flagString(args.flags, 'project') ?? failUsage('delete 需要 --project <name>')
      return withStore(args.flags, repo, store => {
        if (!store.deleteProject(project)) failViolation(`项目不存在：${project}`)
        emit({ deleted: project })
        return 0
      })
    }
    case 'help':
    case '':
      process.stdout.write(`${USAGE}\n`)
      return 0
    default:
      failUsage(`未知命令 "${args.command}"`)
  }
}

/**
 * Open the store, run `body`, dispose in `finally`, and map query-layer
 * errors onto the CLI exit-code contract (open failures included).
 */
function withStore(flags: Map<string, string | boolean>, repo: string, body: (store: CodebaseStore) => number): number {
  const store = new CodebaseStore(dbPathFor(flags, repo))
  try {
    store.open()
    return body(store)
  } catch (error) {
    return mapQueryError(error)
  } finally {
    store.dispose()
  }
}

function mapQueryError(error: unknown): number {
  if (error instanceof UsageError) {
    process.stderr.write(`ff_codebase: ${error.message}\n`)
    return 2
  }
  if (error instanceof ProjectNotFoundError) {
    process.stderr.write(`ff_codebase: ${error.message}\n`)
    return 1
  }
  if ((error as Error)?.message?.includes('SQLITE_CANTOPEN') === true) {
    failViolation('数据库无法打开（先执行 ff_codebase index 建立索引）')
  }
  throw error
}

if (process.env.FF_CODEBASE_CLI_ENTRY === '1') {
  process.exit(main())
}
