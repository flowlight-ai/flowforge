# 设计文档：F44 增量二 · 世界引擎三层架构（F093 世界层与三路记忆）

> 实例：`f44-world-engine-wave2a`
> 依据：`docs/refactor/10-stage-map.md` F44 行（`core/world_engine/`，F029/F030）、S7、`docs/process/specs/2026-09-17-f44-conditional-router-design.md`（增量一）
> 源：`python/legacy/core/world_engine/`（13 模块 2746 行 + `config/prompts.yaml` 261 行，S11.2 归档态只读源）
> 日期：2026-09-17 ｜ 状态：设计稿
> 分级：**Architectural**（引入世界域模型与三路记忆端口，需固定分层边界与不可变性契约）

## 1. 目标（Goal）· 需求清单

F093 世界引擎是「虚拟世界设置」的完整实现，修复 CL-007~CL-013 七项历史缺陷。它天然分为三层，
本次按下表拆两波交付（每波独立 PR）：

| 波 | 层 | 源模块 | 源行数 | 本批 |
|---|---|---|---|---|
| **2a** | 第 1 层 核心身份 + 第 2 层 世界层 | `core_identity.py` / `citizens.py` / `world.py` / `canon_memory.py` / `relational_memory.py` / `session_memory.py` | 1182 | ✅ **本批** |
| 2b | 第 3 层 桥接层 + 心智家族 | `role_mask.py` / `canon_sync.py` / `driver.py` / `coordinator.py` / `bridge.py` / `mind_families.py` / `config/prompts.yaml` | 1727 | 下一波（另立实例） |

**需求**：把「不可变核心身份 + 可变世界层 + 三路隔离记忆」移植为 FlowForge 插件包，使 Forgekin 的世界设定、
角色/场景/造物注册与三路记忆读写具备**类型安全 + 实例隔离 + 持久化可注入**的实现。

### 1.1 需求清单（本批 2a）

| # | 需求 | 源 | 修复缺陷 |
|---|---|---|---|
| N1 | 世界层 **9 个一等公民**建模 + 字段校验（非空、枚举白名单、`extra="forbid"`） | `citizens.py` | CL-008（9 公民未建模） |
| N2 | **核心身份层不可变**：字段冻结 + 非空校验 + 列表去重 + `describe()` + `verifyImprint()` | `core_identity.py` | CL-007（身份漂移） |
| N3 | **Canon 记忆**：永久、`confirmed_by` 白名单校验（拒绝未确认写入）、幂等、按 timestamp 排序、`query` 过滤、`canWrite` | `canon_memory.py` | CL-009 / CL-010 |
| N4 | **Relational 记忆**：关系自动注册、互动历史（自动补时间戳）、按角色双向查询、关系类型演化 | `relational_memory.py` | CL-009 |
| N5 | **Session 记忆**：按 session 隔离、自动清理、`markTurnCanon` 仅标本地副本、`dumpSession` | `session_memory.py` | CL-009 / CL-010 |
| N6 | **WorldLayer 聚合**：持有 World + 三路记忆；角色/场景/造物 world_id 归属校验；Round/Branch/Relationship 注册；`addTurn` **只写 Session**（铁律 CL-010）；`describe()` | `world.py` | CL-008 / CL-009 |
| N7 | 三路记忆各自**端口接口**（对应 Python ABC）+ 内存实现，宿主可注入持久化实现 | 各 `*Base` ABC | CL-009 |

## 2. 架构（Architecture）

### 2.1 落点与分层

```
packages/forgekin/world-engine/               # @flowforge/forgekin-world-engine
├── src/
│   ├── errors.ts              # WorldEngineError 家族（身份/归属/校验）
│   ├── clock.ts               # Clock 端口（默认系统时钟）+ isoNow 助手
│   ├── validation.ts          # 端口：非空串修剪、去重、未知字段拒绝（对齐 pydantic）
│   ├── citizens.ts            # N1：9 公民模型 + createX 工厂（含校验）
│   ├── core-identity.ts       # N2：CoreIdentityLayer（冻结）+ describe + verifyImprint
│   ├── ports/
│   │   ├── canon-memory.ts        # N7：CanonMemoryPort + CanonFilter
│   │   ├── relational-memory.ts   # N7：RelationalMemoryPort + InteractionEntry
│   │   └── session-memory.ts      # N7：SessionMemoryPort + SessionDump
│   ├── canon-memory.ts        # N3：InMemoryCanonMemory
│   ├── relational-memory.ts   # N4：InMemoryRelationalMemory
│   ├── session-memory.ts      # N5：InMemorySessionMemory
│   ├── world-layer.ts         # N6：WorldLayer 聚合
│   └── index.ts               # 导出面
├── tests/
│   ├── citizens.spec.ts          # N1 + N2
│   ├── memories.spec.ts          # N3-N5
│   └── world-layer.spec.ts       # N6 + 三层协作
├── package.json  tsconfig.json
```

### 2.2 源码 → 目标 映射（迁移即重构）

| 源码构造 | 目标实现 | 说明 |
|---|---|---|
| `pydantic BaseModel(extra="forbid")` | `validation.ts` 的 `assertKnownKeys` + `requireNonEmpty` + `requireUnique` | TS 无运行时模型层；改为**显式工厂函数** `createWorld(input)` 返回 `World`，构造即校验 |
| `ConfigDict(frozen=True)` | `Object.freeze` + `readonly` 类型 + 冻结不返回 setter | 身份不可变的物理保证（CL-007） |
| `model_copy(update={...})` | 纯函数 `withRelationType(rel, next)` 等返回新对象 | 保持不可变更新语义 |
| `ABC` + 骨架实现 | `XxxPort` 接口（`src/ports/`）+ `InMemoryXxx` 实现 | 仓库铁律：端口与实现分离，宿主注入持久化后端 |
| `datetime.now(timezone.utc)` | 注入式 `Clock` 端口（默认 `systemClock`） | 测试确定性；不硬编码时间源 |
| `getattr(d, k, None) == v` 的 `query` 过滤 | 类型化 `CanonFilter { decidedBy?: Decider; worldId?: string }` | Python 用字符串键反射；TS 改为显式字段（避免 `any` 索引） |
| `_CANON_WRITERS = {operator, canon_driver, council}` | `CANON_WRITERS` 常量（`as const` 派生联合类型） | 白名单集中一处；两处（CanonMemory / 未来 Driver）复用 |
| `logger = get_logger(...)` | **不移植**（本波无日志需求）；2b 的 mind_families 再引入注入式 Logger 端口 | 避免无消费者的端口 |
| 异常（`ValueError` / `TypeError` / `PermissionError`） | `WorldEngineValidationError` / `WorldEngineOwnershipError` / `WorldEngineStateError` | 语义等价且可分类捕获 |

### 2.3 铁律落点（可测试断言）

| 铁律 | 落点 | 断言 |
|---|---|---|
| CL-007 身份不可污染 | `CoreIdentityLayer` 冻结 | 修改任意字段抛错 / 类型层面 `readonly` |
| CL-008 9 公民 | `citizens.ts` 导出 9 个模型 | 导出面计数 = 9 |
| CL-009 三路记忆隔离 | 三个独立 Port + 实现 | 三路互不写入：`addTurn` 后 Canon 仍为空 |
| CL-010 RP 台词不自动入典 | `CanonMemory.write(decision, confirmedBy)` 白名单 + `WorldLayer.addTurn` 只写 Session | 未确认写入返回 false；`addTurn` 不产生 Canon 记录 |

### 2.4 与 `cats/shared` world schema 的边界（重要）

`packages/cats/shared/src/schemas/world.ts`（306 行 zod）是 **clowder 谱系**的世界面
（`characterId` / `threadId` / `actorCatId` / `baseCatId`，含 `WorldActionEnvelope` / `CanonPromotionRecord`）。本包是
**Python legacy F093 谱系**（`world_id` / `character_id` / `CanonDecision.decided_by`，含三层架构与三路记忆端口）。

两者**本波不合并**：字段命名、主键形态、动作模型均不同，强行统一会同时破坏两侧契约；且合并属架构级裁决
（谁为主模型、clowder 侧动作模型如何映射到 F093 的 Turn/CanonDecision）。**登记为待裁决项**（见 §6 D2），
本波只在 README 与本设计记录共存事实与差异，不产生隐式依赖（本包零 `@flowforge/cats-*` 依赖）。

## 3. 技术栈（Tech Stack）

TypeScript（ESM）+ vitest 契约测试（真实数据，无 Mock 被测逻辑）。**零运行时依赖**（不引 zod/yaml：校验自实现，
prompts.yaml 属 2b）。

## 4. 全局约束

- 零 `@cat-cafe` / `@deepseek-ai` / `@clowder` 引用；零新增运行时依赖。
- 不移植桥接层（2b 边界）；`WorldLayer` **不得**持有 CanonSyncProtocol 引用（保持 2a 自洽）。
- 单文件 ≤ 1000 行。
- 不可变对象一律不暴露可变引用（`listCharacters()` 返回拷贝，与源码 `list(...)` 一致）。

## 5. 交付物清单（Deliverables）

1. `packages/forgekin/world-engine/`：`src/` 12 模块 + `package.json` + `tsconfig.json`。
2. `tsconfig.host.json` 项目引用登记。
3. `tests/` 3 契约测试文件，覆盖 N1-N7 与 §2.3 四条铁律断言。
4. 流程产物：本设计 + plan + review + verification。
5. 矩阵登记：`10-stage-map.md` F44 行补「增量二 波 2a 已交付，2b 待做」。

## 6. 决策门（DCP）

| # | 决策 | 选项 | 取舍 | 依据 |
|---|---|---|---|---|
| D1 | 落点 | `packages/forgekin/world-engine`（本设计）vs `packages/cats/*` | ✅ forgekin | F093 是 Forgekin 的身份/世界能力；与 `forgekin/{soul,species,lineage,relationship}` 同域 |
| D2 | 与 `cats/shared` world schema 关系 | **本波不合并**（本设计）vs 统一模型 | ✅ 不合并 | 两谱系主键与动作模型不兼容，合并属架构裁决；先移植保真，登记待裁决 |
| D3 | 模型校验 | 显式工厂函数（本设计）vs 引入 zod | ✅ 工厂函数 | 零依赖优先；pydantic 语义（extra=forbid/非空/去重）用 3 个校验器即可覆盖 |
| D4 | 不可变性 | `Object.freeze` + readonly 类型（本设计）vs 仅类型层 | ✅ 双保险 | CL-007 要求「物理保证」，仅类型层在运行时被 `any` 绕过 |
| D5 | 时间源 | 注入式 `Clock`（本设计）vs 直接 `Date.now()` | ✅ 注入 | 测试需确定性；仓库禁硬编码 |
| D6 | Python ABC 骨架实现 | Port + InMemory 实现（本设计）vs 仅内存类 | ✅ Port 分离 | 宿主需接持久化（源码注释明示 SQLite/Redis 替换点） |
| D7 | 拆波 | 2a/2b 两波（本设计）vs 单批 2746 行 | ✅ 两波 | 单批 PR 过大不利评审；2a 自成可测闭环（WorldLayer 不依赖桥接层） |

**结论**：D1-D7 均采用左侧方案。

## 7. 验收（DoD）

1. 9 个公民模型可构造且校验生效：空串、未知字段、非法 `decided_by` 均被拒（有断言）。
2. `CoreIdentityLayer` 冻结生效：运行时改写抛错；`describe()` 形状与源码一致（含 `layer`/`immutable`）；`verifyImprint` 正反例。
3. `InMemoryCanonMemory`：白名单外 `confirmedBy` 返回 false；`decidedBy` 非法返回 false；同 `decision_id` 幂等；`read` 按 timestamp 升序；`query` 过滤；`canWrite`。
4. `InMemoryRelationalMemory`：`recordInteraction` 自动注册关系并补时间戳；双向查询；`updateRelationship` 演化且不存在时返回 false；互动历史可读。
5. `InMemorySessionMemory`：`addTurn` 按 round_id 分桶；`clearSession` 只清 session；`markTurnCanon` 仅改 session 内副本；`dumpSession` 统计 canon 数。
6. `WorldLayer`：world_id 不一致的角色/场景/造物注册被拒；Round/Branch/Relationship 可注册；`addTurn` 后 Canon 仍为空（CL-010 断言）；`describe()` 计数正确。
7. 包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；`pnpm test` 本包全绿。
8. 零禁用依赖、零新增运行时依赖（`package.json` dependencies 为空）。
