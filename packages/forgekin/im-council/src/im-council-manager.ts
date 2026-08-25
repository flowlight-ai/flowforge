/**
 * @flowforge/forgekin-im-council — T7.16 IMCouncilManager（F047 §2.4 完整实现）。
 *
 * TS 重写自 `core/im_council.py` 的 IMCouncilManager：
 *   - 注册 / 注销通道适配器（DI 注入，红线 12）
 *   - 自动通道选择 + I1 降级链路（console > trae > webchat）
 *   - 五步 MindCouncil 流程（发起→收集→综合→决策→归档）
 *   - I3 强制：requestApproval 为审批的唯一公开入口
 *   - I4 超时自动拒绝（timeout 未回复 → decide(rejected, "timeout")）
 *   - I5 归档落盘 JSONL（I2 append-only，不可原地修改）
 *
 * 依赖注入：approvalHub（CL-033 ApprovalHub 实例）+ config + archiveWriter
 * （测试可注入内存 writer；缺省写 ${archivePath}/{YYYY-MM-DD}.jsonl）。
 *
 * @module @flowforge/forgekin-im-council
 */

import type {
  ApprovalHub,
  ApprovalRequest,
} from '@flowforge/forgekin-evolution-engine/approval-hub';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { IMCouncilChannel } from './channel.js';
import {
  newCouncilMessage,
  type CouncilMessage,
  type CouncilReply,
} from './models.js';

/** 所有通道不可用时抛出（I1 降级链路穷尽）。 */
export class NoAvailableChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAvailableChannelError';
  }
}

/** IM 议事配置（对齐 im_council.yaml 的 approval/archive 段，铁律 5 参数外置）。 */
export interface IMCouncilConfig {
  /** 默认通道名（"auto" 时启用 I1 降级链路）。 */
  readonly defaultChannel?: string | undefined;
  readonly approval?: {
    /** 默认审批超时秒数（缺省 300）。 */
    readonly timeoutSeconds?: number | undefined;
    /** 超时是否自动拒绝（缺省 true）。 */
    readonly autoRejectOnTimeout?: boolean | undefined;
  } | undefined;
  readonly archive?: {
    /** 是否启用归档（缺省 true）。 */
    readonly enabled?: boolean | undefined;
    /** 归档目录路径（缺省 data/im_council/archive；支持 ${ENV_VAR:default}）。 */
    readonly path?: string | undefined;
  } | undefined;
}

/** 归档 writer 注入点（红线 12；测试注入内存实现）。 */
export interface ArchiveWriter {
  /** 追加一条议事记录（调用方保证单行 JSON + 换行）。 */
  appendLine(line: string): Promise<void>;
}

/** 展开字符串中的 ${ENV_VAR} 或 ${ENV_VAR:default} 占位符（红线 11）。 */
export function expandEnv(value: string): string {
  if (!value || !value.includes('${')) return value;
  let result = value;
  while (result.includes('${') && result.includes('}')) {
    const start = result.indexOf('${');
    const end = result.indexOf('}', start);
    const token = result.slice(start + 2, end);
    const sep = token.indexOf(':');
    const envKey = sep >= 0 ? token.slice(0, sep) : token;
    const fallback = sep >= 0 ? token.slice(sep + 1) : '';
    const envVal = process.env[envKey] ?? fallback;
    result = result.slice(0, start) + envVal + result.slice(end + 1);
  }
  return result;
}

/** 文件系统 JSONL 归档 writer（I2 append-only：'a' 模式禁止覆盖）。 */
export class FileArchiveWriter implements ArchiveWriter {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async appendLine(line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await appendFile(file, `${line}\n`, 'utf-8');
  }
}

/** 归档配置解析（缺省路径展开环境变量，红线 11）。 */
export function resolveArchivePath(raw: string | undefined): string {
  return expandEnv(raw ?? 'data/im_council/archive');
}

/** IMCouncilManager 构造选项（approvalHub 必填，其余可选）。 */
export interface IMCouncilManagerOptions {
  approvalHub: ApprovalHub;
  config?: IMCouncilConfig | undefined;
  /** 归档 writer（缺省 FileArchiveWriter，archive.enabled=false 时 null）。 */
  archiveWriter?: ArchiveWriter | null | undefined;
}

/** 构造后全量解析的议事配置（嵌套字段必填，消除 undefined 分支）。 */
interface ResolvedIMCouncilConfig {
  defaultChannel: string;
  approval: { timeoutSeconds: number; autoRejectOnTimeout: boolean };
  archive: { enabled: boolean; path: string };
}

/**
 * IM 议事管理器 — 统一管理多通道 + 集成 ApprovalHub（F047 §2.4）。
 *
 * 不变量（F047 §2.5）：
 * - I1 通道故障降级（console > trae > webchat）
 * - I2 议事不可篡改（归档 append-only，禁止原地修改）
 * - I3 operator 决策必经（requestApproval 为唯一公开入口）
 * - I4 超时自动拒绝（timeout 秒未回复 → decide(rejected, "timeout")）
 * - I5 议事记录归档（每次流程落盘 JSONL）
 */
export class IMCouncilManager {
  /** I1 降级链路优先级（console > trae > webchat）。 */
  static readonly CHANNEL_PRIORITY = ['console', 'trae', 'webchat'] as const;

  private readonly approvalHub: ApprovalHub;
  private readonly config: ResolvedIMCouncilConfig;
  private readonly channels = new Map<string, IMCouncilChannel>();
  private readonly archiveWriter: ArchiveWriter | null;

  constructor(options: IMCouncilManagerOptions) {
    this.approvalHub = options.approvalHub;
    const cfg = options.config ?? {};
    this.config = {
      defaultChannel: cfg.defaultChannel ?? 'auto',
      approval: {
        timeoutSeconds: cfg.approval?.timeoutSeconds ?? 300,
        autoRejectOnTimeout: cfg.approval?.autoRejectOnTimeout ?? true,
      },
      archive: {
        enabled: cfg.archive?.enabled ?? true,
        path: resolveArchivePath(cfg.archive?.path),
      },
    };
    if (!this.config.archive.enabled) {
      this.archiveWriter = null;
    } else {
      this.archiveWriter =
        options.archiveWriter ?? new FileArchiveWriter(this.config.archive.path);
    }
  }

  // ----- 通道注册 -----

  /** 注册通道（DI 注入，红线 12）；重复或 channelName 不匹配时抛 Error。 */
  registerChannel(name: string, channel: IMCouncilChannel): void {
    if (this.channels.has(name)) {
      throw new Error(`通道已注册: ${name}`);
    }
    if (channel.channelName !== name) {
      throw new Error(
        `通道名不匹配: register name=${name} but channel.channelName=${channel.channelName}`,
      );
    }
    this.channels.set(name, channel);
  }

  /** 注销通道，返回被移除的通道实例（不存在时返回 null）。 */
  unregisterChannel(name: string): IMCouncilChannel | null {
    const channel = this.channels.get(name);
    if (channel !== undefined) {
      this.channels.delete(name);
    }
    return channel ?? null;
  }

  /** 列出所有已注册通道名。 */
  listChannels(): string[] {
    return [...this.channels.keys()];
  }

  // ----- 发送消息 -----

  /** 发送消息给 operator（auto 时按 I1 降级链路选择通道）。 */
  async sendToOperator(message: CouncilMessage, channelName = 'auto'): Promise<string> {
    if (channelName !== 'auto') {
      const channel = this.channels.get(channelName);
      if (channel !== undefined) {
        try {
          // 回写实际通道名（对齐 Python message.channel = channel_name）
          message.channel = channelName;
          return await channel.send(message);
        } catch {
          // 指定通道发送失败 → 降级到 auto（I1）
        }
      }
    }
    return this.sendWithFallback(message);
  }

  /** I1 降级链路：按 CHANNEL_PRIORITY 顺序尝试，全部失败时抛 NoAvailableChannelError。 */
  async sendWithFallback(message: CouncilMessage): Promise<string> {
    let lastError: unknown = null;
    for (const name of IMCouncilManager.CHANNEL_PRIORITY) {
      const channel = this.channels.get(name);
      if (channel === undefined) continue;
      try {
        // 回写实际通道名（对齐 Python message.channel = name）
        message.channel = name;
        return await channel.send(message);
      } catch (exc) {
        lastError = exc;
      }
    }
    throw new NoAvailableChannelError(
      `所有通道不可用（已尝试 ${IMCouncilManager.CHANNEL_PRIORITY.join(',')}），` +
        `最后错误: ${String(lastError)}`,
    );
  }

  // ----- 完整审批流程（I3 强制入口 + I4 超时 + I5 归档）-----

  /**
   * 发起审批请求 → 推送 → 等待回复 → 调用 ApprovalHub.decide → 归档。
   *
   * 五步 MindCouncil 流程（F047 §2.3）：
   * 1. 发起：构造 CouncilMessage 并提交到 ApprovalHub
   * 2. 收集：通过选定通道推送 message
   * 3. 综合：等待 operator 回复 CouncilReply
   * 4. 决策：调用 ApprovalHub.decide 落地决策
   * 5. 归档：落盘 JSONL（I5 不变量）
   *
   * @returns true = approved，false = rejected / timeout / 通道异常
   */
  async requestApproval(
    request: ApprovalRequest,
    timeout?: number,
  ): Promise<boolean> {
    // I3 强制：requestApproval 为唯一公开入口
    const actualTimeout = timeout ?? this.config.approval.timeoutSeconds;

    // Step 1: 提交到 ApprovalHub（不调用 decide，仅 submit）
    this.approvalHub.submit(request);

    // 构造 CouncilMessage
    const message = newCouncilMessage({
      channel: 'auto', // 实际通道由 sendToOperator 设置
      forgekinId: request.forgekinId,
      content: `[${request.requestType}] ${request.title}\n${request.description}`,
      messageType: 'approval_request',
      payload: {
        request_id: request.requestId,
        request_type: request.requestType,
        title: request.title,
        description: request.description,
        priority: request.priority,
        expires_at: request.expiresAt,
        ...request.payload,
      },
    });

    // Step 2: 推送给 operator（I1 降级链路）
    let msgId: string;
    try {
      msgId = await this.sendToOperator(message, 'auto');
    } catch {
      // I4 兜底：通道全失败时按超时拒绝处理
      await this.handleNoChannel(request, message);
      return false;
    }

    // Step 3: 等待回复（I4 超时控制）
    const selected = this.channels.get(message.channel);
    if (selected === undefined) {
      await this.handleNoChannel(request, message);
      return false;
    }
    const reply = await selected.wait_reply(msgId, actualTimeout);

    // Step 4: 决策（I3 必经 ApprovalHub.decide）
    let decision: {
      requestId: string;
      decision: 'approved' | 'rejected';
      decidedBy: string;
      comments: string;
    };
    if (reply === null) {
      // I4 超时自动拒绝
      if (this.config.approval.autoRejectOnTimeout) {
        decision = {
          requestId: request.requestId,
          decision: 'rejected',
          decidedBy: 'system:timeout',
          comments: `timeout after ${actualTimeout}s via ${message.channel}`,
        };
        this.approvalHub.decide(decision);
      } else {
        await this.archiveRecord(message, null, null);
        return false;
      }
    } else {
      // 解析 operator 决策（未识别默认 rejected，保守策略 I3）
      const decisionStr = parseDecision(reply.content);
      decision = {
        requestId: request.requestId,
        decision: decisionStr,
        decidedBy: reply.replier,
        comments: reply.content,
      };
      const { ok } = this.approvalHub.decide(decision);
      if (!ok) {
        await this.archiveRecord(message, reply, null);
        return false;
      }
    }

    // Step 5: 归档（I5 不变量）
    await this.archiveRecord(message, reply, decision);

    return decision.decision === 'approved';
  }

  // ----- 归档（I2 append-only + I5 落盘）-----

  /** 归档一条完整议事记录到 JSONL（I2 append-only + I5 落盘）。 */
  async archiveRecord(
    message: CouncilMessage,
    reply: CouncilReply | null,
    decision: { decision: string; decidedBy: string; comments: string } | null,
  ): Promise<void> {
    if (this.archiveWriter === null) return;
    const record = {
      archived_at: new Date().toISOString(),
      message,
      reply,
      decision,
    };
    try {
      await this.archiveWriter.appendLine(JSON.stringify(record));
    } catch {
      // 归档失败不阻断审批主流程（对齐 Python OSError 捕获语义）
    }
  }

  // ----- 异常处理 -----

  /** 所有通道不可用时的兜底处理（I4 类似策略：标记为系统拒绝）。 */
  async handleNoChannel(
    request: ApprovalRequest,
    message: CouncilMessage,
  ): Promise<void> {
    if (this.config.approval.autoRejectOnTimeout) {
      const decision = {
        requestId: request.requestId,
        decision: 'rejected' as const,
        decidedBy: 'system:no_channel',
        comments: '所有 IM 通道不可用（I1 降级链路穷尽）',
      };
      this.approvalHub.decide(decision);
      await this.archiveRecord(message, null, decision);
    } else {
      await this.archiveRecord(message, null, null);
    }
  }
}

/**
 * 解析 operator 输入为 "approved" / "rejected"（未识别默认拒绝，I3 保守策略）。
 * 对齐 Python ConsoleChannel._parse_decision 静态语义，供跨通道复用。
 */
export function parseDecision(raw: string): 'approved' | 'rejected' {
  const text = raw.trim().toLowerCase();
  if (['approve', 'approved', 'yes', 'y', 'ok', '同意', '批准'].includes(text)) {
    return 'approved';
  }
  if (['reject', 'rejected', 'no', 'n', '拒绝', '驳回'].includes(text)) {
    return 'rejected';
  }
  return 'rejected';
}
