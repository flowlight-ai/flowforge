/**
 * recommendation-matrix-data — 安装推荐矩阵（YAML）加载。
 * Ported from clowder-ai `domains/services/recommendation-matrix-data.ts`（F195）。
 *
 * 适配：矩阵数据从 clowder 仓库 scripts/services/ 随包迁移到
 * packages/cats/services-panel/data/recommendation-matrix.yaml（自包含，构建后同样可达）。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { ServiceMatrix } from './recommendation-types.ts'

// Matrix lives next to install/server scripts in scripts/services/ — see CLAUDE.md
const YAML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../data/recommendation-matrix.yaml')

interface MatrixFile {
  services: ServiceMatrix
}

function loadMatrix(): ServiceMatrix {
  const text = readFileSync(YAML_PATH, 'utf-8')
  const parsed = parse(text) as MatrixFile | null
  if (!parsed || typeof parsed !== 'object' || !parsed.services) {
    throw new Error(`Invalid recommendation matrix at ${YAML_PATH}: missing "services" key`)
  }
  return parsed.services
}

export const SERVICE_MATRIX: ServiceMatrix = loadMatrix()
