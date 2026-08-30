/**
 * F070: Governance Preflight Gate
 *
 * Checks if an external project is ready for cat dispatch.
 * Returns actionable state (needsBootstrap / needsConfirmation)
 * so the caller can surface instructions instead of silently blocking.
 * Fixes: clowder-ai#123 (preflight blocks new projects without guidance)
 *
 * 移植自 clowder-ai `config/governance/governance-preflight.ts`。
 * 改造：isSameProject 原依赖 monorepo-root（git commondir 探测），
 * 这里内联为 resolve + win32 大小写不敏感比较。
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Provider } from './governance-pack.ts';
import { MANAGED_BLOCK_START } from './governance-pack.ts';
import { GovernanceRegistry, pathsEqual } from './governance-registry.ts';

export interface PreflightResult {
  ready: boolean;
  reason?: string;
  needsBootstrap?: boolean;
  needsConfirmation?: boolean;
  bootstrapCommand?: string;
}

const CAT_PROVIDER_MAP: Record<string, Provider> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
  kimi: 'kimi',
};

const PROVIDER_CONFIG_FILE: Record<Provider, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
  kimi: 'KIMI.md',
};

/** 简化版同一项目判定（resolve + win32 大小写不敏感）。 */
function isSameProject(pathA: string, pathB: string): boolean {
  return pathsEqual(resolve(pathA), resolve(pathB));
}

export async function checkGovernancePreflight(
  projectPath: string,
  hubRoot: string,
  catProvider?: string,
): Promise<PreflightResult> {
  if (isSameProject(projectPath, hubRoot)) {
    return { ready: true };
  }

  const registry = new GovernanceRegistry(hubRoot);
  const entry = await registry.get(projectPath);

  if (!entry) {
    return {
      ready: false,
      needsBootstrap: true,
      reason: `Governance not bootstrapped for ${projectPath}. Bootstrap it via ctx.forgeGovernance.bootstrap(projectPath).`,
      bootstrapCommand: `forgeGovernance.bootstrap("${projectPath}")`,
    };
  }

  if (!entry.confirmedByUser) {
    return {
      ready: false,
      needsConfirmation: true,
      reason: `Governance bootstrap pending confirmation for ${projectPath}.`,
      bootstrapCommand: `forgeGovernance.bootstrap("${projectPath}")`,
    };
  }

  const govProvider = catProvider ? CAT_PROVIDER_MAP[catProvider] : undefined;
  const configFile = govProvider ? PROVIDER_CONFIG_FILE[govProvider] : 'CLAUDE.md';

  try {
    const content = await readFile(join(projectPath, configFile), 'utf-8');
    if (!content.includes(MANAGED_BLOCK_START)) {
      return {
        ready: false,
        needsBootstrap: true,
        reason: `${configFile} missing governance managed block in ${projectPath}.`,
        bootstrapCommand: `forgeGovernance.bootstrap("${projectPath}")`,
      };
    }
  } catch {
    return {
      ready: false,
      needsBootstrap: true,
      reason: `${configFile} not found in ${projectPath}. Governance bootstrap may have failed.`,
      bootstrapCommand: `forgeGovernance.bootstrap("${projectPath}")`,
    };
  }

  // Skills check removed: skill deployment (symlinks) is a separate concern
  // handled by drift detection (F228). When all skills are globally disabled,
  // governance bootstrap legitimately creates zero symlinks — that is NOT a
  // governance failure. The old check caused false governance_blocked when
  // F228 changed the symlink layout or when no skills were enabled.
  return { ready: true };
}
