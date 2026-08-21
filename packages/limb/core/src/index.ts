/**
 * @flowforge/limb-core — 阶段6 T6.1 四肢核心域 Cordis 插件
 *
 * 挂载 `ctx.limb`：LimbRegistry（注册/注销/调用 pipeline：policy → lease →
 * action log → execute）、LimbPairingStore（设备配对审批）、LimbLeaseManager
 * （独占租约 TTL）、LimbAccessPolicy（三维权限）、LimbActionLog（provenance
 * 审计）、LimbPresenceManager（心跳在线状态，随 ctx 生命周期启停）。
 */

import { Context, Service } from '@flowforge/cordis';
import { LimbAccessPolicy } from './limb-access-policy.js';
import { LimbActionLog } from './limb-action-log.js';
import { LimbLeaseManager } from './limb-lease-manager.js';
import {
  ApprovedLimbPairingPersistence,
  LimbPairingStore,
  MemoryApprovedLimbPairingPersistence,
  PairingRequest,
} from './limb-pairing-store.js';
import { LimbPresenceManager, LimbPresenceOptions } from './limb-presence.js';
import { LimbRegistry } from './limb-registry.js';
import {
  ILimbNode,
  LimbAuthLevel,
  LimbInvocationContext,
  LimbInvokeResult,
  LimbLease,
  LimbNodeRecord,
} from './types.js';

export * from './types.js';
export { LimbRegistry } from './limb-registry.js';
export { LimbLeaseManager, LeaseManagerOptions } from './limb-lease-manager.js';
export { LimbAccessPolicy } from './limb-access-policy.js';
export { LimbActionLog } from './limb-action-log.js';
export { LimbPresenceManager, mapProbeStateToLimbStatus, StatusChangeCallback } from './limb-presence.js';
export {
  ApprovedLimbPairingPersistence,
  ApprovedLimbPairingRedisKeys,
  CreatePairingParams,
  LimbPairingOwnershipConflictError,
  LimbPairingStore,
  MemoryApprovedLimbPairingPersistence,
  PairingRequest,
  RedisApprovedLimbPairingPersistence,
  RedisHashLike,
} from './limb-pairing-store.js';

export interface LimbServiceOptions {
  /** 租约默认 TTL（ms），缺省 60s */
  readonly leaseTtlMs?: number | undefined;
  /** 心跳超时阈值（ms），缺省 45s */
  readonly presenceTimeoutMs?: number | undefined;
  /** 心跳检查间隔（ms），缺省 15s */
  readonly presenceCheckIntervalMs?: number | undefined;
  /** 配对审批持久化（缺省 Memory；组合根注入 Sqlite 后端） */
  readonly pairingPersistence?: ApprovedLimbPairingPersistence | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 四肢核心域：注册表/配对/租约/权限/审计/在线状态 */
    limb: LimbService;
  }
}

export class LimbService extends Service {
  /** 四肢注册表（含 Phase B pipeline） */
  readonly registry: LimbRegistry;
  /** 独占资源租约管理器 */
  readonly leases: LimbLeaseManager;
  /** 三维访问策略（catId × nodeId × capability） */
  readonly accessPolicy: LimbAccessPolicy;
  /** provenance 审计日志 */
  readonly actionLog: LimbActionLog;
  /** 设备配对审批存储 */
  readonly pairing: LimbPairingStore;
  /** 心跳在线状态管理（随 ctx 生命周期启停） */
  readonly presence: LimbPresenceManager;

  constructor(ctx: Context, options: LimbServiceOptions = {}) {
    super(ctx, 'limb');
    this.registry = new LimbRegistry();
    this.leases = new LimbLeaseManager({ defaultTtlMs: options.leaseTtlMs ?? 60_000 });
    this.accessPolicy = new LimbAccessPolicy();
    this.actionLog = new LimbActionLog();
    this.pairing = new LimbPairingStore(
      options.pairingPersistence ?? new MemoryApprovedLimbPairingPersistence(),
    );
    const presenceOptions: Partial<LimbPresenceOptions> = {};
    if (options.presenceTimeoutMs !== undefined) presenceOptions.timeoutMs = options.presenceTimeoutMs;
    if (options.presenceCheckIntervalMs !== undefined) {
      presenceOptions.checkIntervalMs = options.presenceCheckIntervalMs;
    }
    this.presence = new LimbPresenceManager(this.registry, presenceOptions);
    // 装配 Phase B pipeline 依赖
    this.registry.setDeps({
      accessPolicy: this.accessPolicy,
      leaseManager: this.leases,
      actionLog: this.actionLog,
    });
    // presence 定时器随 ctx 生命周期启停
    ctx.effect(() => () => this.presence.stop(), 'limb.presenceStop');
  }

  // ─── Registry ────────────────────────────────────────────────

  /** 注册一个四肢节点 */
  register(node: ILimbNode): Promise<LimbNodeRecord> {
    return this.registry.register(node);
  }

  /** 注销一个四肢节点 */
  deregister(nodeId: string): void {
    this.registry.deregister(nodeId);
  }

  /** 调用节点能力（policy → lease → action log → execute pipeline） */
  invoke(
    nodeId: string,
    command: string,
    params: Record<string, unknown>,
    context?: LimbInvocationContext,
  ): Promise<LimbInvokeResult> {
    return this.registry.invoke(nodeId, command, params, context);
  }

  /** 列出可用节点（排除 offline） */
  listAvailable(): LimbNodeRecord[] {
    return this.registry.listAvailable();
  }

  /** 列出全部节点（含 offline） */
  listAll(): LimbNodeRecord[] {
    return this.registry.listAll();
  }

  /** 按能力类别查找节点 */
  findByCapability(cap: string): LimbNodeRecord[] {
    return this.registry.findByCapability(cap);
  }

  /** 获取节点元数据 */
  getNode(nodeId: string): LimbNodeRecord | undefined {
    return this.registry.getNode(nodeId);
  }

  /** 更新节点状态 */
  updateStatus(nodeId: string, status: LimbNodeRecord['status']): void {
    this.registry.updateStatus(nodeId, status);
  }

  /** 记录心跳 */
  recordHeartbeat(nodeId: string): void {
    this.registry.recordHeartbeat(nodeId);
  }

  // ─── Pairing ─────────────────────────────────────────────────

  /** 创建配对请求（pending） */
  createPairingRequest(params: {
    nodeId: string;
    displayName: string;
    platform: string;
    endpointUrl: string;
    capabilities: ILimbNode['capabilities'];
  }): PairingRequest {
    return this.pairing.createRequest(params);
  }

  /** 审批配对（幂等；不同用户重复审批抛 OwnershipConflict） */
  approvePairing(requestId: string, userId: string): Promise<PairingRequest | null> {
    return this.pairing.approve(requestId, userId);
  }

  /** 拒绝配对 */
  rejectPairing(requestId: string): boolean {
    return this.pairing.reject(requestId);
  }

  /** 列出 pending 配对 */
  listPendingPairings(): PairingRequest[] {
    return this.pairing.getPending();
  }

  /** 列出已批准配对 */
  listApprovedPairings(): PairingRequest[] {
    return this.pairing.getApproved();
  }

  /** 按 API key 查找已批准配对（远程节点心跳/注销认证） */
  findPairingByApiKey(apiKey: string): PairingRequest | undefined {
    return this.pairing.findByApiKey(apiKey);
  }

  /** 获取配对请求 */
  getPairing(requestId: string): PairingRequest | undefined {
    return this.pairing.get(requestId);
  }

  /** 更新已批准配对端点 */
  updateApprovedEndpoint(nodeId: string, endpointUrl: string): Promise<PairingRequest | undefined> {
    return this.pairing.updateApprovedEndpoint(nodeId, endpointUrl);
  }

  // ─── Lease ───────────────────────────────────────────────────

  /** 获取独占租约（同猫幂等；他猫持有返回 null） */
  acquireLease(catId: string, nodeId: string, capability: string): LimbLease | null {
    return this.leases.acquire(catId, nodeId, capability);
  }

  /** 释放租约 */
  releaseLease(leaseId: string): void {
    this.leases.release(leaseId);
  }

  /** 续期租约 */
  renewLease(leaseId: string): boolean {
    return this.leases.renew(leaseId);
  }

  /** 检查活跃租约 */
  isLeased(nodeId: string, capability: string): LimbLease | null {
    return this.leases.isLeased(nodeId, capability);
  }

  /** 清理过期租约 */
  expireAllLeases(): string[] {
    return this.leases.expireAll();
  }

  /** 按 catId 释放全部租约（猫 crash 恢复） */
  releaseAllLeasesByCat(catId: string): string[] {
    return this.leases.releaseAllByCat(catId);
  }

  // ─── Access policy ───────────────────────────────────────────

  /** 设置三维权限条目（覆盖已有） */
  setPolicy(entry: {
    catId: string;
    nodeId: string;
    capability: string;
    authLevel: LimbAuthLevel;
  }): void {
    this.accessPolicy.setPolicy(entry);
  }

  /** 查询显式策略（未配置返回 null） */
  checkPolicy(catId: string, nodeId: string, capability: string): LimbAuthLevel | null {
    return this.accessPolicy.check(catId, nodeId, capability);
  }

  // ─── Action log ──────────────────────────────────────────────

  /** 按 requestId 获取审计条目 */
  getAction(requestId: string) {
    return this.actionLog.get(requestId);
  }

  /** 按 nodeId 查询审计（最近 N 条） */
  getActionsByNode(nodeId: string, limit?: number) {
    return this.actionLog.getByNode(nodeId, limit);
  }

  /** 按 catId 查询审计（最近 N 条） */
  getActionsByCat(catId: string, limit?: number) {
    return this.actionLog.getByCat(catId, limit);
  }

  // ─── Presence ────────────────────────────────────────────────

  /** 启动心跳检查（幂等；ctx 卸载自动停止） */
  startPresence(): void {
    this.presence.start();
  }

  /** 停止心跳检查 */
  stopPresence(): void {
    this.presence.stop();
  }

  /** 立即执行一轮超时检查 */
  checkPresence(): void {
    this.presence.checkAll();
  }

  /** 注册状态变更回调 */
  onPresenceChange(cb: (nodeId: string, from: LimbNodeRecord['status'], to: LimbNodeRecord['status']) => void): void {
    this.presence.onStatusChange(cb);
  }
}

export default function Plugin(ctx: Context, options?: LimbServiceOptions) {
  return ctx.plugin(LimbService, options);
}
