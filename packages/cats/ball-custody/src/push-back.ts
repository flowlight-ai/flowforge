/**
 * @flowforge/cats-ball-custody — F006 PushBackProtocol（推回协议）
 *
 * TS 全量重写自 `docs/features/F006-push-back-protocol.md`（Python
 * `flowforge/core/teamact/push_back.py` 契约，RA-015 推回权）：
 *   - PushBack 8 字段结构化记录（§2.1）
 *   - 推回三要素强制（INV-1：from_owner / reason / evidence 非空，无证据推回非法）
 *   - resolved 默认 False，必须显式 resolve（INV-2：禁自动关闭）
 *   - resolve 的 resolution 必须非空（INV-3：禁空字符串静默关闭）
 *   - list_unresolved 供 F002 检查 QUALITY_BAR_MET 阻塞（INV-4）
 *   - push_back_id 自动生成 `pb-{10hex}`（INV-6：禁手工填充）
 *
 * 时间统一 epoch ms（number）。推回不计入 F007 failure count（INV-5，调用方职责）。
 *
 * @module @flowforge/cats-ball-custody/push-back
 */

import { randomUUID } from 'node:crypto';
import { assertNonEmpty, BallCustodyError, type NowFn, type PushBack } from './models.js';

/**
 * 推回协议 registry（内存实现，Phase A；Phase B 可接 Durable State Surfaces 持久化）。
 *
 * 生命周期：create_push_back（VERDICT 步骤）→ @to_owner 路由 → 评审 →
 * resolve（accept/reject/escalate）→ 解除 QUALITY_BAR_MET 阻塞（F006 §2.3）。
 */
export class PushBackProtocol {
  private readonly _nowFn: NowFn;
  private readonly _pushBacks = new Map<string, PushBack>(); // push_back_id -> push-back
  private readonly _order: string[] = []; // 创建序（listAll 稳定输出）

  constructor(nowFn?: NowFn) {
    this._nowFn = nowFn ?? (() => Date.now());
  }

  /** 生成 `pb-{10hex}` push_back_id（F006 AC-A6）。 */
  private newPushBackId(): string {
    return `pb-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  }

  /**
   * 创建推回。
   *
   * @throws BallCustodyError - from_owner 为空（AC-A2）、to_owner 为空（AC-A3）、
   *   reason 为空（AC-A4）、evidence 为空列表（AC-A5）——推回三要素强制（RA-015）。
   */
  createPushBack(
    fromOwner: string,
    toOwner: string,
    reason: string,
    evidence: readonly string[],
  ): PushBack {
    assertNonEmpty(fromOwner, 'from_owner');
    assertNonEmpty(toOwner, 'to_owner');
    assertNonEmpty(reason, 'reason');
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new BallCustodyError(
        'evidence 至少需要一个 anchor（commit sha / trace id / 测试报告路径，T2 铁律）——无证据推回非法',
      );
    }

    const pushBack: PushBack = {
      from_owner: fromOwner,
      to_owner: toOwner,
      reason,
      evidence: [...evidence],
      created_at: this._nowFn(),
      resolved: false,
      resolution: '',
      push_back_id: this.newPushBackId(),
    };
    this._pushBacks.set(pushBack.push_back_id, pushBack);
    this._order.push(pushBack.push_back_id);
    return pushBack;
  }

  /**
   * 显式解决推回（AC-A7：resolved=True 且 resolution 非空）。
   *
   * @throws BallCustodyError - 未知 push_back_id（AC-A8）或 resolution 为空（AC-A9）。
   */
  resolve(pushBackId: string, resolution: string): void {
    const pushBack = this._pushBacks.get(pushBackId);
    if (pushBack === undefined) {
      throw new BallCustodyError(`unknown push_back_id: ${pushBackId}`);
    }
    assertNonEmpty(resolution, 'resolution');
    pushBack.resolved = true;
    pushBack.resolution = resolution;
  }

  /** 返回所有未解决推回（AC-A10：只含 resolved=False；阻塞 QUALITY_BAR_MET 依据）。 */
  listUnresolved(): PushBack[] {
    return this._order
      .map((id) => this._pushBacks.get(id))
      .filter((pb): pb is PushBack => pb !== undefined && !pb.resolved);
  }

  /** 返回全部推回（resolved + unresolved，按创建序）。 */
  listAll(): PushBack[] {
    return this._order
      .map((id) => this._pushBacks.get(id))
      .filter((pb): pb is PushBack => pb !== undefined);
  }

  /**
   * 按 id 获取推回。
   *
   * @throws BallCustodyError - 未知 push_back_id。
   */
  get(pushBackId: string): PushBack {
    const pushBack = this._pushBacks.get(pushBackId);
    if (pushBack === undefined) {
      throw new BallCustodyError(`unknown push_back_id: ${pushBackId}`);
    }
    return pushBack;
  }

  /** 当前推回总数（监控辅助）。 */
  get size(): number {
    return this._pushBacks.size;
  }
}
