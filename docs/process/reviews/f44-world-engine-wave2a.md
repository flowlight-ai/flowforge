# review: F44 增量二 · 波 2a（核心身份层 + 世界层 + 三路记忆）

> 实例：`f44-world-engine-wave2a` ｜ 规格：`docs/process/specs/2026-09-17-f44-world-engine-wave2a-design.md` ｜ 计划：`docs/process/plans/2026-09-17-f44-world-engine-wave2a.md`
> 审查日期：2026-09-17 ｜ 工作流：feature ｜ 源：`python/legacy/core/world_engine/`（第 1-2 层，1182 行）

## 阶段一：规格合规审查（Spec Compliance）

| 需求 | 落地 | 证据 |
|---|---|---|
| N1 9 个一等公民 + 校验 | ✅ `src/citizens.ts` 9 工厂，`extra="forbid"` / 非空 / 枚举 / `sequence>=0` 全实现 | `tests/citizens.spec.ts` 9 用例；工厂计数 = 9 |
| N2 核心身份不可变 | ✅ `src/core-identity.ts`，`Object.freeze` + `readonly`；`describeCoreIdentity` 含 `layer`/`immutable`；`verifyImprint` | 冻结改写抛 `TypeError` 断言 + `Object.isFrozen` |
| N3 Canon 记忆 | ✅ `src/canon-memory.ts`：双白名单校验、幂等、timestamp 排序、结构化 `query`、`canWrite` | `tests/memories.spec.ts` 6 用例 |
| N4 Relational 记忆 | ✅ `src/relational-memory.ts`：自动注册、时间戳兜底、双向查询、演化返回新对象 | 4 用例 |
| N5 Session 记忆 | ✅ `src/session-memory.ts`：round 分桶、隔离清理、`markTurnCanon` 只改副本、`dumpSession` | 4 用例 |
| N6 WorldLayer 聚合 | ✅ `src/world-layer.ts`：归属校验、6 类实体注册、`addTurn` 只写 Session、`describe` | `tests/world-layer.spec.ts` 7 用例 |
| N7 三路记忆端口 | ✅ `src/ports/{canon,relational,session}-memory.ts` + 三个 InMemory 实现 | 实现均 `implements` 对应 Port |

**铁律断言（设计 §2.3）**：CL-007 冻结 ✅｜CL-008 9 公民 ✅｜CL-009 三路隔离（`addTurn` 后 Canon 与 Relational 均为空的显式断言）✅｜CL-010 未确认写入返回 false + `addTurn` 不产生 Canon ✅

**DCP 遵守**：D1 落点 `packages/forgekin/world-engine` ✅｜D2 与 `cats/shared` 不合并（零 `@flowforge/cats-*` 依赖）✅｜D3 零依赖自研校验 ✅｜D4 `Object.freeze` + readonly 双保险 ✅｜D5 注入式 Clock ✅｜D6 Port + InMemory 分离 ✅｜D7 两波拆分 ✅

**边界合规**：未移植桥接层与心智家族 ✅；单文件 ≤ 1000 行（最大 `citizens.ts` ≈ 250 行）✅

## 阶段二：质量审查（Quality）

### P1（实现缺陷，已修）
- **P1-1｜测试文件类型错误逃过了包级检查**：`tests/memories.spec.ts` 用 `as ReturnType<typeof decision>` 伪造非法 `decidedBy`，被全仓 `tsc -b` 判为 TS2352（类型无重叠，需先 `as unknown`）。
  **根因**：本包 `tsconfig.json` 的 `include: ["src"]` 不含 `tests`（沿用 forgekin 包约定），**包级 `tsc -p tsconfig.json --noEmit` 天然覆盖不到测试文件**——我一度据此判定「本批零类型错误」。
  **修复**：改为 `as unknown as CanonDecision`；并把归因方法固定为**全仓 `tsc -b tsconfig.host.json` + grep 本包路径**（修复后 292 条既有债中本包 0 条）。
  **教训**：包级绿 ≠ host 项目绿；本仓既有此坑（记忆中的 B11 mcp-drift 夹具同类），已在本 review 固化方法。

### P2（应修，已处理）
无。

### P3（可延后，已登记）
- **P3-1｜`describe()` 键名由 snake_case 改为 camelCase**：源码返回 `forgekin_id` / `birth_timestamp` 等；本包按 TS 字段名（camelCase）。**理由**：无既有 TS 消费者读取该字典，且与公民模型的字段风格统一。已在 `core-identity.ts` 文件头登记。
- **P3-2｜校验强度刻意保持「与源码一致」而非统一收紧**：源码只有 `World` / `CanonDecision` / `Round` 带 `field_validator`；`Character` / `Scene` / `Branch` 等仅要求字段存在、**不拒绝空串**。本包保持该不对称（否则会静默收紧已移植调用点的契约），已在 `citizens.ts` 文件头说明。若后续要求统一收紧，应作为独立批次并评估调用点。
- **P3-3｜`CanonMemory.write` 的 docstring 与实现不一致（源码自身问题）**：源码 docstring 声明会抛 `PermissionError` / `ValueError`，实现只 `return False`。本包**按实现移植**（返回 `false`），未采纳 docstring。
- **P3-4｜`query` 过滤器形态变更**：源码用 `getattr(d, k, None) == v` 的字符串键反射；本包改为类型化 `CanonFilter { decidedBy?, worldId? }`。语义等价，但**不支持任意字段过滤**（源码可传任意键）。当前无该用法。

## 审查结论

- 规格合规：**通过**（N1-N7 全落地，DCP D1-D7 遵守，四条铁律有断言，边界无越界）
- 质量：**通过**（P1-1 已修并固化验证方法；P2 无；P3 四项登记延后）
- 放行至 verify 阶段：**是**
