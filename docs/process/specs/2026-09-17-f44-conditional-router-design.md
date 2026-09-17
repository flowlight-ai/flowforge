# 设计文档：F44 增量一 · 声明式条件路由引擎（conditional_router 移植）

> 实例：`f44-conditional-router`
> 依据：`docs/refactor/10-stage-map.md` F44 行（`core/world_engine/ + conditional_router.py`，F029/F030）、S7（物理 AI 传感器/虚拟世界设置 stretch）、`31-stage11-sunset.md` §1 P1「实际遗留 F44-F45」
> 源：`python/legacy/core/conditional_router.py`（616 行，S11.2 归档态只读源）
> 日期：2026-09-17 ｜ 状态：设计稿
> 分级：**Bounded**（单包移植，算法自包含、无 LLM/网络/存储依赖）

## 1. 目标（Goal）· 需求清单

F44（物理 AI 传感器 + 虚拟世界设置）由两个互不耦合的可交付部分组成：

| 组成 | 源规模 | 耦合度 | 本批 |
|---|---|---|---|
| **声明式条件路由引擎** `conditional_router.py` | 616 行 | 低（仅 `tracing.get_logger`） | ✅ **本批（增量一）** |
| 世界引擎三层架构 `core/world_engine/`（F093） | 2746 行 / 14 文件 | 高（Forgekin 身份/公民/三类记忆） | 后续增量（另立实例） |

**需求**：把 `conditional_router` 的**声明式条件路由能力**移植为 FlowForge 插件包，替代硬编码 if-else 策略路由：
用条件表达式（比较/存在/包含/逻辑/类型/嵌套字段/内置函数）驱动路由决策，规则可由 YAML 声明。

**分级依据**：单包、算法自包含、纯函数为主、零外部服务依赖；无架构级决策（不涉及插件装配拓扑）。

### 1.1 需求清单

| # | 需求 | 来源 |
|---|---|---|
| N1 | 条件表达式**安全求值**：禁止任意代码执行（源码用 Python `ast` 白名单；TS 无等价物，需自研词法/语法/求值三层） | `_SafeEvaluator` |
| N2 | 支持 6 类条件：比较（含链式 `0 < x < 10`）、存在、包含、逻辑（and/or/not）、类型检查、嵌套字段（点号 + 下标） | 模块 docstring |
| N3 | 内置函数白名单：`len` / `type` / `has_error` / `retry_count` / `score_above`；**非白名单一律拒绝** | `_ALLOWED_BUILTINS` |
| N4 | 语法糖：`X contains Y` / `X exists` / `X not_empty` | `_preprocess_expression` |
| N5 | 路由规则 `RouteConfig`：name/condition/target/priority/description，**构造期即校验条件语法** | `RouteConfig._validate_condition_syntax` |
| N6 | `ConditionalRouter`：优先级降序 + 同优先级保序、首个命中即返回；`default` 兜底；未命中且无 default 报错 | `_sort_routes` / `route` |
| N7 | 规则动态增删 + 查询（`add_route`/`remove_route`/`list_routes`），增删后维持优先级序 | 同名方法 |
| N8 | YAML 声明式加载（`from_yaml`）与序列化（`to_dict`） | 同名方法 |
| N9 | 求值失败分级：表达式非法 → 上抛；求值期类型不匹配 → 跳过该路由继续 | `route` 的 `except` 分支 |

## 2. 架构（Architecture）

### 2.1 落点

```
packages/workflow/conditional-router/          # @flowforge/workflow-conditional-router
├── src/
│   ├── errors.ts          # ExpressionError（静态非法，上抛）/ EvaluationError（求值期类型错，可跳过）/ RouteResolutionError
│   ├── py-semantics.ts    # pythonEquals / pythonTypeName / pythonCompare —— Python 语义对齐（JS 语义不等价处）
│   ├── path.ts            # resolvePath(context, "state.a.b[0].c") —— 点号 + 下标路径解析
│   ├── tokenizer.ts       # 词法：数字/字符串/标识符/运算符/标点/关键字
│   ├── parser.ts          # 递归下降 → AST（含 exists/not_empty/contains 语法糖原生处理）
│   ├── evaluator.ts       # AST × context → value（白名单内置函数 + 成员/下标/链式比较/逻辑）
│   ├── expression.ts      # evaluateCondition(expr, context) 公共 API
│   ├── router.ts          # RouteConfig/RouterConfig/RouteResult 解析校验 + ConditionalRouter
│   └── index.ts           # 导出面
├── tests/
│   ├── expression.spec.ts   # N1-N4：求值正确性 + 安全拒绝
│   ├── router.spec.ts       # N5-N8：路由决策/增删/YAML/序列化
│   └── py-semantics.spec.ts # N9 + Python 语义对齐边界
├── package.json  tsconfig.json
```

### 2.2 源码 → 目标 映射（迁移即重构）

| 源码构造 | 目标实现 | 说明 |
|---|---|---|
| Python `ast.parse` + `_visit_*` 白名单 | **自研 tokenizer/parser/evaluator** | TS 无 `ast` 等价物；白名单语义由 parser「只产出受支持节点 + 未知构造即报错」保证 |
| `ast.BinOp`（未处理 → 报错） | 语法层面**不支持二元算术** | 保持源码「不支持即拒绝」语义，不做超集 |
| `_preprocess_expression` 正则改写 | parser 内**原生处理** `exists`/`not_empty`/`contains` | 正则改写是 Python 无语法扩展能力的权宜；TS 在语法层直接支持，**可观察语义不变** |
| `contains` RHS 限定字面量（正则只匹配字符串/数字） | 同限定：RHS 非字面量 → 报错 | 保持与源码一致（不做超集） |
| `operator.eq/lt/...` | `py-semantics.ts` 的 `pythonEquals` / `pythonCompare` | Python 深比较 `[1]==[1]` 为真，JS `===` 为假 → 必须对齐 |
| `type(x).__name__` 返回 `str/int/float/bool/list/dict/none` | `pythonTypeName()` | JS `typeof` 名称不同，需映射表 |
| `get_logger(...)` + 日志 | **注入式 `RouterLogger` 端口**（默认 no-op） | 仓库铁律：不硬编码、依赖注入；默认静默保持源码外部行为 |
| `from_yaml(path)` 读文件 + `yaml.safe_load` | `fromYaml(text)`（纯文本→配置）+ `fromConfig(unknown)` | 文件读取归宿主；YAML 解析用工作区既有 `yaml@^2.6.0`（governance 同款合规 host 依赖） |
| `remove_route` 抛 `KeyError` | 抛 `Error`（message 含路由名） | TS 无 KeyError；语义等价 |
| `route` 无匹配且无 default 抛 `ValueError` | 抛 `RouteResolutionError extends Error` | 语义等价，类型可辨别 |
| `to_dict()` 的 `name` 恒为 `""` | 返回**配置真实 name**（默认 `''`） | **有意的 P3 修正**：源码丢失 router 名属实现疏漏，序列化应可回读 |

### 2.3 求值失败分级（N9 关键设计）

```
ExpressionError   ← 语法错误 / 未支持构造 / 未定义变量 / 非白名单函数 / contains 非字面量
                    → route() 直接上抛（与源码 except ExpressionError: raise 一致）
EvaluationError   ← 求值期类型不匹配（1 < "a"）
                    → route() 捕获后跳过该路由继续（与源码 except Exception: continue 一致）
```

两者**互不继承**（`EvaluationError` 不继承 `ExpressionError`），以保证分级判定与源码一致。

## 3. 技术栈（Tech Stack）

TypeScript（ESM，`tsc -b` 项目引用）+ vitest 契约测试（真实 fixture，无 Mock）+ `yaml@^2.6.0`（工作区既有依赖）。

## 4. 全局约束

- 零 `@cat-cafe` / `@deepseek-ai` / `@clowder` 运行时依赖；除 `yaml` 外不新增依赖。
- 条件求值**绝不执行宿主代码**：无 `eval` / `new Function` / `vm`。
- 不移植世界引擎（本批边界）。
- 单文件 ≤ 1000 行。
- 测试铁律 T1-T9：契约测试真实数据驱动，不 Mock 被测逻辑。

## 5. 交付物清单（Deliverables）

1. `packages/workflow/conditional-router/`（`@flowforge/workflow-conditional-router`）：`src/` 9 模块 + `package.json` + `tsconfig.json`。
2. `tsconfig.host.json` 登记本项目引用。
3. `tests/` 3 个契约测试文件，覆盖 N1-N9。
4. 流程产物：本设计 + plan + review + verification。
5. 矩阵登记：`10-stage-map.md` F44 行标注「增量一 conditional_router 已交付」；S7 同步；`31-stage11-sunset.md` §1 P1 口径更新。

## 6. 决策门（DCP）

| 决策 | 选项 | 取舍 | 依据 |
|---|---|---|---|
| D1 落点 | `packages/workflow/conditional-router`（本设计） vs `packages/core/*` vs `packages/forgekin/*` | ✅ workflow/ | 用途是**工作流路由**（源码 docstring：replaces hardcoded if-else strategy routing）；`packages/workflow/` 已存在（workflow/tool-workflow/workflow-worker-thread/tool-ralph） |
| D2 语法糖实现 | parser 原生（本设计） vs 正则预处理 | ✅ parser 原生 | 避免正则的引号转义/嵌套括号脆弱性；可观察语义与源码一致 |
| D3 YAML 依赖 | 依赖 `yaml@^2.6.0`（本设计） vs 宿主注入解析器 | ✅ 依赖 | 与 `forgekin/governance` 同款既有合规 host 依赖，无需新引入 |
| D4 变量缺失语义 | 抛 `ExpressionError`（本设计，同源码） vs 视为 false | ✅ 抛错 | 静默 false 会掩盖配置错误；源码即上抛 |
| D5 二元算术 | 不支持（本设计） vs 支持 | ✅ 不支持 | 与源码一致（`BinOp` 未实现）；避免超出契约面 |

**结论**：D1-D5 均采用左侧方案。

## 7. 验收（DoD）

1. `evaluateCondition` 覆盖 N2 六类条件 + N4 三种语法糖，各有正/反例断言。
2. 安全性：`__import__`、`eval`、属性链上的函数调用、关键字参数、二元算术、切片均被拒绝（有断言）。
3. `ConditionalRouter`：优先级降序 + 同序保序 + 首命中 + default + 无匹配报错，有断言。
4. 构造期语法校验生效（非法 condition 的 `RouteConfig` 被拒绝）。
5. `fromYaml` 用真实 YAML 文本加载并决策；`toDict` round-trip 保留 name/default/routes。
6. `pythonEquals` / `pythonTypeName` / `pythonCompare` 的 Python 对齐边界有断言（`[1]==[1]` 真、`"1"==1` 假、`type([1])=='list'`、`type(1)=='int'`）。
7. `EvaluationError` 跳过路由 vs `ExpressionError` 上抛的分级有断言。
8. 包级 `tsc -p tsconfig.json --noEmit` exit 0；`oxlint` 0 error / 0 warning；`pnpm test` 本包全绿。
9. 零禁用依赖（`grep` 断言）；不出现 `eval` / `new Function` / `node:vm`。
