# plan: F44 增量二 · 波 2b（桥接层三协议 + 运行协调器 + 四心智家族）

> 实例：`f44-world-engine-wave2b` ｜ 规格（Spec）：`docs/process/specs/2026-09-17-f44-world-engine-wave2b-design.md` ｜ 工作流：feature

**目标（Goal）**：把 `world_engine` 第 3 层与心智家族（1727 行）续入 `@flowforge/forgekin-world-engine`（设计 §1.1 N1-N7）。
**架构（Architecture）**：见设计 §2.1——`src/logger.ts` + `src/bridge/{role-mask,canon-sync,world-driver,runtime-coordinator,bridge-layer}.ts` + `src/mind-families.ts` + `assets/prompts.yaml`。
**技术栈（Tech Stack）**：TypeScript ESM + vitest；`yaml` 仅作 devDependency（测试解析资产）。

## 全局约束
- 运行时零依赖（`dependencies` 保持为空）；零 `@cat-cafe` / `@deepseek-ai` / `@clowder` 引用。
- 不改波 2a 既有模块行为；`index.ts` 仅追加导出。
- 依赖变更必须同步 `pnpm-lock.yaml`，并以 `pnpm install --frozen-lockfile` 自证。
- 单文件 ≤ 1000 行。

## 任务清单

### 任务 1：Logger 端口 + Role Mask 五层协议（N1）

- [ ] **步骤 1：`src/logger.ts`**——`Logger` 端口（`debug`/`info`/`warn`/`error`）+ `silentLogger` 默认实现（D3）。

```ts
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
```

- [ ] **步骤 2：`src/bridge/role-mask.ts`**——`ROLE_MASK_LAYERS = [1,2,3,4,5] as const` + 派生 `RoleMaskLayer` 联合类型；层名映射（路由身份/基础设施/本体能力/场景皮肤/世界内状态）；**有序**常量数组 `SCENE_LAYERS = [4,5]`、`ONTOLOGY_LAYERS = [1,2,3]`（D2 注：源码用 frozenset，返回顺序不确定）；`assertRoleMaskLayer(layer)` 运行时校验；`RoleMask` 类：`wear`/`takeOff`/`takeOffSceneLayers`/`getActiveMask`/`getLayer`/`isWearing`/`describe`。

- [ ] **步骤 3：先红后绿测试**——`tests/bridge.spec.ts` 先落 Role Mask 用例（红：模块未实现），实现至全绿。覆盖设计 §7.1。

```ts
import { describe, expect, it } from 'vitest';
import { RoleMask, ROLE_MASK_LAYERS } from '../src/bridge/role-mask.js';
import { WorldEngineValidationError } from '../src/errors.js';

describe('RoleMask', () => {
  it('wears and takes off layers independently', () => {
    const mask = new RoleMask('forgemind:writer_cat');
    mask.wear(3, { capability: '写作' });
    mask.wear(4, { character: '孙悟空' });
    expect(mask.isWearing(4)).toBe(true);
    expect(mask.takeOff(4)).toEqual({ character: '孙悟空' });
    expect(mask.isWearing(3)).toBe(true);
  });
  it('rejects unknown layers at runtime', () => {
    const mask = new RoleMask('forgemind:writer_cat');
    expect(ROLE_MASK_LAYERS).toHaveLength(5);
    expect(() => mask.wear(9 as never, {})).toThrow(WorldEngineValidationError);
  });
});
```

### 任务 2：Canon Sync Protocol + World Driver（N2 / N3）

- [ ] **步骤 1：`src/bridge/canon-sync.ts`**——`CANON_CONFIRMERS = ['operator','canon_driver'] as const`；`CanonProposal` 接口（`proposalId`/`turn`/`proposer`/`createdAt`/`status`/`confirmer`/`rejecter`/`rejectReason`）；`CanonProposer` 最小端口（D2）；`CanonSyncProtocol` 实现 `CanonProposer`：`proposeCanon`（`isCanon=true` 抛 `WorldEngineStateError`、空 proposer 抛 `WorldEngineValidationError`、用 `Clock`+`randomId` 生成 id）、`confirmCanon`（白名单外 false、非 pending false、写 Canon 端口 + 标记 Session 副本 + 置 confirmed）、`rejectCanon`（空 reason/rejecter 抛错、非 pending false、置 rejected）、`getProposal`、`canonConfirmers()`。
  依赖注入：`{ canonMemory: CanonMemoryPort, sessionMemory?: SessionMemoryPort, worldId?: string, clock?: Clock, generateId?: () => string }`（`generateId` 默认 `randomUUID().replace(/-/g,'')`，对齐源码 `uuid4().hex`）。

- [ ] **步骤 2：`src/bridge/world-driver.ts`**——`WorldDriver`：构造校验 `world`/`canonMemory` 非空；`tick()` 递增计数、产 `world_rotation` 事件入 pending 并返回该事件数组；`getWorldState()`；`canWriteCanon(actor)`；`getPendingEvents()`/`clearPendingEvents()`；`tickCount` getter。

- [ ] **步骤 3：先红后绿测试（补全 `tests/bridge.spec.ts`）**——覆盖设计 §7.2-§7.3：`proposeCanon` 对已入典 Turn 抛错、确认白名单外返回 false、确认后 Canon 有记录且 Session 副本 `isCanon=true`、重复确认 false、`rejectCanon` reason 必填且置 rejected、`getProposal` 形状；`tick` 计数与事件、`getWorldState` 字段、`canWriteCanon` 白名单、`clearPendingEvents`。测试通过后再进入任务 3。

```ts
import { describe, expect, it } from 'vitest';
import { CanonSyncProtocol } from '../src/bridge/canon-sync.js';
import { InMemoryCanonMemory } from '../src/canon-memory.js';
import { InMemorySessionMemory } from '../src/session-memory.js';
import { createTurn } from '../src/citizens.js';

const clock = { now: () => '2026-09-17T00:00:00.000Z' };

describe('CanonSyncProtocol (CL-010)', () => {
  it('requires an authorised confirmer before canon is written', async () => {
    const canon = new InMemoryCanonMemory();
    const session = new InMemorySessionMemory();
    const protocol = new CanonSyncProtocol({ canonMemory: canon, sessionMemory: session, worldId: 'w1', clock });
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' });
    await session.addTurn(turn);
    const proposalId = await protocol.proposeCanon(turn, 'forgemind:writer_cat');
    expect(await protocol.confirmCanon(proposalId, 'forgekin:writer_cat')).toBe(false);
    expect(await canon.read('w1')).toHaveLength(0);
    expect(await protocol.confirmCanon(proposalId, 'operator')).toBe(true);
    expect(await canon.read('w1')).toHaveLength(1);
    expect((await session.getTurns('r1'))[0]?.isCanon).toBe(true);
  });
});
```

### 任务 3：Runtime Coordinator + BridgeLayer（N4 / N5）

- [ ] **步骤 1：`src/bridge/runtime-coordinator.ts`**——构造 `{ coreIdentity, world, canonProposer }`（**D2 依赖倒置**：不引用 BridgeLayer）；`enterScene(scene, roleMask)`（跨世界拒绝 → `WorldEngineOwnershipError`、面具持有者不符拒绝 → `WorldEngineValidationError`、已在场景拒绝 → `WorldEngineStateError`）；`exitScene()`（不在场景抛 `WorldEngineStateError`；摘 L4/L5 返回有序记录）；`proposeCanon(turn)`（不在场景抛错；委托 `canonProposer.proposeCanon(turn, coreIdentity.forgekinId)`）；`currentScene`/`isInScene`/`describe()`。

- [ ] **步骤 2：`src/bridge/bridge-layer.ts`**——`BridgeLayer` 构造 `{ roleMaskProtocol, canonSyncProtocol, worldDriver, coordinator }`（四个依赖经 `requirePresent` 拒空）；四个 getter；`describe()`（`layer: 'bridge'` + 三协议名 + coordinator 描述 + `worldDriverTickCount`）。

- [ ] **步骤 3：先红后绿测试（补全 `tests/bridge.spec.ts`）**——覆盖设计 §7.4-§7.5：跨世界场景拒绝、面具持有者不符拒绝、重复进入抛错、不在场景时 `exitScene`/`proposeCanon` 抛错、`enterScene→proposeCanon→exitScene` 全链路（exit 返回所摘 L4/L5 且 L1-L3 保留）、`BridgeLayer` 拒空与 `describe` 字段。测试通过后再进入任务 4。

```ts
import { describe, expect, it } from 'vitest';
import { BridgeLayer } from '../src/bridge/bridge-layer.js';
import { RuntimeCoordinator } from '../src/bridge/runtime-coordinator.js';
import { RoleMask } from '../src/bridge/role-mask.js';
import { WorldEngineStateError } from '../src/errors.js';

describe('RuntimeCoordinator (CL-012)', () => {
  it('refuses a role mask held by a different forgekin', async () => {
    const mask = new RoleMask('forgemind:other_cat');
    await expect(coordinator.enterScene(scene, mask)).rejects.toThrow(/身份|不一致/);
  });
  it('requires an active scene before proposing canon', async () => {
    await expect(coordinator.proposeCanon(turn)).rejects.toThrow(WorldEngineStateError);
  });
});
```

### 任务 4：四心智家族护栏 + 提示词资产 + 收尾（N6 / N7）

- [ ] **步骤 1：`src/mind-families.ts`**——`MindFamily` 联合类型（`ragdoll`/`maine_coon`/`siamese`/`hotfix`）；三张常量表 `FAMILY_AWAKENING_RANGE` / `FAMILY_GUARDRAIL_STRENGTH` / `FAMILY_ALLOWED_ACTIONS`（逐值照搬）；`GuardrailDecision` 联合类型（`allow`/`deny`/`require_approval`/`defer`）；`GuardrailHook` 接口（`family`/`preAction`/`postAction`）；四实现：`RagdollGuardrail`（越界 DENY、`write_doc` REQUIRE_APPROVAL）、`MaineCoonGuardrail`（越界 DENY）、`SiameseGuardrail`（越界 REQUIRE_APPROVAL）、`HotfixGuardrail`（恒 DEFER）；`defaultFamilyHooks()`；`MindFamilyRouter`（构造注入 `hooks` + `logger`；`selectFamily(stage, action, context)`：emergency→HOTFIX、E1-E2→ragdoll、E3→maine_coon、E4→siamese、E5-E6 按动作分流、非法阶回退 ragdoll；`route(forgekinId, stage, action, context)` 注入 `forgekinId`/`awakeningStage` 后返回 `{ family, decision }`；`postRoute`）。

- [ ] **步骤 2：先红后绿测试**——`tests/mind-families.spec.ts` 覆盖设计 §7.6：四家族决策各一断言（含 ragdoll 的 `write_doc` 分支）、emergency 覆盖、觉醒阶映射五档、非法阶回退、`postRoute` 调用对应 hook（用注入 spy logger 断言日志被调用）、`FAMILY_GUARDRAIL_STRENGTH` 单调递减（0.9/0.6/0.3/0.1）。

```ts
import { describe, expect, it, vi } from 'vitest';
import { MindFamilyRouter, FAMILY_GUARDRAIL_STRENGTH } from '../src/mind-families.js';

describe('MindFamilyRouter (CL-026)', () => {
  it('routing by awakening stage and emergency override', () => {
    const router = new MindFamilyRouter({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    expect(router.selectFamily('E1', 'read')).toBe('ragdoll');
    expect(router.selectFamily('E3', 'write_code')).toBe('maine_coon');
    expect(router.selectFamily('E4', 'deploy')).toBe('siamese');
    expect(router.selectFamily('E5', 'deploy')).toBe('siamese');
    expect(router.selectFamily('E5', 'rollback')).toBe('hotfix');
    expect(router.selectFamily('E1', 'deploy', { emergency: true })).toBe('hotfix');
  });
  it('denies out-of-scope actions per family', () => {
    const router = new MindFamilyRouter();
    expect(router.route('f1', 'E1', 'deploy').decision).toBe('deny');
    expect(router.route('f1', 'E1', 'write_doc').decision).toBe('require_approval');
    expect(router.route('f1', 'E6', 'hotfix').decision).toBe('defer');
  });
});
```

- [ ] **步骤 3：`assets/prompts.yaml`**——源 `config/prompts.yaml` 原样迁入包内 `assets/`（LF、无 BOM）；`package.json` 增 `devDependencies: { "yaml": "^2.6.0" }` 并同步锁文件。

```bash
cp python/legacy/core/world_engine/config/prompts.yaml packages/forgekin/world-engine/assets/prompts.yaml
pnpm install --lockfile-only --ignore-scripts
```

- [ ] **步骤 4：`tests/prompts-asset.spec.ts`**——用 `yaml` 解析资产并断言结构（设计 §7.7）：`world_engine_prompts` 含 8 条键（`canon_sync_review` / `canon_conflict_resolution` / `role_mask_validation` / `role_mask_scene_entry` / `world_driver_tick` / `world_driver_canon_proposal` / `coordinator_scene_decision` / `health_check`）且均为非空字符串；`meta.version === '1.0.0'`、`meta.engine` 含 `world_engine`、`meta.rules` 非空。

- [ ] **步骤 5：`src/index.ts` 追加导出**——`logger` / `bridge/*` / `mind-families` 的公共面（类、类型、常量、`roleMaskLayers()` 等）。

- [ ] **步骤 6：矩阵收口登记**——`10-stage-map.md` F44 行与 S7 行改为「增量一（conditional_router）+ 增量二全量（世界引擎三层 + 心智家族）已交付，F44 关闭」；`31-stage11-sunset.md` §1 P1 遗留口径去掉 F44。

- [ ] **步骤 7：验证与提交**——`npx vitest run packages/forgekin/world-engine`、包级 `tsc -p tsconfig.json --noEmit`、`npx oxlint`、**全仓 `tsc -b` 归因**、`pnpm install --frozen-lockfile --ignore-scripts`，逐条 `ff_dev evidence` 登记（**测试通过**为准入条件）；`./mgr sync "feat(forgekin): F44 增量二波 2b 桥接层三协议+运行协调器+四心智家族 世界引擎收官 [sherlock]" --body "…"`。

```bash
npx vitest run packages/forgekin/world-engine
cd packages/forgekin/world-engine && npx tsc -p tsconfig.json --noEmit
cd /d/software/fl/flowlight/flowforge && npx oxlint packages/forgekin/world-engine
npx tsc -b tsconfig.host.json 2>&1 | grep -c "forgekin/world-engine"
pnpm install --frozen-lockfile --ignore-scripts
```

## 计划自审清单
- [ ] 覆盖设计 §5 交付物 1-5 与 §7 DoD 1-8
- [ ] 无占位符；每任务含 `tests/` 路径与可复算命令
- [ ] 每任务先红后绿，测试通过为进入下一任务前置
- [ ] 六个 DCP 决策（D1-D6）在设计中已记录取舍；依赖变更同步锁文件

## 校验登记
`ff_dev gate f44-world-engine-wave2b plan --evidence docs/process/plans/2026-09-17-f44-world-engine-wave2b.md` → 通过后 `ff_doctor plan` 本文件合规。
