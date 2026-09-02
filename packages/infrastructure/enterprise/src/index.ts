/**
 * @flowforge/infrastructure-enterprise — C33 enterprise 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/enterprise/*`（F162 企业 IM 操作）：
 *   - Lark/Feishu：LarkCliExecutor（lark-cli Go 二进制，{ok,data|error} 信封）
 *     + LarkActionService（docs/base/task/calendar/slides + searchUsers
 *     scope 降级 + GoldenChain），ADR-029 治理边界（审计日志 + 错误归一）
 *   - WeCom（企业微信）：WeComCliExecutor（wecom-cli Rust 二进制，
 *     {errcode,errmsg} + MCP content 包装剥离）+ WeComActionService
 *     （doc/smartsheet/todo/meeting/contact + GoldenChain 四连）
 *
 * 插件化改造：
 *   - clowder FastifyBaseLogger → 注入式 EnterpriseLogger（缺省 console）
 *   - execFile 可注入（ExecFileFn，测试桩友好，缺省 node:child_process）
 *   - lark-cli / wecom-cli 为外部二进制（peer 依赖，运行时按可用性降级）
 *
 * @module @flowforge/infrastructure-enterprise
 */

import { Context, Service } from '@flowforge/cordis';

import { LarkActionService } from './lark-action-service.ts';
import { LarkCliExecutor, type LarkCliExecutorOptions } from './lark-executor.ts';
import { WeComActionService } from './wecom-action-service.ts';
import { WeComCliExecutor, type WeComCliExecutorOptions } from './wecom-executor.ts';

export * from './lark-types.ts';
export * from './wecom-types.ts';
export {
  defaultExecFile,
  isScopeOrPermissionError,
  LarkApiError,
  LarkCliExecutor,
  LarkCliProtocolError,
  LarkCliUnavailableError,
  type EnterpriseLogger,
  type ExecFileFn,
  type LarkFlagValue,
} from './lark-executor.ts';
export { WeComApiError, WeComCliExecutor, WeComCliUnavailableError } from './wecom-executor.ts';
export {
  LarkActionService,
  type CreateDocOpts as LarkCreateDocOpts,
  type CreateBaseOpts,
  type CreateTaskOpts,
  type CreateCalendarEventOpts,
  type CreateSlidesOpts,
  type GoldenChainOpts as LarkGoldenChainOpts,
} from './lark-action-service.ts';
export {
  WeComActionService,
  type CreateDocOpts as WeComCreateDocOpts,
  type CreateSmartTableOpts,
  type CreateTodoOpts,
  type CreateMeetingOpts,
  type GoldenChainOpts as WeComGoldenChainOpts,
} from './wecom-action-service.ts';

export interface EnterpriseLoggerConsole {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface EnterpriseConfig {
  /** 共用 logger（缺省 console）。 */
  log?: EnterpriseLoggerConsole;
  /** CLI 命令超时 ms（缺省 30_000）。 */
  timeoutMs?: number;
  /** 注入式 execFile（测试桩）。 */
  execFileAsync?: LarkCliExecutorOptions['execFileAsync'];
}

declare module '@flowforge/cordis' {
  interface Context {
    /** enterprise 域（C33）：Lark/WeCom 企业操作治理边界 */
    forgeEnterprise: ForgeEnterpriseService;
  }
}

/**
 * enterprise 域服务 — 挂载 `ctx.forgeEnterprise`。
 * 暴露 lark / wecom 两个 ActionService（ADR-029：全部企业动作经此边界）。
 */
export class ForgeEnterpriseService extends Service {
  readonly lark: LarkActionService;
  readonly wecom: WeComActionService;
  private readonly larkExecutor: LarkCliExecutor;
  private readonly wecomExecutor: WeComCliExecutor;

  constructor(ctx: Context, config: EnterpriseConfig = {}) {
    super(ctx, 'forgeEnterprise');
    const log = config.log ?? console;
    const execOpts = {
      log,
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      ...(config.execFileAsync !== undefined ? { execFileAsync: config.execFileAsync } : {}),
    };
    this.larkExecutor = new LarkCliExecutor(execOpts as LarkCliExecutorOptions);
    this.wecomExecutor = new WeComCliExecutor(execOpts as WeComCliExecutorOptions);
    this.lark = new LarkActionService(this.larkExecutor, log);
    this.wecom = new WeComActionService(this.wecomExecutor, log);
  }

  /** lark-cli 可用性（缓存）。 */
  isLarkAvailable(): Promise<boolean> {
    return this.larkExecutor.isAvailable();
  }

  /** wecom-cli 可用性（缓存）。 */
  isWeComAvailable(): Promise<boolean> {
    return this.wecomExecutor.isAvailable();
  }
}

export default ForgeEnterpriseService;
