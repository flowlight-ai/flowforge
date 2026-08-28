/**
 * @flowforge/cats-plugin-inventory — C30 plugin inventory 控制面（P15）Cordis 插件
 *
 * TS 移植：clowder-ai `domains/plugin/host-inventory`（C30 控制面视图）。
 * 上游 `@clowder-ai/plugin-contract`（含 conformance runner 的大包）剥离为
 * 包内最小契约 `contract.ts`（Capability 17 值 / PluginManifest /
 * validateManifest / validateEffectiveGrants，版本与上游同步 0.1.0-beta.7）：
 *   - contract：最小 plugin 契约（fail-closed 手写校验，铁律 #5 data 策略约束）
 *   - types：PackageState/InstanceLifecycleState/ConfigReadiness/ActivationState/
 *     RuntimeState + 14 个 PluginInventoryErrorCode
 *   - snapshot：parsePluginInventorySnapshot（fail-closed CORRUPT_SNAPSHOT /
 *     UNSUPPORTED_SCHEMA + 3 不变量：digest 去重 / 实例-包引用 / grant-实例引用），
 *     isCanonicalPackageDigest（sha512-SRI 正则 + base64 64 字节验证）
 *   - contract-policy：PLUGIN_CONTRACT_VERSION + canonicalCapabilities /
 *     requestedCapabilitiesForManifest
 *   - manifest-verifier：verifyPackageAdmission 6 项入场校验
 *   - ports / stores：Memory + File（每路径事务队列 + 原子 temp+rename，
 *     fileOps 注入）实现
 *   - control-plane：install / upgrade / reinstall / revokeGrant /
 *     recoverAfterRestart（now / createInstanceId 注入）
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsPluginInventory from '@flowforge/cats-plugin-inventory'
 * ctx.plugin(CatsPluginInventory)
 * // ctx.catsPluginInventory.createMemoryStore(initial?) /
 * //   .createFileStore(path, options?) / .createControlPlane(store, options?)
 * ```
 *
 * @module @flowforge/cats-plugin-inventory
 */

import { Context, Service } from '@flowforge/cordis';

import { HostInventoryControlPlane } from './control-plane.js';
import type { HostInventoryControlPlaneOptions } from './control-plane.js';
import { FilePluginInventoryStore, MemoryPluginInventoryStore } from './stores.js';
import type { FilePluginInventoryStoreOptions } from './stores.js';
import type { PluginInventoryStore } from './ports.js';

// contract（最小 plugin 契约）
export {
  L0_CAPABILITIES,
  L1_CAPABILITIES,
  L2_CAPABILITIES,
  MAX_GRANT_ITEMS,
  VALID_CAPABILITIES,
  validateEffectiveGrants,
  validateManifest,
} from './contract.js';
export type {
  BuiltinRuntimeDeclaration,
  Capability,
  DataClass,
  DataDeclaration,
  DataStrategy,
  ExternalRuntimeDeclaration,
  ManifestValidationError,
  ManifestValidationResult,
  PluginFeature,
  PluginManifest,
  ResourceReference,
  RuntimeDeclaration,
} from './contract.js';

// contract-policy
export { canonicalCapabilities, PLUGIN_CONTRACT_VERSION, requestedCapabilitiesForManifest } from './contract-policy.js';

// types
export { PLUGIN_INVENTORY_SCHEMA_VERSION, PluginInventoryError } from './types.js';
export type {
  ActivationState,
  ConfigReadiness,
  InstanceLifecycleState,
  InventoryMutationResult,
  PackageAdmissionCandidate,
  PackageState,
  PluginGrantRecord,
  PluginInstanceRecord,
  PluginInventoryErrorCode,
  PluginInventorySnapshot,
  PluginPackageRecord,
  ReinstallPackageInput,
  RevokeGrantInput,
  RuntimeState,
  UpgradePackageInput,
} from './types.js';

// snapshot
export {
  clonePluginInventorySnapshot,
  emptyPluginInventorySnapshot,
  isCanonicalPackageDigest,
  parsePluginInventorySnapshot,
} from './snapshot.js';

// manifest-verifier
export { verifyPackageAdmission } from './manifest-verifier.js';
export type { VerifiedPackageAdmission } from './manifest-verifier.js';

// ports / stores / control-plane
export { HostInventoryControlPlane } from './control-plane.js';
export type { HostInventoryControlPlaneOptions } from './control-plane.js';
export type {
  GrantStore,
  PackageInventoryStore,
  PluginInstanceStore,
  PluginInventoryStore,
  PluginInventoryTransaction,
} from './ports.js';
export { FilePluginInventoryStore, MemoryPluginInventoryStore } from './stores.js';
export type { FilePluginInventoryStoreOptions, InventoryFileOps } from './stores.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** plugin inventory 控制面（P15）：store / control-plane 工厂 */
    catsPluginInventory: CatsPluginInventoryService;
  }
}

/**
 * plugin inventory 域服务（P15）：组装 Memory/File store 与
 * HostInventoryControlPlane 工厂。
 *
 * 挂载 `ctx.catsPluginInventory`，提供：
 *   - createMemoryStore(initial?)：内存快照 store（事务队列串行化）
 *   - createFileStore(path, options?)：文件 store（原子 temp+rename）
 *   - createControlPlane(store, options?)：install/upgrade/reinstall/
 *     revoke/recover 控制面（now/createInstanceId 注入）
 */
export class CatsPluginInventoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'catsPluginInventory');
  }

  /** 创建内存快照 store（initial 可选；缺省空快照） */
  createMemoryStore(initial?: unknown): MemoryPluginInventoryStore {
    return new MemoryPluginInventoryStore(initial);
  }

  /** 创建文件 store（path 宿主注入；fileOps 可注入以便测试） */
  createFileStore(path: string, options?: FilePluginInventoryStoreOptions): FilePluginInventoryStore {
    return new FilePluginInventoryStore(path, options);
  }

  /** 创建控制面（store 注入；now/createInstanceId 可选注入） */
  createControlPlane(store: PluginInventoryStore, options?: HostInventoryControlPlaneOptions): HostInventoryControlPlane {
    return new HostInventoryControlPlane(store, options);
  }
}

export default CatsPluginInventoryService;
