/**
 * C30 plugin-inventory 包测试 — @flowforge/cats-plugin-inventory。
 *
 * 覆盖：
 *  - ctx.plugin(CatsPluginInventory) → ctx.catsPluginInventory 挂载 + 工厂
 *  - contract：validateManifest（root additionalProperties / 封闭枚举 / semver /
 *    铁律 #5 data 策略）+ validateEffectiveGrants（17 上限 / 去重 / 未知值）
 *  - snapshot：isCanonicalPackageDigest（sha512-SRI）+ parsePluginInventorySnapshot
 *    fail-closed（CORRUPT_SNAPSHOT / UNSUPPORTED_SCHEMA + 3 不变量）
 *  - stores：Memory 事务队列串行化 + File 原子 temp+rename（真实临时文件）
 *  - control-plane：install / upgrade / reinstall / revokeGrant / recoverAfterRestart
 *    （now / createInstanceId 注入）
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@flowforge/cordis';
import CatsPluginInventory, {
  CatsPluginInventoryService,
  FilePluginInventoryStore,
  HostInventoryControlPlane,
  MemoryPluginInventoryStore,
  PLUGIN_CONTRACT_VERSION,
  PluginInventoryError,
  emptyPluginInventorySnapshot,
  isCanonicalPackageDigest,
  parsePluginInventorySnapshot,
  validateEffectiveGrants,
  validateManifest,
  type PackageAdmissionCandidate,
  type PluginManifest,
  type PluginInventorySnapshot,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withInventory(): Promise<Context> {
  const ctx = new Context();
  const fiber = (await ctx.plugin(CatsPluginInventory)) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

/** 规范 sha512-SRI digest：64 字节 base64（Buffer 编码保证规范尾位）。 */
const DIGEST = `sha512-${Buffer.alloc(64, 0).toString('base64')}`;
/** 另一个规范 digest（内容不同）。 */
const OTHER_DIGEST = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;

/** 合法 PluginManifest（契约版本与 Host 对齐）。 */
const validManifest = {
  pluginId: 'com.example.hello',
  version: '1.0.0',
  contractVersion: PLUGIN_CONTRACT_VERSION,
  name: 'Hello Plugin',
  description: 'A hello plugin',
  features: [
    {
      id: 'hello-feature',
      name: 'Hello',
      resources: [{ type: 'resource', id: 'hello' }],
      capabilities: ['plugin.config.read', 'messaging.send'],
    },
  ],
  data: [
    { name: 'notes', dataClass: 'user-authored', strategy: 'retained' },
    { name: 'scratch', dataClass: 'cache', strategy: 'lifecycle' },
  ],
  runtime: { transport: 'builtin' },
};

function candidate(overrides: Partial<PackageAdmissionCandidate> = {}): PackageAdmissionCandidate {
  return {
    manifest: structuredClone(validManifest) as PluginManifest,
    computedPackageDigest: DIGEST,
    expectedPackageDigest: DIGEST,
    packagePluginId: 'com.example.hello',
    effectiveGrants: ['plugin.config.read'],
    ...overrides,
  };
}

describe('C30 CatsPluginInventoryService — Cordis 服务生命周期', () => {
  it('mounts at ctx.catsPluginInventory after ctx.plugin(CatsPluginInventory)', async () => {
    const ctx = await withInventory();
    expect(ctx.catsPluginInventory).toBeInstanceOf(CatsPluginInventoryService);
  });

  it('工厂：createMemoryStore / createFileStore / createControlPlane', async () => {
    const ctx = await withInventory();
    const svc = ctx.catsPluginInventory;
    expect(svc.createMemoryStore()).toBeInstanceOf(MemoryPluginInventoryStore);
    const fileStore = svc.createFileStore(join(await mkdtemp(join(tmpdir(), 'inv-file-')), 'inventory.json'));
    expect(typeof fileStore.transaction).toBe('function');
    const plane = svc.createControlPlane(svc.createMemoryStore());
    expect(plane).toBeInstanceOf(HostInventoryControlPlane);
  });
});

describe('C30 contract — validateManifest fail-closed', () => {
  it('合法 manifest → valid: true', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
  });

  it('非对象 → type error', () => {
    const result = validateManifest('nope');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.keyword).toBe('type');
  });

  it('root additionalProperties 拒绝未知字段', () => {
    const result = validateManifest({ ...validManifest, smuggled: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'additionalProperties' && e.instancePath === '/smuggled')).toBe(true);
  });

  it('未知 capability → enum error（fail-closed）', () => {
    const bad = structuredClone(validManifest);
    bad.features[0]!.capabilities = ['plugin.root'];
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'enum' && e.instancePath === '/features/0/capabilities/0')).toBe(true);
  });

  it('semver 非法 → pattern error', () => {
    const result = validateManifest({ ...validManifest, version: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'pattern' && e.instancePath === '/version')).toBe(true);
  });

  it('features 空数组 → minItems error', () => {
    const result = validateManifest({ ...validManifest, features: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.instancePath === '/features')).toBe(true);
  });

  it('铁律 #5：user-visible data 禁止 lifecycle 策略', () => {
    const bad = structuredClone(validManifest);
    bad.data[0]!.strategy = 'lifecycle'; // user-authored + lifecycle
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.keyword === 'enum' && e.instancePath === '/data/0/strategy')).toBe(true);
  });

  it('外部 runtime 缺 entrypoint → required error', () => {
    const result = validateManifest({ ...validManifest, runtime: { transport: 'stdio' } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.instancePath === '/runtime/entrypoint')).toBe(true);
  });

  it('feature 内 additionalProperties 拒绝', () => {
    const bad = structuredClone(validManifest);
    Object.assign(bad.features[0]!, { backdoor: 'x' });
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.instancePath === '/features/0/backdoor')).toBe(true);
  });
});

describe('C30 contract — validateEffectiveGrants', () => {
  it('17 个能力值全部合法 → true', () => {
    const all = [
      'plugin.config.read', 'plugin.state.get', 'plugin.state.set',
      'messaging.send', 'schedule.register', 'events.publish', 'messaging.appendElements',
      'onMessage', 'message.event.subscribe', 'secret.read', 'thread.listMetadata',
      'thread.readContent', 'memory.query', 'memory.append', 'memory.retrieve',
      'windows.create', 'whisper.extend',
    ];
    expect(validateEffectiveGrants(all)).toBe(true);
  });

  it('超过 17 项 → false', () => {
    const all = [
      'plugin.config.read', 'plugin.state.get', 'plugin.state.set',
      'messaging.send', 'schedule.register', 'events.publish', 'messaging.appendElements',
      'onMessage', 'message.event.subscribe', 'secret.read', 'thread.listMetadata',
      'thread.readContent', 'memory.query', 'memory.append', 'memory.retrieve',
      'windows.create', 'whisper.extend', 'plugin.state.set',
    ];
    expect(validateEffectiveGrants(all)).toBe(false);
  });

  it('重复 / 未知值 → false', () => {
    expect(validateEffectiveGrants(['plugin.config.read', 'plugin.config.read'])).toBe(false);
    expect(validateEffectiveGrants(['plugin.config.read', 'not.a.capability'])).toBe(false);
  });
});

describe('C30 snapshot — digest 与 fail-closed 解析', () => {
  it('isCanonicalPackageDigest 接受规范 sha512-SRI、拒绝其余', () => {
    expect(isCanonicalPackageDigest(DIGEST)).toBe(true);
    expect(isCanonicalPackageDigest('sha512-AAAA')).toBe(false);
    expect(isCanonicalPackageDigest(`md5-${'A'.repeat(86)}==`)).toBe(false);
    // 非规范 base64（尾位非零）→ 重编码不一致 → 拒绝
    expect(isCanonicalPackageDigest(`sha512-${'B'.repeat(86)}==`)).toBe(false);
    expect(isCanonicalPackageDigest(`sha512-${'A'.repeat(85)}==`)).toBe(false);
  });

  it('空快照解析通过；未知 schema 版本 → UNSUPPORTED_SCHEMA', () => {
    expect(parsePluginInventorySnapshot(emptyPluginInventorySnapshot())).toEqual(emptyPluginInventorySnapshot());
    expect(() => parsePluginInventorySnapshot({ schemaVersion: 2, packages: [], instances: [], grants: [] })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }),
    );
  });

  it('缺集合 → CORRUPT_SNAPSHOT', () => {
    expect(() => parsePluginInventorySnapshot({ schemaVersion: 1 })).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_SNAPSHOT' }),
    );
  });

  it('不变量 1：重复 package digest → CORRUPT_SNAPSHOT', () => {
    const packageRecord = {
      packageDigest: DIGEST,
      pluginId: 'com.example.hello',
      version: '1.0.0',
      contractVersion: PLUGIN_CONTRACT_VERSION,
      manifest: structuredClone(validManifest) as PluginManifest,
      packageState: 'installed',
      verifiedAt: 1,
      updatedAt: 1,
    };
    const snapshot = {
      schemaVersion: 1,
      packages: [packageRecord, { ...packageRecord }],
      instances: [],
      grants: [],
    };
    expect(() => parsePluginInventorySnapshot(snapshot)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_SNAPSHOT' }),
    );
  });

  it('不变量 2：实例引用不存在/未安装的包 → CORRUPT_SNAPSHOT', () => {
    const snapshot = {
      schemaVersion: 1,
      packages: [],
      instances: [
        {
          pluginInstanceId: 'pi_1',
          pluginId: 'com.example.hello',
          packageDigest: DIGEST,
          lifecycleState: 'installed',
          configReadiness: 'incomplete',
          activationState: 'disabled',
          runtimeState: 'stopped',
          installedAt: 1,
          updatedAt: 1,
        },
      ],
      grants: [],
    };
    expect(() => parsePluginInventorySnapshot(snapshot)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_SNAPSHOT' }),
    );
  });

  it('不变量 3：grant 超出 manifest 请求 → CORRUPT_SNAPSHOT', () => {
    const snapshot = {
      schemaVersion: 1,
      packages: [
        {
          packageDigest: DIGEST,
          pluginId: 'com.example.hello',
          version: '1.0.0',
          contractVersion: PLUGIN_CONTRACT_VERSION,
          manifest: structuredClone(validManifest) as PluginManifest,
          packageState: 'installed',
          verifiedAt: 1,
          updatedAt: 1,
        },
      ],
      instances: [
        {
          pluginInstanceId: 'pi_1',
          pluginId: 'com.example.hello',
          packageDigest: DIGEST,
          lifecycleState: 'installed',
          configReadiness: 'incomplete',
          activationState: 'disabled',
          runtimeState: 'stopped',
          installedAt: 1,
          updatedAt: 1,
        },
      ],
      grants: [
        {
          pluginInstanceId: 'pi_1',
          requestedCapabilities: ['plugin.config.read', 'messaging.send'],
          effectiveGrants: ['windows.create'], // 不在 manifest 请求内
          grantRevision: 1,
          updatedAt: 1,
        },
      ],
    };
    expect(() => parsePluginInventorySnapshot(snapshot)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_SNAPSHOT' }),
    );
  });

  it('完整合法快照 → 解析通过（结构化克隆）', () => {
    const snapshot: PluginInventorySnapshot = {
      schemaVersion: 1,
      packages: [
        {
          packageDigest: DIGEST,
          pluginId: 'com.example.hello',
          version: '1.0.0',
          contractVersion: PLUGIN_CONTRACT_VERSION,
          manifest: structuredClone(validManifest) as PluginManifest,
          packageState: 'installed',
          verifiedAt: 1,
          updatedAt: 1,
        },
      ],
      instances: [
        {
          pluginInstanceId: 'pi_1',
          pluginId: 'com.example.hello',
          packageDigest: DIGEST,
          lifecycleState: 'installed',
          configReadiness: 'incomplete',
          activationState: 'disabled',
          runtimeState: 'stopped',
          installedAt: 1,
          updatedAt: 1,
        },
      ],
      grants: [
        {
          pluginInstanceId: 'pi_1',
          requestedCapabilities: ['messaging.send', 'plugin.config.read'],
          effectiveGrants: ['plugin.config.read'],
          grantRevision: 1,
          updatedAt: 1,
        },
      ],
    };
    const parsed = parsePluginInventorySnapshot(snapshot);
    expect(parsed.packages[0]?.packageDigest).toBe(DIGEST);
    expect(parsed.instances[0]?.pluginInstanceId).toBe('pi_1');
    expect(parsed.grants[0]?.grantRevision).toBe(1);
  });
});

describe('C30 stores — Memory 事务串行化', () => {
  it('transaction 写入后 snapshot 可见；回滚事务不污染', async () => {
    const store = new MemoryPluginInventoryStore();
    const seen = await store.snapshot();
    expect(seen.packages).toHaveLength(0);

    await store.transaction((transaction) => {
      transaction.instances.put({
        pluginInstanceId: 'pi_1',
        pluginId: 'com.example.hello',
        packageDigest: DIGEST,
        lifecycleState: 'installed',
        configReadiness: 'incomplete',
        activationState: 'disabled',
        runtimeState: 'stopped',
        installedAt: 1,
        updatedAt: 1,
      });
      throw new PluginInventoryError('INVENTORY_INVARIANT', 'rollback');
    }).catch(() => {});

    const afterRollback = await store.snapshot();
    expect(afterRollback.instances).toHaveLength(0);
  });

  it('并发事务按提交顺序串行化', async () => {
    const store = new MemoryPluginInventoryStore();
    const order: number[] = [];
    const workers = Array.from({ length: 5 }, (_, index) =>
      store.transaction(async (transaction) => {
        await new Promise((resolve) => setTimeout(resolve, 10 - index));
        if (!transaction.packages.get(DIGEST)) {
          transaction.packages.put({
            packageDigest: DIGEST,
            pluginId: 'com.example.hello',
            version: '1.0.0',
            contractVersion: PLUGIN_CONTRACT_VERSION,
            manifest: structuredClone(validManifest) as PluginManifest,
            packageState: 'installed',
            verifiedAt: index,
            updatedAt: index,
          });
        }
        transaction.instances.put({
          pluginInstanceId: `pi_${index}`,
          pluginId: 'com.example.hello',
          packageDigest: DIGEST,
          lifecycleState: index === 0 ? 'installed' : 'retired',
          retiredAt: index,
          configReadiness: 'incomplete',
          activationState: 'disabled',
          runtimeState: 'stopped',
          installedAt: index,
          updatedAt: index,
        });
        transaction.grants.put({
          pluginInstanceId: `pi_${index}`,
          requestedCapabilities: ['messaging.send', 'plugin.config.read'],
          effectiveGrants: ['plugin.config.read'],
          grantRevision: 1,
          updatedAt: index,
        });
        order.push(index);
      }),
    );
    await Promise.all(workers);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    const snapshot = await store.snapshot();
    expect(snapshot.instances.map((i) => i.pluginInstanceId)).toEqual(['pi_0', 'pi_1', 'pi_2', 'pi_3', 'pi_4']);
  });
});

describe('C30 stores — File 原子 temp+rename', () => {
  it('transaction 持久化到文件并可读回', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'inv-file-')), 'inventory.json');
    const store = new FilePluginInventoryStore(path);
    await store.transaction((transaction) => {
      transaction.packages.put({
        packageDigest: DIGEST,
        pluginId: 'com.example.hello',
        version: '1.0.0',
        contractVersion: PLUGIN_CONTRACT_VERSION,
        manifest: structuredClone(validManifest) as PluginManifest,
        packageState: 'installed',
        verifiedAt: 1,
        updatedAt: 1,
      });
    });
    const raw = await readFile(path, 'utf-8');
    expect(raw).toContain('"pluginId": "com.example.hello"');
    const snapshot = await store.snapshot();
    expect(snapshot.packages[0]?.packageDigest).toBe(DIGEST);
  });
});

describe('C30 control-plane — 安装生命周期', () => {
  it('installPackage → instance + package + grant 落地', async () => {
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore(), {
      now: () => 1000,
      createInstanceId: () => 'pi_fixed',
    });
    const result = await plane.installPackage(candidate());
    expect(result).toEqual({ pluginInstanceId: 'pi_fixed', packageDigest: DIGEST, grantRevision: 1 });
    const snapshot = await plane.store.snapshot();
    expect(snapshot.packages).toHaveLength(1);
    expect(snapshot.instances[0]?.lifecycleState).toBe('installed');
    expect(snapshot.grants[0]?.requestedCapabilities).toEqual(['messaging.send', 'plugin.config.read']);
    expect(snapshot.grants[0]?.effectiveGrants).toEqual(['plugin.config.read']);
  });

  it('重复 install → PACKAGE_ALREADY_INSTALLED', async () => {
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore());
    await plane.installPackage(candidate());
    const error = await plane.installPackage(candidate()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PluginInventoryError);
    expect((error as PluginInventoryError).code).toBe('PACKAGE_ALREADY_INSTALLED');
  });

  it('digest 不匹配 → PACKAGE_DIGEST_MISMATCH', async () => {
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore());
    const error = await plane
      .installPackage(candidate({ computedPackageDigest: OTHER_DIGEST }))
      .catch((e: unknown) => e);
    expect((error as PluginInventoryError).code).toBe('PACKAGE_DIGEST_MISMATCH');
  });

  it('manifest 非法 / 契约版本不匹配 → INVALID_MANIFEST / CONTRACT_VERSION_MISMATCH', async () => {
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore());
    const invalid = await plane
      .installPackage(candidate({ manifest: { ...validManifest, version: 'not-semver' } }))
      .catch((e: unknown) => e);
    expect((invalid as PluginInventoryError).code).toBe('INVALID_MANIFEST');

    const wrongVersion = await plane
      .installPackage(candidate({ manifest: { ...validManifest, contractVersion: '9.9.9' } }))
      .catch((e: unknown) => e);
    expect((wrongVersion as PluginInventoryError).code).toBe('CONTRACT_VERSION_MISMATCH');
  });

  it('upgradePackage → 新 digest + grantRevision 前进', async () => {
    let id = 0;
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore(), {
      now: () => 1000,
      createInstanceId: () => `pi_${(id += 1)}`,
    });
    const installed = await plane.installPackage(candidate());
    const nextDigest = OTHER_DIGEST;
    const upgraded = await plane.upgradePackage({
      ...candidate({ computedPackageDigest: nextDigest, expectedPackageDigest: nextDigest }),
      pluginInstanceId: installed.pluginInstanceId,
      expectedGrantRevision: 1,
    });
    expect(upgraded.grantRevision).toBe(2);
    expect(upgraded.packageDigest).toBe(nextDigest);
    const snapshot = await plane.store.snapshot();
    expect(snapshot.instances[0]?.packageDigest).toBe(nextDigest);
    expect(snapshot.grants[0]?.grantRevision).toBe(2);
  });

  it('upgrade 携带过期 grantRevision → STALE_GRANT_REVISION', async () => {
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore(), { createInstanceId: () => 'pi_1' });
    const installed = await plane.installPackage(candidate());
    const error = await plane
      .upgradePackage({ ...candidate(), pluginInstanceId: installed.pluginInstanceId, expectedGrantRevision: 99 })
      .catch((e: unknown) => e);
    expect((error as PluginInventoryError).code).toBe('STALE_GRANT_REVISION');
  });

  it('reinstallPackage → 旧实例退休 + 新实例接任', async () => {
    let id = 0;
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore(), {
      createInstanceId: () => `pi_${(id += 1)}`,
    });
    const installed = await plane.installPackage(candidate());
    const reinstalled = await plane.reinstallPackage({
      ...candidate(),
      previousPluginInstanceId: installed.pluginInstanceId,
    });
    expect(reinstalled.pluginInstanceId).toBe('pi_2');
    expect(reinstalled.grantRevision).toBe(1);
    const snapshot = await plane.store.snapshot();
    const retired = snapshot.instances.find((i) => i.pluginInstanceId === installed.pluginInstanceId);
    expect(retired?.lifecycleState).toBe('retired');
    expect(retired?.retiredAt).toBeDefined();
    const current = snapshot.instances.find((i) => i.pluginInstanceId === 'pi_2');
    expect(current?.lifecycleState).toBe('installed');
  });

  it('revokeGrant → 移出 effectiveGrants 并前进版本；未请求能力拒绝', async () => {
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore(), { createInstanceId: () => 'pi_1' });
    const installed = await plane.installPackage(candidate({ effectiveGrants: ['plugin.config.read', 'messaging.send'] }));

    const notRequested = await plane
      .revokeGrant({ pluginInstanceId: installed.pluginInstanceId, capability: 'secret.read', expectedGrantRevision: 1 })
      .catch((e: unknown) => e);
    expect((notRequested as PluginInventoryError).code).toBe('INVALID_GRANT');

    const revision = await plane.revokeGrant({
      pluginInstanceId: installed.pluginInstanceId,
      capability: 'messaging.send',
      expectedGrantRevision: 1,
    });
    expect(revision).toBe(2);
    const snapshot = await plane.store.snapshot();
    expect(snapshot.grants[0]?.effectiveGrants).toEqual(['plugin.config.read']);
  });

  it('recoverAfterRestart → 中断状态实例复位为 stopped', async () => {
    const initial = {
      schemaVersion: 1,
      packages: [
        {
          packageDigest: DIGEST,
          pluginId: 'com.example.hello',
          version: '1.0.0',
          contractVersion: PLUGIN_CONTRACT_VERSION,
          manifest: structuredClone(validManifest) as PluginManifest,
          packageState: 'installed',
          verifiedAt: 1,
          updatedAt: 1,
        },
      ],
      instances: [
        {
          pluginInstanceId: 'pi_1',
          pluginId: 'com.example.hello',
          packageDigest: DIGEST,
          lifecycleState: 'installed',
          configReadiness: 'incomplete',
          activationState: 'enabling', // 中断的激活
          runtimeState: 'starting',
          installedAt: 1,
          updatedAt: 1,
        },
        {
          pluginInstanceId: 'pi_2',
          pluginId: 'com.example.hello',
          packageDigest: DIGEST,
          lifecycleState: 'retired',
          configReadiness: 'incomplete',
          activationState: 'disabled',
          runtimeState: 'stopped', // 已停止 → 不动
          installedAt: 1,
          updatedAt: 1,
          retiredAt: 1,
        },
      ],
      grants: [
        {
          pluginInstanceId: 'pi_1',
          requestedCapabilities: ['messaging.send', 'plugin.config.read'],
          effectiveGrants: ['plugin.config.read'],
          grantRevision: 1,
          updatedAt: 1,
        },
        {
          pluginInstanceId: 'pi_2',
          requestedCapabilities: ['messaging.send', 'plugin.config.read'],
          effectiveGrants: ['plugin.config.read'],
          grantRevision: 1,
          updatedAt: 1,
        },
      ],
    } as unknown;
    const plane = new HostInventoryControlPlane(new MemoryPluginInventoryStore(initial), { now: () => 2000 });
    const changed = await plane.recoverAfterRestart();
    expect(changed).toBe(1);
    const snapshot = await plane.store.snapshot();
    const recovered = snapshot.instances.find((i) => i.pluginInstanceId === 'pi_1');
    expect(recovered?.runtimeState).toBe('stopped');
    expect(recovered?.activationState).toBe('error');
    expect(recovered?.updatedAt).toBe(2000);
  });
});
