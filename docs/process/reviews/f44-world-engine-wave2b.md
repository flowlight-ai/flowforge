# review: F44 增量二 · 波 2b（桥接层三协议 + 运行协调器 + 四心智家族）

> 实例：`f44-world-engine-wave2b` ｜ 规格：`docs/process/specs/2026-09-17-f44-world-engine-wave2b-design.md` ｜ 计划：`docs/process/plans/2026-09-17-f44-world-engine-wave2b.md`
> 审查日期：2026-09-17 ｜ 工作流：feature ｜ 源：`world_engine` 第 3 层 + 心智家族 + prompts.yaml（1727 行）

## 阶段一：规格合规审查（Spec Compliance）

| 需求 | 落地 | 证据 |
|---|---|---|
| N1 Role Mask 五层 | ✅ `src/bridge/role-mask.ts`：五层常量/中文名/有序 SCENE·ONTOLOGY 层 + 7 个方法 | `tests/bridge.spec.ts` 4 用例 |
| N2 Canon Sync 三态闸门 | ✅ `src/bridge/canon-sync.ts`：propose/confirm/reject + `getProposal` + `canonConfirmers` + `CanonProposer` 端口 | 6 用例（含占位 worldId 回退） |
| N3 World Driver 自转 | ✅ `src/bridge/world-driver.ts`：tick / 快照 / 权限 / pending 队列 | 3 用例 |
| N4 Runtime Coordinator | ✅ `src/bridge/runtime-coordinator.ts`：三重进入校验 + exit 摘 L4/L5 + 场景内才能提议 | 5 用例 |
| N5 BridgeLayer 聚合 | ✅ `src/bridge/bridge-layer.ts`：四依赖拒空 + 四 getter + describe | 2 用例 |
| N6 四心智家族 | ✅ `src/mind-families.ts`：枚举 + 三张常量表 + 四护栏实现 + 路由器 + `postRoute` | 15 用例 |
| N7 提示词资产外置 | ✅ `assets/prompts.yaml`（261 行原样迁入，LF 无 BOM）+ 结构契约测试 | 4 用例：8 条提示词键序一致且非空、meta 齐备、CL-010 提示词含 `{turn_content}`/`should_canon` |

**铁律断言（设计 §2.3）**：CL-010（未确认时 Canon 为空 + 白名单外 confirm 返回 false + 场景内才能提议）✅｜CL-011（exit 后 L1-L3 保留、L4/L5 被摘并返回）✅｜CL-012（跨世界/冒用面具拒绝、重复进入拒绝、BridgeLayer 为聚合入口）✅｜CL-013（tick 计数与事件入队）✅｜CL-026（四家族决策 + emergency 覆盖）✅

**DCP 遵守**：D1 同包 ✅｜D2 依赖倒置 `CanonProposer`（无模块环）✅｜D3 注入式 Logger（默认静默）✅｜D4 仅内容资产、无凭空 loader ✅｜D5 四家族策略照搬 ✅｜D6 `yaml` 仅 devDependency（运行时依赖仍 `{}`）✅

**边界合规**：未改波 2a 既有模块行为（仅 `index.ts` 追加导出）；单文件 ≤ 1000 行（最大 `mind-families.ts` ≈ 250 行）；锁文件已同步并 `--frozen-lockfile` 自证 ✅

## 阶段二：质量审查（Quality）

### P1（实现缺陷，已修）
- **P1-1｜4 处编译期缺陷（全仓 `tsc -b` 抓出）**：
  1. `canon-sync.ts` 导入 `WorldEngineValidationError` 但仅用于 JSDoc → TS6133；
  2. `runtime-coordinator.ts` 私有字段 `currentScene` 与同名 getter **重名** → TS2300（两处）；
  3. `world-driver.ts` 持有 `canon` 字段但从不读取 → TS6133（源码也存了不用，属死字段）。
  **处置**：①移除未用导入（JSDoc `@throws` 保留说明）；②私有字段改名 `scene`；③不再持有 canon 字段，仅用 `requirePresent` 校验构造期依赖非空（行为不变：驱动本就不写 Canon）。
  **说明**：本批直接跑全仓 `tsc -b` 归因（吸取 2a 的 `include: ["src"]` 教训），4 处均为 `src/` 内错误；修复后全仓 292 条既有债中本包 **0** 条。

### P2（应修，已处理）
- **P2-1｜1 处测试断言与源码语义不符**：原断言 `route('f1','E6','read').decision === 'defer'` 失败——实际 E6 + 非紧急动作选中的是 **siamese**（其 `read` 在允许集内 → `allow`），hotfix 仅在 `emergency` 标志或 `hotfix`/`rollback`/`force_push` 动作下选中。
  **处置**：按源码实态修正断言，并补一条显式断言 `selectFamily('E6','read') === 'siamese'` 固化这一易误读的行为。**是断言错，非实现错**（实现照搬源码未改）。

### P3（可延后，已登记）
- **P3-1｜源码自身两处表述不一致（照搬未改）**：`FAMILY_AWAKENING_RANGE` 声明 ragdoll=E1-E2 / maine_coon=E2-E3 / siamese=E3-E4 / hotfix=E5-E6，但 `selectFamily` 的实际边界是 E1-E2→ragdoll、E3→maine_coon、E4→siamese、E5-E6→siamese（除紧急动作）。常量表与路由函数在边界上不一致，已在文件头注释标明，未擅自统一（统一会改变已移植行为）。
- **P3-2｜`takeOffSceneLayers` 返回顺序确定化**：源码遍历 `frozenset`，返回顺序不确定；本包用有序常量数组（固定 L4→L5）。属行为改进，已注释。
- **P3-3｜`route()` 不再修改调用方 context**：源码把 `forgekin_id`/`awakening_stage` 写回调用方字典；本包写入副本，调用方无副作用。已在文件头与测试断言（`expect(context).toEqual({target:'main'})`）固化。
- **P3-4｜`world-of-<roundId>` 占位 worldId 保留**：Turn 不直接携带 `worldId`（经 round→scene→world 关联），源码用占位符。本包保留该回退（有断言），并允许宿主显式注入 `worldId`；生产环境应由 WorldLayer 查询。

## 审查结论

- 规格合规：**通过**（N1-N7 全落地，五条铁律有断言，DCP D1-D6 遵守，边界无越界）
- 质量：**通过**（P1-1 四处编译缺陷已修；P2-1 断言已按源码实态修正；P3 四项登记延后）
- 放行至 verify 阶段：**是**
