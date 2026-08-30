/**
 * @flowforge/infrastructure-commands — C33 commands 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/commands/*`（F142 Phase B）：
 *   - CommandRegistry：启动期聚合 core + skill 命令（内存缓存 AC-B5），
 *     core 命令始终优先于 skill 命令（AC-B2），精确名 + 子命令展开冲突检测
 *   - manifest-commands：解析 skills 源 manifest.yaml，提取经 schema 校验的
 *     slashCommands 声明（非法项静默跳过）
 *
 * 插件化改造：
 *   - clowder 模块单例 → ctx.forgeCommands 服务（coreCommands 注入式配置）
 *   - logger 抽象为 { warn } 接口（缺省 console）
 *
 * @module @flowforge/infrastructure-commands
 */

import { Context, Service } from '@flowforge/cordis';
import type { CommandSurface, SlashCommandDefinition } from '@flowforge/cats-shared';

export interface CommandLogger {
  warn(msg: string): void;
}

/**
 * 统一命令注册表 — 聚合 core + skill 命令。
 * core 命令始终优先；skill 命令与 core 冲突时被拒绝（带告警）。
 */
export class CommandRegistry {
  private readonly commands = new Map<string, SlashCommandDefinition>();

  constructor(coreCommands: readonly SlashCommandDefinition[]) {
    for (const cmd of coreCommands) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /**
   * 登记某 skill 声明的命令。
   * 与已有命令冲突的项被拒绝并告警；子命令展开形式也参与冲突检测。
   */
  registerSkillCommands(
    skillId: string,
    commands: readonly SlashCommandDefinition[],
    log: CommandLogger,
  ): void {
    for (const cmd of commands) {
      const existing = this.commands.get(cmd.name);
      if (existing) {
        const owner = existing.source === 'core' ? 'core command' : `skill "${existing.skillId}"`;
        log.warn(
          `[CommandRegistry] Skill "${skillId}" tried to register "${cmd.name}" but it conflicts with ${owner} — rejected`,
        );
        continue;
      }
      let hasSubConflict = false;
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          const expanded = `${cmd.name} ${sub}`;
          const existingFlat = this.commands.get(expanded);
          if (existingFlat) {
            const owner =
              existingFlat.source === 'core' ? 'core command' : `skill "${existingFlat.skillId}"`;
            log.warn(
              `[CommandRegistry] Skill "${skillId}" subcommand "${expanded}" conflicts with ${owner} — rejected`,
            );
            hasSubConflict = true;
          }
        }
      }
      if (hasSubConflict) continue;
      this.commands.set(cmd.name, { ...cmd, source: 'skill', skillId });
    }
  }

  /** 匹配 surface 或 'both' 的命令。 */
  listBySurface(surface: CommandSurface): SlashCommandDefinition[] {
    return [...this.commands.values()].filter(
      (cmd) => cmd.surface === surface || cmd.surface === 'both',
    );
  }

  getAll(): SlashCommandDefinition[] {
    return [...this.commands.values()];
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  get(name: string): SlashCommandDefinition | undefined {
    return this.commands.get(name);
  }
}

export interface CommandsConfig {
  /** core 命令清单（启动期注入；通常来自 @flowforge/cats-shared CORE_COMMANDS）。 */
  coreCommands: readonly SlashCommandDefinition[];
  /** logger（缺省 console）。 */
  log?: CommandLogger;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** commands 域（C33）：core + skill 命令注册表 */
    forgeCommands: ForgeCommandsService;
  }
}

/**
 * commands 域服务 — 挂载 `ctx.forgeCommands`。
 * 包装 CommandRegistry，提供 registerSkillCommands / listBySurface / get 等。
 */
export class ForgeCommandsService extends Service {
  private readonly registry: CommandRegistry;
  private readonly log: CommandLogger;

  constructor(ctx: Context, config: CommandsConfig) {
    super(ctx, 'forgeCommands');
    this.registry = new CommandRegistry(config.coreCommands);
    this.log = config.log ?? console;
  }

  get coreCommandCount(): number {
    return this.registry.getAll().filter((c) => c.source === 'core').length;
  }

  registerSkillCommands(skillId: string, commands: readonly SlashCommandDefinition[]): void {
    this.registry.registerSkillCommands(skillId, commands, this.log);
  }

  listBySurface(surface: CommandSurface): SlashCommandDefinition[] {
    return this.registry.listBySurface(surface);
  }

  getAll(): SlashCommandDefinition[] {
    return this.registry.getAll();
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  get(name: string): SlashCommandDefinition | undefined {
    return this.registry.get(name);
  }
}

export default ForgeCommandsService;

export { parseManifestSlashCommands } from './manifest-commands.ts';
export type { ManifestSlashCommand } from '@flowforge/cats-shared';
