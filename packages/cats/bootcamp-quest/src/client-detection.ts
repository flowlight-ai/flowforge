/**
 * F171: 检测用户机器上已安装的 agent CLI 客户端（迁移自 clowder-ai 同名文件）。
 * 仅用 PATH 探测（`where`/`command -v`），绝不 spawn 运行时。探测 seam 可注入以便测试。
 */

import fs from 'node:fs'
import path from 'node:path'

export interface DetectedClient {
  client: 'claude' | 'codex' | 'gemini' | 'opencode' | 'kimi'
  provider: 'anthropic' | 'openai' | 'google' | 'opencode' | 'kimi'
  label: string
  cli: string
  installed: boolean
  version?: string
  hasApiKey: boolean
}

interface CliSpec {
  client: DetectedClient['client']
  provider: DetectedClient['provider']
  label: string
  cli: string
  envKey: string
}

const CLI_SPECS: CliSpec[] = [
  { client: 'claude', provider: 'anthropic', label: 'Claude', cli: 'claude', envKey: 'ANTHROPIC_API_KEY' },
  { client: 'codex', provider: 'openai', label: 'Codex', cli: 'codex', envKey: 'OPENAI_API_KEY' },
  { client: 'opencode', provider: 'opencode', label: 'OpenCode', cli: 'opencode', envKey: 'ANTHROPIC_API_KEY' },
  { client: 'gemini', provider: 'google', label: 'Gemini', cli: 'gemini', envKey: 'GOOGLE_API_KEY' },
  { client: 'kimi', provider: 'kimi', label: 'Kimi', cli: 'kimi', envKey: 'MOONSHOT_API_KEY' },
]

export type ExistsOnPath = (cli: string) => Promise<boolean>

/**
 * PATH 目录直接扫描的轻量 fallback（纯 fs 探测，不 spawn 子进程 —— LL-055）。
 * PATH 探测失败时的兜底：扫遍 PATH 中的目录是否存在可执行文件。
 */
export function resolveCliCommand(cli: string): string | null {
  if (!cli) return null
  const pathVar = process.env.PATH ?? ''
  const dirs = pathVar.split(path.delimiter).filter((d) => d.length > 0)
  const candidates = process.platform === 'win32' ? [cli, `${cli}.exe`, `${cli}.cmd`, `${cli}.bat`] : [cli]

  for (const dir of dirs) {
    for (const name of candidates) {
      const full = path.join(dir, name)
      try {
        if (fs.existsSync(full)) {
          try {
            fs.accessSync(full, fs.constants.X_OK)
            return full
          } catch {
            /* not executable — keep scanning */
          }
        }
      } catch {
        /* ignore inaccessible dir */
      }
    }
  }
  return null
}

function probeBinaryExists(cli: string): boolean {
  return resolveCliCommand(cli) !== null
}

const defaultExistsOnPath: ExistsOnPath = async (cli) => {
  return probeBinaryExists(cli)
}

async function checkCli(spec: CliSpec, existsOnPath: ExistsOnPath): Promise<DetectedClient> {
  let installed = false
  try {
    installed = await existsOnPath(spec.cli)
  } catch {
    installed = false
  }
  return {
    client: spec.client,
    provider: spec.provider,
    label: spec.label,
    cli: spec.cli,
    installed,
    hasApiKey: spec.envKey ? Boolean(process.env[spec.envKey]) : false,
  }
}

export async function detectAvailableClients(deps?: { existsOnPath?: ExistsOnPath }): Promise<DetectedClient[]> {
  const probe = deps?.existsOnPath ?? defaultExistsOnPath
  return Promise.all(CLI_SPECS.map((spec) => checkCli(spec, probe)))
}

export async function getInstalledClients(deps?: { existsOnPath?: ExistsOnPath }): Promise<DetectedClient[]> {
  const all = await detectAvailableClients(deps)
  return all.filter((c) => c.installed)
}

export function getCliSpecsForTest(): readonly CliSpec[] {
  return CLI_SPECS
}