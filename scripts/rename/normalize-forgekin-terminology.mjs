/**
 * T8.3c 命名合规整改（一次性工具，幂等）—— 仅替换注释行中的 P2 别名与
 * clowder 品牌词为命名契约 P0 术语；标识符、API 路径、字段名一律不动。
 * 括号别名位（"…（灵智体）"）保留。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'web/src'
const COMMENT_PREFIX = /^\s*(\/\/|\/\*|\*|\{\/\*)/u

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx)$/u.test(entry)) out.push(path)
  }
  return out
}

function normalize(text) {
  return text
    .replace(/(?<!（)灵智体(?!）)/gu, '可进化智能体')
    .replace(/猫猫/gu, '可进化智能体')
}

let changed = 0
let hits = 0
for (const path of walk(ROOT)) {
  const before = readFileSync(path, 'utf8')
  const lines = before.split('\n')
  let fileHits = 0
  const after = lines.map(line => {
    if (!COMMENT_PREFIX.test(line)) return line
    const next = normalize(line)
    if (next !== line) fileHits += 1
    return next
  })
  if (fileHits > 0) {
    writeFileSync(path, after.join('\n'))
    changed += 1
    hits += fileHits
    console.log(`updated ${path} (${fileHits})`)
  }
}
console.log(`files changed: ${changed}, lines changed: ${hits}`)
