/**
 * @flowforge/cats-bootcamp — Bootcamp 引导服务（C8 待补项交付）。
 *
 * TS 移植自 clowder-ai `domains/cats/services/bootcamp/*`：
 *   - blocks：F087 预置富交互块（引导猫选择 / 分层任务选择，BOOTCAMP_BLOCKS）
 *   - env-check：node/pnpm/git/CLI/MCP/本地服务端口就绪检查（注入式探测）
 *   - workspace-root：CAT_CAFE_WORKSPACE_ROOT 解析 + 项目路径校验
 *
 * 与既有的 duty-briefing/freshness（批次5 已交付）互补，构成 cats bootcamp
 * 引导服务群。
 *
 * @module @flowforge/cats-bootcamp
 */

import { Context, Service } from '@flowforge/cordis';

import { BOOTCAMP_BLOCKS, type BootcampInteractiveBlock } from './blocks.ts';
import { runEnvironmentCheck, type BootcampEnvCheckDeps, type EnvCheckResult } from './env-check.ts';
import {
  resolveBootcampWorkspaceRoot,
  type BootcampWorkspaceRootResolution,
  type ResolveBootcampWorkspaceRootOptions,
} from './workspace-root.ts';

export {
  BOOTCAMP_BLOCKS,
  catSelectionBlock,
  taskSelectionBlock,
  type BootcampInteractiveBlock,
  type BootcampInteractiveBlockOption,
} from './blocks.ts';
export {
  runEnvironmentCheck,
  type BootcampEnvCheckDeps,
  type CommandProbe,
  type EnvCheckItem,
  type EnvCheckResult,
  type PortProbe,
} from './env-check.ts';
export {
  resolveBootcampWorkspaceRoot,
  resolveDefaultBootcampWorkspaceRoot,
  type BootcampWorkspaceRootResolution,
  type ProjectPathValidator,
  type ResolveBootcampWorkspaceRootOptions,
} from './workspace-root.ts';

declare module '@flowforge/cordis' {
  interface Context {
    /** Bootcamp 引导服务（C8）：交互块 + 环境检查 + 工作区根解析。 */
    catsBootcamp: BootcampService;
  }
}

export interface BootcampServiceOptions {
  envCheckDeps?: BootcampEnvCheckDeps;
  workspaceRootOptions?: ResolveBootcampWorkspaceRootOptions;
}

export class BootcampService extends Service {
  readonly blocks: Readonly<Record<string, BootcampInteractiveBlock>>;
  private readonly envCheckDeps: BootcampEnvCheckDeps;
  private readonly workspaceRootOptions: ResolveBootcampWorkspaceRootOptions;

  constructor(ctx: Context, options: BootcampServiceOptions = {}) {
    super(ctx, 'catsBootcamp');
    this.blocks = BOOTCAMP_BLOCKS;
    this.envCheckDeps = options.envCheckDeps ?? {};
    this.workspaceRootOptions = options.workspaceRootOptions ?? {};
  }

  getBlock(id: string): BootcampInteractiveBlock | undefined {
    return this.blocks[id];
  }

  /** 全部交互块（只读快照）。 */
  listBlocks(): readonly BootcampInteractiveBlock[] {
    return Object.values(this.blocks);
  }

  /** 运行环境检查（注入式探测）。 */
  envCheck(): Promise<EnvCheckResult> {
    return runEnvironmentCheck(this.envCheckDeps);
  }

  /** 解析 bootcamp 工作区根。 */
  workspaceRoot(): Promise<BootcampWorkspaceRootResolution> {
    return resolveBootcampWorkspaceRoot(this.workspaceRootOptions);
  }
}

export default BootcampService;
