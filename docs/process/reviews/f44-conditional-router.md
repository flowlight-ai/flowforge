# review: F44 增量一 · 声明式条件路由引擎（conditional_router 移植）

> 实例：`f44-conditional-router` ｜ 规格：`docs/process/specs/2026-09-17-f44-conditional-router-design.md` ｜ 计划：`docs/process/plans/2026-09-17-f44-conditional-router.md`
> 审查日期：2026-09-17 ｜ 工作流：feature ｜ 源：`python/legacy/core/conditional_router.py`（616 行）

## 阶段一：规格合规审查（Spec Compliance）

| 需求 | 落地 | 证据 |
|---|---|---|
| N1 安全求值（replaces `ast` 白名单） | ✅ `src/tokenizer.ts` → `parser.ts` → `evaluator.ts` 三层自研；无 `eval`/`new Function`/`node:vm` | 扫描仅命中「断言其被拒绝」的测试用例；parser 文法即白名单 |
| N2 六类条件 | ✅ 比较（含链式）/存在/包含/三元逻辑/类型/嵌套（点号+下标） | `tests/expression.spec.ts` 24 用例覆盖 |
| N3 内置函数白名单 | ✅ `len`/`type`/`has_error`/`retry_count`/`score_above`；非白名单 → `ExpressionError` | `ALLOWED_BUILTINS` + 拒绝断言 |
| N4 语法糖 | ✅ `contains` / `exists` / `not_empty` 在 parser 原生支持 | sugar 组 5 用例 |
| N5 RouteConfig 构造期校验 | ✅ `parseRouteConfig` 编译条件；非法 → `ExpressionError` | `tests/router.spec.ts`「validates condition syntax at construction time」 |
| N6 优先级路由 | ✅ 降序稳定排序 + 首命中 + default + 无匹配抛 `RouteResolutionError` | router 组 4 用例 |
| N7 规则增删查 | ✅ 增删后恢复优先级序；删不存在名抛错 | 3 用例 |
| N8 YAML 装载 + 序列化 | ✅ `fromYaml`（真实 YAML 文本）/ `toDict` round-trip 保留 name/default/routes | 4 用例 |
| N9 求值失败分级 | ✅ `ExpressionError` 上抛 / `EvaluationError` 跳过该路由 | 「skips … EvaluationError」「propagates ExpressionError」两用例 |

**DCP 遵守**：D1 落点 `packages/workflow/conditional-router` ✅；D2 语法糖 parser 原生（无正则）✅；D3 仅 `yaml` 依赖 ✅；D4 变量缺失抛错（根变量）/成员缺失取 `none`（Python 双语义）✅；D5 二元算术不支持 ✅。

**边界合规**：未移植 world_engine（增量二）✅；单文件 ≤ 1000 行（最大 `parser.ts` ≈ 330 行）✅。

## 阶段二：质量审查（Quality）

### P1（实现缺陷，已修）
- **P1-1｜`exists` 错误复用成员访问语义**：初版 `exists`/`not_empty` 走通用求值，而通用成员访问按 Python `dict.get` 语义把缺失键当 `none`，导致 `state.absent exists` 误判为 `true`。
  **根因**：源码存在**两套**缺失键语义——表达式内的属性访问（`_visit_Attribute` → `dict.get` → `None`）与路径解析（`_resolve_path` → 抛 `KeyError` → `_exists` 吞掉转为 `False`）。移植时把两者合并了。
  **修复**：新增 `chainToPath()` 把 `exists`/`not_empty` 的操作数还原为路径字符串，复用 `path.ts` 的严格 `resolvePath`，使两套语义各自单一来源。
  **证据**：`state.absent exists === false`、`state.absent == none === true` 两条断言同时成立（此前只能满足其一）。

### P2（应修，已处理）
- **P2-1｜初版测试断言有 3 处与源码语义不符**：`no short-circuit` 用例原用缺失成员构造错误（实际返回 `none` 不报错）；`state.missing_var == 1` 期望抛错（实际为 `none == 1` → `false`）；`missing_root exists` 期望抛错（实际被 `exists` 吞掉 → `false`）。
  **处置**：按源码实态修正断言（改用越界下标构造求值期错误、区分根变量缺失 vs 成员缺失、`exists` 吞错），并在测试中加注释说明语义来源。**注意：是断言错，不是实现错**——除 P1-1 外实现未改。

### P3（可延后）
- **P3-1｜`toDict()` 修正了源码 `name: ""` 的硬编码**：本包返回配置真实 name（设计 §2.2 已记为有意修正）。若宿主依赖旧行为需另行确认——当前无下游消费者。
- **P3-2｜`exists` 动态下标**：`state.list[idx] exists` 在 Python 中会因正则只识别 `[\d+]` 而返回 `false`；本包的 parser 原生支持但 `chainToPath` 明确要求数值字面量并抛 `ExpressionError`（更可诊断）。差异已登记，无下游依赖。
- **P3-3｜`has_error()`/`retry_count()` 忽略实参**：与源码一致（源码未校验 arity），未作硬化以保持行为等价。

## 审查结论

- 规格合规：**通过**（N1-N9 全落地，DCP D1-D5 遵守，边界无越界）
- 质量：**通过**（P1-1 已修并留痕；P2-1 已修正断言；P3 三项登记延后）
- 放行至 verify 阶段：**是**
