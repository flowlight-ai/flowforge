# 设计文档：F44 增量二 · 波 2b（桥接层三协议 + 运行协调器 + 四心智家族）

> 实例：`f44-world-engine-wave2b`
> 依据：`docs/refactor/10-stage-map.md` F44 行 / S7、`docs/process/specs/2026-09-17-f44-world-engine-wave2a-design.md`（波 2a）
> 源：`python/legacy/core/world_engine/{role_mask,canon_sync,driver,coordinator,bridge,mind_families}.py` + `config/prompts.yaml`（1727 行，S11.2 归档态只读源）
> 日期：2026-09-17 ｜ 状态：设计稿
> 分级：**Architectural**（跨层协议边界 + 协调者依赖倒置 + 护栏决策契约）

## 1. 目标（Goal）· 需求清单

波 2a 已交付「核心身份层 + 世界层 + 三路记忆」。本波补齐 F093 第 3 层——**桥接层**：Core Identity 与 World 之间的**唯一通道**（CL-012），
以及独立于三层的**四心智家族护栏**（CL-026）。

| 需求 | 源模块 | 源行数 |
|---|---|---|
| N1 Role Mask 五层分类与独立 wear/take_off | `role_mask.py` | 213 |
| N2 Canon Sync Protocol 三态流程（propose/confirm/reject）+ 提案审计 | `canon_sync.py` | 319 |
| N3 World Driver 世界自转（tick / 状态快照 / Canon 写入权限） | `driver.py` | 172 |
| N4 Runtime Coordinator「导演」（场景进出 + 委托入典 + 身份校验） | `coordinator.py` | 213 |
| N5 BridgeLayer 三协议 + coordinator 聚合（唯一通道） | `bridge.py` | 135 |
| N6 四心智家族护栏（Ragdoll / Maine Coon / Siamese / hotfix）+ 路由器 | `mind_families.py` | 414 |
| N7 世界引擎提示词资产外置（8 条提示词 + meta） | `config/prompts.yaml` | 261 |

### 1.1 需求清单（细项）

| # | 需求 | 覆盖缺陷 |
|---|---|---|
| N1 | `RoleMaskLayer` 五层（L1 路由 / L2 基础设施 / L3 本体能力 / L4 场景皮肤 / L5 世界内状态）+ `sceneLayers`/`ontologyLayers` + 中文名；`RoleMask` 支持 `wear`/`takeOff`/`takeOffSceneLayers`/`getActiveMask`/`getLayer`/`isWearing`/`describe` | CL-011 |
| N2 | `CanonSyncProtocol`：`proposeCanon`（`isCanon=true` 拒绝、空 proposer 拒绝、返回 proposalId）、`confirmCanon`（**仅 operator / canon_driver**，写 Canon + 标记 Session 副本 + 状态 confirmed）、`rejectCanon`（任何人可拒、reason 必填、状态 rejected）、`getProposal`、`canonConfirmers()` | CL-010 / CL-012 |
| N3 | `WorldDriver`：`tick()` 递增并产出世界事件入 pending 队列、`getWorldState()` 快照、`canWriteCanon(actor)`（白名单）、`getPendingEvents`/`clearPendingEvents` | CL-013 / CL-021 |
| N4 | `RuntimeCoordinator`：`enterScene`（场景归属 + **RoleMask 持有者与 CoreIdentity 一致**双重校验、已在场景拒绝）、`exitScene`（摘 L4/L5 并返回所摘面具）、`proposeCanon`（不在场景拒绝，委托 CanonSync）、`describe` | CL-012 |
| N5 | `BridgeLayer`：持有三协议 + coordinator，构造拒空，`describe()` 汇总 | CL-012 |
| N6 | 四家族护栏：`MindFamily` 枚举 + 觉醒阶范围 / 护栏强度 / 允许动作三张常量表 + `GuardrailHook` 抽象 + 四实现 + `MindFamilyRouter`（emergency 强制 HOTFIX、按觉醒阶选家族、`route`/`postRoute`） | CL-026 |
| N7 | `prompts.yaml` 作为**内容资产**迁入包内 `assets/`，结构契约测试锁定 8 条提示词与 meta | 铁律 5 / P16 |

## 2. 架构（Architecture）

### 2.1 落点（续波 2a 同一包）

```
packages/forgekin/world-engine/
├── src/
│   ├── (波 2a 既有 12 模块不变)
│   ├── logger.ts                    # 注入式 Logger 端口（默认静默）——N6 需要
│   ├── bridge/
│   │   ├── role-mask.ts             # N1
│   │   ├── canon-sync.ts            # N2
│   │   ├── world-driver.ts          # N3
│   │   ├── runtime-coordinator.ts   # N4
│   │   └── bridge-layer.ts          # N5
│   ├── mind-families.ts             # N6
│   └── index.ts                     # 追加导出
├── assets/
│   └── prompts.yaml                 # N7（源 config/prompts.yaml 原样迁入）
└── tests/
    ├── bridge.spec.ts               # N1-N5
    ├── mind-families.spec.ts        # N6
    └── prompts-asset.spec.ts        # N7
```

### 2.2 源码 → 目标 映射（迁移即重构）

| 源码构造 | 目标实现 | 说明 |
|---|---|---|
| `coordinator.py` 通过 `bridge.canon_sync_protocol` 委托入典，`bridge.py` 又持有 coordinator | **依赖倒置**：`RuntimeCoordinator` 依赖最小端口 `CanonProposer { proposeCanon(turn, proposer) }`，不引用 `BridgeLayer` | Python 靠字符串/运行时打破循环；TS 模块循环导入会真的成环。行为等价（`BridgeLayer` 组装时把 canonSync 传给 coordinator） |
| `logger = get_logger(...)`（模块级单例） | `src/logger.ts` 的 `Logger` 端口 + `silentLogger`，由 `MindFamilyRouter` 构造注入 | 仓库铁律：不硬编码、依赖注入；默认静默保持源码外部行为 |
| `RoleMaskLayer(int, Enum)` | `const ROLE_MASK_LAYERS = [1,2,3,4,5] as const` + 派生联合类型 + `SCENE_LAYERS`/`ONTOLOGY_LAYERS` 常量数组 | Python 用 frozenset（**迭代顺序不确定**，`take_off_scene_layers` 返回顺序随机）；TS 用有序数组，结果确定 |
| `wear` 的 `isinstance(layer, RoleMaskLayer)` 检查 | `assertRoleMaskLayer(layer)` 运行时校验 | TS 类型层已限制，运行时再兜一层（对齐源 `TypeError`） |
| `CanonProposal` 可变普通类 | `CanonProposal` 接口 + 协议内部持有可变状态（状态机） | 提案是协议私有状态，保留可变 |
| `FAMILY_AWAKENING_RANGE` 等三张表 | 同名常量（`ReadonlyMap`） | 逐值照搬，含源码中与 `select_family` 边界不一致之处（见 P3-1） |
| `get_pending_events` / `clear_pending_events` | 同名方法（返回拷贝 / 清空） | — |
| `config/prompts.yaml` | `assets/prompts.yaml` 原样迁入 + 结构契约测试 | 源码无 loader（无任何 `.py` 引用），故**不新增运行时 loader**；渲染/接线归宿主（与 B19 技能内容资产同法） |

### 2.3 铁律落点（可测试断言）

| 铁律 | 落点 | 断言 |
|---|---|---|
| CL-010 RP 台词不自动入典 | `proposeCanon` 只建 pending；`confirmCanon` 白名单外返回 false；`WorldDriver` 的世界事件只进 pending 队列 | 未确认时 Canon 为空；白名单外 confirm 返回 false |
| CL-011 L4/L5 不污染 L3 | `exitScene` 摘 L4/L5 保留 L1-L3 | exit 后 L1/L2/L3 仍在、L4/L5 已被返回 |
| CL-012 跨层唯一通道 | `BridgeLayer` 聚合三协议；`RuntimeCoordinator` 是唯一场景进出与入典入口 | 场景内才能 `proposeCanon`；场景不属于本世界 / 面具持有者不符则拒绝进入 |
| CL-013 世界自转 | `WorldDriver.tick()` | tick 计数递增、事件入 pending、`getWorldState` 反映状态 |
| CL-026 四家族护栏 | `MindFamilyRouter.route` | 四家族各自决策（DENY / ALLOW / REQUIRE_APPROVAL / DEFER）+ emergency 覆盖 |

## 3. 技术栈（Tech Stack）

TypeScript ESM + vitest（真实数据）。prompts.yaml 的结构断言用工作区既有 `yaml@^2.6.0`（**仅测试依赖**，src 仍零依赖）。

> 依赖说明：`yaml` 作为 `devDependencies` 引入（仅测试读资产）；运行时 `dependencies` 仍为空。

## 4. 全局约束

- 零 `@cat-cafe` / `@deepseek-ai` / `@clowder` 引用；运行时零依赖。
- 单文件 ≤ 1000 行；不修改波 2a 既有模块行为（仅 `index.ts` 追加导出）。
- 新增工作区包条目已存在（本波不新增包）；**若 `package.json` 变更依赖，必须同步 `pnpm-lock.yaml`**（前两批连续踩坑）。

## 5. 交付物清单（Deliverables）

1. `src/logger.ts` + `src/bridge/*`（5 模块）+ `src/mind-families.ts` + `index.ts` 追加导出。
2. `assets/prompts.yaml`（源内容原样）。
3. `tests/{bridge,mind-families,prompts-asset}.spec.ts`。
4. 流程产物：本设计 + plan + review + verification。
5. 矩阵登记：`10-stage-map.md` F44 行/S7 行更新为「增量二全部交付，F44 关闭」；`31-stage11-sunset.md` §1 P1 遗留口径同步。

## 6. 决策门（DCP）

| # | 决策 | 选项 | 取舍 | 依据 |
|---|---|---|---|---|
| D1 | 落点 | 续用 `packages/forgekin/world-engine`（本设计）vs 新包 | ✅ 同包 | 桥接层直接依赖波 2a 的核心身份/世界层类型；拆包会产生环内依赖 |
| D2 | coordinator↔bridge 循环 | 依赖倒置为 `CanonProposer` 端口（本设计）vs 同 Python 互相引用 | ✅ 倒置 | TS 模块循环导入会形成真环；端口化后行为等价且可单测 |
| D3 | 日志 | 注入式 `Logger` 端口（本设计）vs 移植 `get_logger` | ✅ 注入 | 仓库禁硬编码；源码 logger 为模块级单例，注入后默认静默 |
| D4 | prompts.yaml | 内容资产 + 结构契约测试（本设计）vs 同时加运行时 loader | ✅ 仅资产 | 源码**无任何 loader**；凭空造 loader 属超出迁移面的新功能 |
| D5 | 护栏决策契约 | 照搬源码四家族策略（本设计）vs 统一策略表 | ✅ 照搬 | 四家族策略本就不同（DENY vs REQUIRE_APPROVAL vs DEFER），统一会改行为 |
| D6 | `yaml` 依赖 | devDependency（本设计）vs runtime dependency | ✅ dev | src 零依赖不变；仅测试解析资产 |

**结论**：D1-D6 均采用左侧方案。

## 7. 验收（DoD）

1. `RoleMask`：五层独立 wear/takeOff；`takeOffSceneLayers` 只摘 L4/L5 且返回有序结果；L1-L3 保留；非法层值运行时拒绝；`describe()` 含 `hasSceneSkin`。
2. `CanonSyncProtocol`：`isCanon=true` 的 Turn 提议抛错；空 proposer 抛错；`confirmCanon` 白名单外返回 false；确认后 Canon 有记录且 Session 副本 `isCanon=true`；重复确认返回 false；`rejectCanon` 空 reason 抛错、成功置 rejected；`getProposal` 形状完整。
3. `WorldDriver`：`tick` 递增、事件入 pending、`getWorldState` 含 tick/世界/待入典计数；`canWriteCanon` 白名单；`clearPendingEvents` 生效。
4. `RuntimeCoordinator`：跨世界场景拒绝进入；面具持有者与 CoreIdentity 不符拒绝；已在场景时重复进入抛错；不在场景时 `exitScene`/`proposeCanon` 抛错；`enterScene`→`proposeCanon`→`exitScene` 全链路可用且 exit 返回所摘 L4/L5。
5. `BridgeLayer`：构造拒空；`describe()` 含三协议名、coordinator 描述、tick 计数。
6. `MindFamilyRouter`：四家族各自决策可断言（ragdoll 高风险动作 DENY、write_doc REQUIRE_APPROVAL；maine coon 越界 DENY；siamese 越界 REQUIRE_APPROVAL；hotfix 恒 DEFER）；`emergency` 强制 HOTFIX；觉醒阶映射 E1-E2→ragdoll / E3→maine_coon / E4→siamese / E5-E6 按动作分流；`postRoute` 调用对应 hook 且记录日志。
7. `assets/prompts.yaml`：可被 `yaml` 解析；`world_engine_prompts` 含 8 条键且均为非空多行文本；`meta.version`/`engine`/`rules` 齐备。
8. 包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；`pnpm test` 本包全绿；全仓 `tsc -b` 本包归因 0；`pnpm install --frozen-lockfile` 通过。
