# plan: F44 增量二 · 波 2a（核心身份层 + 世界层 + 三路记忆）

> 实例：`f44-world-engine-wave2a` ｜ 规格（Spec）：`docs/process/specs/2026-09-17-f44-world-engine-wave2a-design.md` ｜ 工作流：feature

**目标（Goal）**：把 `python/legacy/core/world_engine/` 第 1-2 层（`core_identity` / `citizens` / `world` / 三路记忆，1182 行）移植为 `@flowforge/forgekin-world-engine`（设计 §1.1 N1-N7）。
**架构（Architecture）**：见设计 §2.1——`src/` 12 模块（errors/clock/validation/citizens/core-identity/ports×3/三路记忆实现/world-layer/index）；`tests/` 3 契约测试文件。
**技术栈（Tech Stack）**：TypeScript ESM + vitest（真实数据）；**零运行时依赖**。

## 全局约束
- 零 `@cat-cafe` / `@deepseek-ai` / `@clowder` 引用；`package.json` dependencies 为空。
- 不移植桥接层（`role_mask`/`canon_sync`/`driver`/`coordinator`/`bridge`/`mind_families`）——属波 2b。
- 单文件 ≤ 1000 行；不可变对象不暴露可变引用（返回拷贝）。

## 任务清单

### 任务 1：包骨架 + 基础三件（errors / clock / validation）

- [ ] **步骤 1：建包骨架**——`packages/forgekin/world-engine/{package.json,tsconfig.json,src,tests}`，沿用 `@flowforge/util-stdlib` 同构；`dependencies` 留空（零运行时依赖）。

```json
{
  "name": "@flowforge/forgekin-world-engine",
  "version": "0.1.0-rc.5",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "license": "MIT"
}
```

- [ ] **步骤 2：`src/errors.ts`**——三类错误（设计 §2.2）：`WorldEngineValidationError`（字段校验失败）、`WorldEngineOwnershipError`（world_id 归属不符）、`WorldEngineStateError`（状态非法，如重复进入场景）。

```ts
export class WorldEngineValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'WorldEngineValidationError'; }
}
export class WorldEngineOwnershipError extends Error {
  constructor(message: string) { super(message); this.name = 'WorldEngineOwnershipError'; }
}
export class WorldEngineStateError extends Error {
  constructor(message: string) { super(message); this.name = 'WorldEngineStateError'; }
}
```

- [ ] **步骤 3：`src/clock.ts`**——`Clock` 端口 + `systemClock` 默认实现 + `isoNow(clock)`；对齐源码 `datetime.now(timezone.utc).isoformat()`（DCP D5）。

- [ ] **步骤 4：`src/validation.ts`**——pydantic 语义对齐（DCP D3）：`assertKnownKeys(input, allowed, model)`（`extra="forbid"`）、`requireNonEmpty(value, field)`（含 trim）、`requireUnique(items, field)`、`requireNonNegativeInt(value, field)`、`requireEnum(value, allowed, field)`。

- [ ] **步骤 5：先红后绿测试**——`tests/citizens.spec.ts` 先落「校验器」用例（红：模块未实现），实现至全绿后再进入任务 2；本任务只要求校验器 5 个用例通过。

```ts
import { describe, expect, it } from 'vitest';
import { assertKnownKeys, requireNonEmpty, requireUnique } from '../src/validation.js';
import { WorldEngineValidationError } from '../src/errors.js';

describe('validation', () => {
  it('rejects unknown keys like pydantic extra=forbid', () => {
    expect(() => assertKnownKeys({ a: 1, b: 2 }, ['a'], 'M')).toThrow(WorldEngineValidationError);
    expect(() => assertKnownKeys({ a: 1 }, ['a'], 'M')).not.toThrow();
  });
  it('rejects blank strings and trims otherwise', () => {
    expect(() => requireNonEmpty('  ', 'name')).toThrow(WorldEngineValidationError);
    expect(requireNonEmpty('  x ', 'name')).toBe('x');
  });
  it('rejects duplicate list items', () => {
    expect(() => requireUnique(['a', 'a'], 'corePersonality')).toThrow(WorldEngineValidationError);
  });
});
```

### 任务 2：9 个一等公民 + 核心身份层（N1 / N2）

- [ ] **步骤 1：`src/citizens.ts`**——9 个公民的类型 + `createX` 工厂：`World`（`rules` 默认 `[]`）、`Character`、`Scene`、`CanonDecision`（`decidedBy` 限 `operator`/`canon_driver`/`council`；`timestamp` 由 `Clock` 注入）、`Relationship`、`Artifact`（`properties` 默认 `{}`）、`Round`（`sequence >= 0` 整数）、`Branch`、`Turn`（**`isCanon` 默认 `false`**——铁律 CL-010）。全部 `Object.freeze` 返回（DCP D4）。

- [ ] **步骤 2：`src/core-identity.ts`**——`CoreIdentityLayer`（冻结）：`forgekinId` / `name` / `species` / `birthTimestamp` / `corePersonality`（去重）/ `valueAnchors`（去重）/ `soulImprintHash`；`createCoreIdentity()` 校验；`describeCoreIdentity()` 返回含 `layer: 'core_identity'` + `immutable: true`；`verifyImprint(id, hash)`。

- [ ] **步骤 3：先红后绿测试（补全 `tests/citizens.spec.ts`）**——覆盖设计 §7.1-§7.2：9 模型构造计数 = 9；`createWorld` 空串/未知字段被拒；`createCanonDecision` 非法 `decidedBy` 被拒；`createTurn` 默认 `isCanon === false`；`createRound` 负 `sequence` 被拒；`Artifact.properties` 默认 `{}`；核心身份冻结（改写抛错，`Object.isFrozen` 为真）、重复 `corePersonality` 被拒、`describeCoreIdentity` 形状、`verifyImprint` 正反例。测试通过后再进入任务 3。

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTurn, createWorld, createCanonDecision } from '../src/citizens.js';
import { createCoreIdentity, describeCoreIdentity, verifyImprint } from '../src/core-identity.js';
import { WorldEngineValidationError } from '../src/errors.js';

describe('citizens + core identity', () => {
  it('defaults Turn.isCanon to false (CL-010)', () => {
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' });
    expect(turn.isCanon).toBe(false);
  });
  it('rejects blank world fields and unknown keys', () => {
    expect(() => createWorld({ worldId: '', name: 'x', setting: 's' })).toThrow(WorldEngineValidationError);
  });
  it('freezes the core identity', () => {
    const identity = createCoreIdentity({
      forgekinId: 'forgemind:writer_cat', name: '写作猫', species: 'bio',
      birthTimestamp: '2026-01-01T00:00:00.000Z', soulImprintHash: 'h1',
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(verifyImprint(identity, 'h1')).toBe(true);
    expect(verifyImprint(identity, 'h2')).toBe(false);
    expect(describeCoreIdentity(identity).layer).toBe('core_identity');
  });
});
```

### 任务 3：三路记忆（N3 / N4 / N5 / N7）

- [ ] **步骤 1：`src/ports/*.ts`**——三个 Port 接口（DCP D6）：`CanonMemoryPort`（`write(decision, confirmedBy)` / `read(worldId)` / `query(worldId, filter)` / `canWrite(actor)`）、`RelationalMemoryPort`（`recordInteraction` / `queryRelationships` / `updateRelationship` / `getInteractionHistory`）、`SessionMemoryPort`（`addTurn` / `clearSession` / `getTurns` / `getSessionIds` / `markTurnCanon` / `dumpSession`）。

- [ ] **步骤 2：`src/canon-memory.ts`**——`InMemoryCanonMemory`：`CANON_WRITERS` 白名单（`operator`/`canon_driver`/`council`）；`confirmedBy` 与 `decision.decidedBy` 双校验，任一不在白名单返回 `false`；同 `decisionId` 幂等返回 `true`；写入后按 `timestamp` 升序稳定排序；`query` 支持 `{ decidedBy?, worldId? }` 结构化过滤（DCP D3，替代源码 `getattr` 反射）。

- [ ] **步骤 3：`src/relational-memory.ts`**——`InMemoryRelationalMemory`：`recordInteraction` 未注册则自动登记关系、互动条目自动补 `timestamp`（`Clock`）；`queryRelationships` 双向（`characterA` 或 `characterB`）；`updateRelationship` 返回新对象（`Object.freeze`），不存在返回 `false`；`getInteractionHistory` 返回拷贝。

- [ ] **步骤 4：`src/session-memory.ts`**——`InMemorySessionMemory`：以 `turn.roundId` 为 session 键分桶；`clearSession` 只清该桶；`markTurnCanon` 重建 Turn（`{...turn, isCanon: true}`）且**不触碰 Canon 记忆**；`dumpSession` 返回 `{ sessionId, turnCount, canonCount, turns }`；`getSessionIds`。

- [ ] **步骤 5：先红后绿测试**——`tests/memories.spec.ts` 先落断言（红：模块未实现），覆盖设计 §7.3-§7.5：Canon 白名单外拒绝写入 + 非法 `decidedBy` 拒绝 + 幂等 + 时间排序 + 过滤 + `canWrite`；Relational 自动注册 + 双向查询 + 演化 + 不存在返回 false + 历史时间戳；Session 分桶 + 隔离清理 + `markTurnCanon` 只改副本 + `dumpSession` 统计。测试通过后再进入任务 4。

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryCanonMemory } from '../src/canon-memory.js';
import { InMemorySessionMemory } from '../src/session-memory.js';
import { createCanonDecision, createTurn } from '../src/citizens.js';

const clock = { now: () => '2026-09-17T00:00:00.000Z' };

describe('three memories', () => {
  it('rejects unconfirmed canon writes (CL-010)', async () => {
    const canon = new InMemoryCanonMemory();
    const decision = createCanonDecision({
      decisionId: 'd1', worldId: 'w1', decision: 'x', decidedBy: 'operator', timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(await canon.write(decision, 'forgekin:writer')).toBe(false);
    expect(await canon.write(decision, 'operator')).toBe(true);
  });
  it('keeps session turns out of canon', async () => {
    const session = new InMemorySessionMemory({ clock });
    await session.addTurn(createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: 'x' }));
    expect(await session.getTurns('r1')).toHaveLength(1);
    expect((await session.dumpSession('r1')).canonCount).toBe(0);
  });
});
```

### 任务 4：WorldLayer 聚合 + 包登记 + 收尾

- [ ] **步骤 1：`src/world-layer.ts`**——`WorldLayer`：构造校验 4 个依赖非空；持有 World + 三路记忆；`registerCharacter`/`registerScene`/`registerArtifact` 做 `worldId` 归属校验（不符抛 `WorldEngineOwnershipError`）；`registerRound`/`registerBranch`/`registerRelationship`；`getCharacter`/`getScene`/`listCharacters`；**`addTurn` 只写 SessionMemory**（铁律 CL-010）；`describe()` 返回各实体计数 + `layer: 'world'`。

- [ ] **步骤 2：`src/index.ts`**——导出面按设计 §2.1（错误 / 时钟 / 校验 / 9 公民工厂与类型 / 核心身份 / 三个 Port 与 InMemory 实现 / WorldLayer）。

- [ ] **步骤 3：包登记**——`tsconfig.host.json` references 增补 `./packages/forgekin/world-engine`（仅一处，插入后必须 `grep -c` 确认唯一）。

```bash
grep -c "packages/forgekin/world-engine" tsconfig.host.json
```

- [ ] **步骤 4：先红后绿测试**——`tests/world-layer.spec.ts` 先落断言（红），覆盖设计 §7.6 与 §2.3 四条铁律：world_id 不符的角色/场景/造物注册被拒；Round/Branch/Relationship 可注册；`listCharacters` 返回拷贝（改动不影响内部）；**`addTurn` 后 Canon 记忆仍为空**（CL-010 断言）；`describe()` 计数正确；跨世界隔离（两个 WorldLayer 互不可见）。测试通过即为本包 DoD。

```ts
import { describe, expect, it } from 'vitest';
import { WorldLayer } from '../src/world-layer.js';
import { InMemoryCanonMemory } from '../src/canon-memory.js';
import { InMemoryRelationalMemory } from '../src/relational-memory.js';
import { InMemorySessionMemory } from '../src/session-memory.js';
import { createCharacter, createTurn, createWorld } from '../src/citizens.js';
import { WorldEngineOwnershipError } from '../src/errors.js';

const clock = { now: () => '2026-09-17T00:00:00.000Z' };

describe('WorldLayer', () => {
  const build = () => new WorldLayer({
    world: createWorld({ worldId: 'w1', name: '西游记', setting: '取经' }),
    canonMemory: new InMemoryCanonMemory(),
    relationalMemory: new InMemoryRelationalMemory({ clock }),
    sessionMemory: new InMemorySessionMemory({ clock }),
  });

  it('rejects entities from another world', () => {
    const layer = build();
    expect(() => layer.registerCharacter(createCharacter({
      characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w2',
    }))).toThrow(WorldEngineOwnershipError);
  });

  it('never auto-promotes a turn into canon (CL-010)', async () => {
    const layer = build();
    await layer.addTurn(createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' }));
    expect(await layer.canonMemory.read('w1')).toHaveLength(0);
  });
});
```

- [ ] **步骤 5：矩阵登记**——`10-stage-map.md` F44 行补「增量二 波 2a 已交付（核心身份层 + 世界层 + 三路记忆），波 2b（桥接层 + 心智家族）待做」；S7 行同步。

```md
| F44 | ... | stretch | 🟦（增量一 ✅ + **增量二波 2a ✅**：`@flowforge/forgekin-world-engine` 9 公民/核心身份/三路记忆/WorldLayer；**待做**：波 2b 桥接层三协议 + 心智家族） |
```

- [ ] **步骤 6：验证与提交**——`npx vitest run packages/forgekin/world-engine`、包级 `tsc -p tsconfig.json --noEmit`、`npx oxlint`、禁用依赖与依赖清单扫描，逐条 `ff_dev evidence` 登记（**测试通过**为准入条件）；`./mgr sync "feat(forgekin): F44 增量二波 2a 世界引擎 核心身份/世界层/三路记忆移植 [sherlock]" --body "…"`。

```bash
npx vitest run packages/forgekin/world-engine
cd packages/forgekin/world-engine && npx tsc -p tsconfig.json --noEmit
cd /d/software/fl/flowlight/flowforge && npx oxlint packages/forgekin/world-engine
node -e "const p=require('./packages/forgekin/world-engine/package.json');console.log('deps:',JSON.stringify(p.dependencies||{}))"
```

## 计划自审清单
- [ ] 覆盖设计 §5 交付物 1-5 与 §7 DoD 1-8
- [ ] 无占位符；每任务含 `tests/` 路径与可复算命令
- [ ] 每任务先红后绿，测试通过为进入下一任务前置
- [ ] 七个 DCP 决策（D1-D7）在设计中已记录取舍

## 校验登记
`ff_dev gate f44-world-engine-wave2a plan --evidence docs/process/plans/2026-09-17-f44-world-engine-wave2a.md` → 通过后 `ff_doctor plan` 本文件合规。
