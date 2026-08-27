/**
 * @flowforge/cats-ball-custody — F005/F006 + C24 数据模型
 *
 * TS 移植自 `docs/features/F005-ball-custody-lease.md` + `F006-push-back-protocol.md`，
 * 球状态机事件类型参考 clowder-ai `packages/shared/src/types/ball-custody.ts`。
 * 编码"球权托管"的结构化契约：
 *   - CustodyLease：球权租约（F005，TTL 安全网 + now_fn 注入）
 *   - PushBack：推回记录（F006，三要素强制 + 显式 resolve）
 *   - BallCustodyEvent / BallCustodyProjection：球状态机事件流（C24，8 状态 × 17 事件）
 *
 * @module @flowforge/cats-ball-custody/models
 */

// ── F005 球权租约 ─────────────────────────────────────────────────

/** 租约到期时间（Unix epoch ms；now_fn 注入保证测试确定性，F005 INV-5） */
export type NowFn = () => number;

/** 结构化球权租约（禁裸字符串表示球权，F005 §2.1） */
export interface CustodyLease {
  /** `lease-{10hex}` 自动生成（F005 AC-A1） */
  readonly lease_id: string;
  /** 被持有的球（thread/task 等协作单位标识） */
  readonly ball_id: string;
  /** 当前持球者 */
  readonly owner: string;
  /** 到期时刻（epoch ms） */
  readonly expires_at: number;
}

// ── F006 推回协议 ─────────────────────────────────────────────────

/** 结构化推回记录（F006 §2.1，8 字段） */
export interface PushBack {
  /** 发起推回者（typically author） */
  from_owner: string;
  /** 被推回者（typically reviewer） */
  to_owner: string;
  /** 适用性论证——为什么原请求/review 意见是错的 */
  reason: string;
  /** 支撑推回的 anchor（commit sha / trace id / 测试报告路径，T2 铁律） */
  evidence: readonly string[];
  /** 创建时刻（epoch ms，UTC） */
  created_at: number;
  /** 是否已显式 resolve（默认 False，禁自动关闭，F006 INV-2） */
  resolved: boolean;
  /** 解决文本（accept / reject / escalate，自由文本） */
  resolution: string;
  /** `pb-{10hex}` 自动生成（F006 AC-A6） */
  readonly push_back_id: string;
}

// ── C24 球状态机事件流（clowder-ai shared/ball-custody）────────────

/** 全部 17 种球权事件（每种在转移表必有一行——INV-10 穷举钉死） */
export type BallEventKind =
  | 'ball.handed' // 行首 @ 路由投递给某猫
  | 'ball.handed_cvo' // @co-creator（intent 三态：handoff/fyi/done_notify）
  | 'ball.void_pass' // 虚空传球：说传了但无系统动作
  | 'ball.held' // hold_ball 设（fireAt 到期判据）
  | 'ball.hold_expired' // hold fireAt 已过
  | 'invocation.started' // 持有者起 invocation
  | 'invocation.heartbeat' // draft 更新（真心跳）
  | 'invocation.died' // error / spend-limit / timeout
  | 'task.blocked' // task 进入 blocked（→ blocked 状态）
  | 'task.unblocked' // 阻塞解除
  | 'task.idle_long' // blocked 长期无活动（→ zombie）
  | 'task.done' // task 完成（→ resolved，唯一正常终结）
  | 'ball.wake_sent' // informational：唤醒已发，更新 lastWakeAt，不改 state
  | 'ball.wake_condition_met' // wakeWhen 命令完成 → 带结果唤醒
  // ── Phase C 安乐死（三独立 kind 共享转移行为）──
  | 'ball.frozen' // 冷冻：暂停推进
  | 'ball.degraded' // 降级：明确降优先级
  | 'ball.abandoned'; // 放弃：终态"不做了"

export type BallEventClassification = 'state-changing' | 'informational';

/** 球权事件（append-only、幂等去重 sourceEventId） */
export interface BallCustodyEvent {
  /** 幂等 / 去重键（route:{messageId} / hold:... / inv:... / task:... 等） */
  readonly sourceEventId: string;
  /** 派生标识（不新建球 ID 原语）：`ball:thread:{threadId}` | `ball:task:{taskId}` */
  readonly subjectKey: string;
  readonly kind: BallEventKind;
  readonly classification: BallEventClassification;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Unix timestamp (ms) */
  readonly at: number;
}

/** 球状态（全 8 态） */
export type BallState =
  | 'new' // 初始态（transient，首事件即转走）
  | 'active' // 正常推进（含 hold 持球等外部，heldUntil 可选）
  | 'blocked' // task 阻塞等 probe
  | 'parked' // 搁置：handoff 给 operator
  | 'dead' // 死球：invocation 死 / hold 过期，无心跳
  | 'void' // 虚空传球
  | 'zombie' // 僵尸：长期无活动放弃
  | 'resolved'; // 终态：task.done / 安乐死

/** operator handoff 意图（ball.handed_cvo payload.intent） */
export type BallIntent = 'handoff' | 'fyi' | 'done_notify';

/** blocked task 的 on-resolve 二态 */
export type BallResolveMode = 'completes' | 'bounces_back';

/** Phase C 安乐死 kind（语义独立但共享转移行为） */
export type BallEuthanasiaKind = 'frozen' | 'degraded' | 'abandoned';

/** 球权投影（rebuildable read model，事件纯投影） */
export interface BallCustodyProjection {
  readonly subjectKey: string;
  state: BallState;
  /** 当前持球 catId，或 'cvo' */
  holder: string | null;
  /** 仅 holder='cvo' 有意义 */
  intent: BallIntent | null;
  /** 仅 blocked 球有意义 */
  resolveMode: BallResolveMode | null;
  /** hold 球 fireAt（ball.held 设 / ball.hold_expired 判据）；非 hold 球 null */
  heldUntil: number | null;
  /** 当前 blocked episode 起点（task.blocked 的 at，去重锚） */
  blockedSinceAt: number | null;
  /** 最近唤醒时刻（task.blocked 新 episode 清空，ball.wake_sent 更新） */
  lastWakeAt: number | null;
  /** invocation.died 记录的死前最后心跳点 */
  lastScanAt: number | null;
  /** 状态变更时刻（ageMs = now - lastStateChangeAt） */
  lastStateChangeAt: number;
  lastEventAt: number;
  /** 消费事件数（rebuild 一致性校验） */
  appliedEventCount: number;
  /** 最后被 state machine reject 的事件（observability，不改 state） */
  lastRejectedEvent: BallCustodyEvent | null;
  createdAt: number;
  updatedAt: number;
}

/** 校验 ball_id / owner 非空（F005 AC-A4，TeamActError 语义） */
export function assertNonEmpty(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new BallCustodyError(`${field} 不能为空——球权租约必须有明确的球与持球者。`);
  }
}

/** 校验 TTL 正数（F005 AC-A4，TeamActError 语义） */
export function assertPositiveTtl(ttlSeconds: number): void {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new BallCustodyError(`ttl_seconds 必须为正数，got: ${ttlSeconds}——TTL 是安全网，必须可过期。`);
  }
}

/**
 * 球权域错误（对齐 Python `TeamActError` 语义：结构化失败而非裸断言）。
 *
 * 双持球防护 / 推回三要素强制 / 未知 id 等协议层违规统一抛此错误，
 * 调用方按 `instanceof BallCustodyError` 捕获即可区分协议错误与程序错误。
 */
export class BallCustodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BallCustodyError';
  }
}

