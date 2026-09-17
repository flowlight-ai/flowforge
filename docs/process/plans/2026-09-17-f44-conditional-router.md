# plan: F44 增量一 · 声明式条件路由引擎（conditional_router 移植）

> 实例：`f44-conditional-router` ｜ 规格（Spec）：`docs/process/specs/2026-09-17-f44-conditional-router-design.md` ｜ 工作流：feature

**目标（Goal）**：把 `python/legacy/core/conditional_router.py`（616 行）移植为 `@flowforge/workflow-conditional-router`，提供安全条件表达式求值 + 声明式路由决策（设计 §1 N1-N9）。
**架构（Architecture）**：见设计 §2.1——`src/` 9 模块（errors / py-semantics / path / tokenizer / parser / evaluator / expression / router / index）；`tests/` 3 个契约测试文件。
**技术栈（Tech Stack）**：TypeScript ESM + vitest（真实 fixture）+ `yaml@^2.6.0`。

## 全局约束
- 零 `@cat-cafe` / `@deepseek-ai` / `@clowder` 运行时依赖；除 `yaml` 外不新增依赖。
- **禁止** `eval` / `new Function` / `node:vm`（安全性由自研 parser 白名单保证）。
- 单文件 ≤ 1000 行；不移植世界引擎（本批边界）。

## 任务清单

### 任务 1：包脚手架 + 语义基座（errors / py-semantics / path）

- [ ] **步骤 1：建包骨架**——`packages/workflow/conditional-router/{package.json,tsconfig.json,src,tests}`，`package.json` 沿用 `@flowforge/util-stdlib` 同构（`type: module`、main `lib/index.js`、types `lib/types/index.d.ts`、exports 含 `./src/*`），name `@flowforge/workflow-conditional-router`，dependencies 仅 `yaml: ^2.6.0`。

```json
{
  "name": "@flowforge/workflow-conditional-router",
  "version": "0.1.0-rc.5",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dependencies": { "yaml": "^2.6.0" },
  "license": "MIT"
}
```

- [ ] **步骤 2：`src/errors.ts`**——三个**互不继承**的错误类型（设计 §2.3）：`ExpressionError`（静态非法→上抛）、`EvaluationError`（求值期类型错→可跳过）、`RouteResolutionError`（无匹配且无 default）。

```ts
export class ExpressionError extends Error {
  constructor(message: string) { super(message); this.name = 'ExpressionError'; }
}
export class EvaluationError extends Error {
  constructor(message: string) { super(message); this.name = 'EvaluationError'; }
}
export class RouteResolutionError extends Error {
  constructor(message: string) { super(message); this.name = 'RouteResolutionError'; }
}
```

- [ ] **步骤 3：`src/py-semantics.ts`**——对齐 Python 语义：`pythonEquals`（深比较：`[1]==[1]` 真、`"1"==1` 假、`null==null` 真）、`pythonTypeName`（`str/int/float/bool/list/dict/none`）、`pythonCompare`（数字/字符串可比较，跨类型抛 `EvaluationError`）。

- [ ] **步骤 4：`src/path.ts`**——`resolvePath(context, "state.audit_result.score")` 与下标 `"state.list[0].field"`；缺失路径抛错（供 `exists`/`not_empty` 捕获判定）。

- [ ] **步骤 5：先红后绿测试**——`tests/py-semantics.spec.ts`：先仅写断言（红：模块未实现），再实现至全绿。覆盖设计 §7.6——`pythonEquals([1],[1])` 为真、`pythonEquals('1',1)` 为假、`pythonTypeName([1])==='list'`、`pythonTypeName(1)==='int'`、`pythonTypeName(null)==='none'`、`resolvePath` 点号+下标嵌套、缺失路径抛错、`pythonCompare(1,'a')` 抛 `EvaluationError`。测试通过后再进入任务 2。

```ts
import { describe, expect, it } from 'vitest';
import { pythonEquals, pythonTypeName, pythonCompare } from '../src/py-semantics.js';
import { resolvePath } from '../src/path.js';
import { EvaluationError } from '../src/errors.js';

describe('py-semantics', () => {
  it('deep-equals arrays like Python', () => {
    expect(pythonEquals([1, 2], [1, 2])).toBe(true);
    expect(pythonEquals('1', 1)).toBe(false);
  });
  it('maps JS values to Python type names', () => {
    expect(pythonTypeName(1)).toBe('int');
    expect(pythonTypeName(1.5)).toBe('float');
    expect(pythonTypeName([1])).toBe('list');
    expect(pythonTypeName(null)).toBe('none');
  });
  it('resolves dotted + indexed paths', () => {
    expect(resolvePath({ state: { list: [{ s: 3 }] } }, 'state.list[0].s')).toBe(3);
  });
  it('raises EvaluationError on cross-type comparison', () => {
    expect(() => pythonCompare(1, 'a', '<')).toThrow(EvaluationError);
  });
});
```

### 任务 2：表达式引擎（tokenizer / parser / evaluator / expression）

- [ ] **步骤 1：`src/tokenizer.ts`**——词法分析：数字（含小数）、字符串（单/双引号 + 转义）、标识符/关键字（`and or not is in exists not_empty contains true false none`）、运算符（`== != < <= > >= - ( ) [ ] . ,`）；非法字符抛 `ExpressionError`。

- [ ] **步骤 2：`src/parser.ts`**——递归下降生成 AST，文法与源码白名单**严格同面**（设计 §2.2）：`or → and → not → comparison(链式) → unary(-) → postfix(. [ ]) → primary(字面量/标识符/调用/括号)`；`exists` / `not_empty` / `contains` 在语法层原生处理（`contains` RHS 限字面量）；**二元算术不实现**（`1+2` 必须报错，与源码 `BinOp` 未支持一致）。

- [ ] **步骤 3：`src/evaluator.ts`**——AST × context 求值：变量解析（未定义 → `ExpressionError`）、成员/下标访问、链式比较、`and/or/not`、一元 `-`；内置函数白名单 `len/type/has_error/retry_count/score_above`（非白名单 → `ExpressionError`；关键字参数 → `ExpressionError`）；`type()` 经 `pythonTypeName`；`exists`/`not_empty` 走 `resolvePath` 容错判定。

- [ ] **步骤 4：`src/expression.ts`**——公共 API `evaluateCondition(expression, context): boolean`（`Boolean()` 收口），导出 `parseCondition` 供路由器构造期校验复用。

- [ ] **步骤 5：先红后绿测试**——`tests/expression.spec.ts`：先写断言（红：模块未实现），再实现至全绿。覆盖设计 §7.1-§7.2：比较（`state.score >= 0.8`、链式 `0 < state.n < 10`）、存在（`state.topic exists`）、包含（`state.tags contains "ai"`、`"ai" in state.tags`）、非空（`state.reason not_empty`）、逻辑（`and/or/not`）、嵌套（`state.audit_result.score`、`state.topic_list[0]`）、内置（`len(state.list) >= 3`、`type(state.list) == "list"`、`has_error()`、`retry_count()`、`score_above(0.5)`）；**安全拒绝**：`__import__('os')`、`eval('1')`、`os.system('x')`、`len(a=1)`、`1 + 2`、`state.tags[0:2]`、未定义变量均抛 `ExpressionError`。测试通过后再进入任务 3。

```ts
import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../src/expression.js';
import { ExpressionError } from '../src/errors.js';

describe('evaluateCondition', () => {
  const ctx = { state: { score: 0.9, topic_list: ['a', 'b'], audit_result: { score: 0.7 } } };
  it('evaluates comparisons and chained comparisons', () => {
    expect(evaluateCondition('state.score >= 0.8', ctx)).toBe(true);
    expect(evaluateCondition('0.5 < state.score < 1', ctx)).toBe(true);
  });
  it('supports dot and index paths', () => {
    expect(evaluateCondition('state.audit_result.score == 0.7', ctx)).toBe(true);
    expect(evaluateCondition('state.topic_list[0] == "a"', ctx)).toBe(true);
  });
  it('rejects non-whitelisted calls and binary arithmetic', () => {
    expect(() => evaluateCondition("__import__('os')", ctx)).toThrow(ExpressionError);
    expect(() => evaluateCondition('1 + 2 > 1', ctx)).toThrow(ExpressionError);
  });
});
```

### 任务 3：路由引擎（router / index / 包登记）

- [ ] **步骤 1：`src/router.ts`**——`RouteConfig`/`RouterConfig`/`RouteResult` 类型 + `parseRouteConfig`/`parseRouterConfig`（**构造期即校验条件语法**，非法 → `ExpressionError`）；`ConditionalRouter`：优先级降序稳定排序、`route()` 首命中返回、`default` 兜底、无匹配抛 `RouteResolutionError`、`addRoute`/`removeRoute`/`listRoutes`（增删后维持优先级序）、`fromConfig`/`fromYaml`（`yaml` 解析）/`toDict`（保留 name/default/routes）；注入式 `RouterLogger` 端口（默认 no-op）；求值失败分级按设计 §2.3（`ExpressionError` 上抛、`EvaluationError` 跳过该路由）。

- [ ] **步骤 2：`src/index.ts`**——导出公共面：`evaluateCondition`、`resolvePath`、`ConditionalRouter`、类型（`RouteConfig`/`RouterConfig`/`RouteResult`/`RouterLogger`）、错误类型。

- [ ] **步骤 3：包登记**——`tsconfig.host.json` references 增补 `./packages/workflow/conditional-router`；确认 `pnpm-workspace.yaml` 的 glob 已覆盖（无需改动则记录）。

```json
{ "path": "./packages/workflow/conditional-router" }
```

- [ ] **步骤 4：先红后绿测试**——`tests/router.spec.ts`：先写断言（红：模块未实现），再实现至全绿。覆盖设计 §7.3-§7.5、§7.7：优先级降序 + 同优先级保序 + 首命中、`default` 兜底、无匹配抛 `RouteResolutionError`、非法 condition 构造即拒、`addRoute`/`removeRoute`/`listRoutes`（含删除不存在路由抛错）、`fromYaml` 用真实 YAML 文本决策、`toDict` round-trip 保留 name/default/routes、`EvaluationError` 跳过该路由而 `ExpressionError` 上抛。测试通过即为本包 DoD。

```ts
import { describe, expect, it } from 'vitest';
import { ConditionalRouter } from '../src/router.js';

describe('ConditionalRouter', () => {
  it('picks the highest-priority matching route', async () => {
    const router = new ConditionalRouter([
      { name: 'hot', condition: "state.urgency == 'high'", target: 'hot_strategy', priority: 10 },
      { name: 'deep', condition: "state.intent == 'deep'", target: 'deep_strategy', priority: 5 },
    ], 'trending');
    const result = await router.route({ state: { urgency: 'high', intent: 'deep' } });
    expect(result.target).toBe('hot_strategy');
    expect(result.matchedRoute).toBe('hot');
  });
  it('falls back to default and loads from YAML', async () => {
    const router = ConditionalRouter.fromYaml('name: r\ndefault: fallback\nroutes:\n  - name: a\n    condition: "state.x exists"\n    target: t\n');
    expect((await router.route({ state: {} })).target).toBe('fallback');
  });
});
```

### 任务 4：矩阵登记 + 验证 + 提交

- [ ] **步骤 1：矩阵登记**——`10-stage-map.md` F44 行补「增量一 conditional_router 已交付」；S7 行同步；`31-stage11-sunset.md` §1 P1 遗留口径更新为「F44 世界引擎（增量二）+ F45 + C51 残余(B21) + stretch」。

```md
| F44 | 物理 AI 传感器 + 虚拟世界设置 | core/world_engine/ + conditional_router.py（F029/F030） | stretch | 🟦（**增量一 ✅ 2026-09-17**：`@flowforge/workflow-conditional-router` 落 `packages/workflow/conditional-router`——安全条件表达式求值 + 声明式路由；**增量二待做**：`world_engine/` 三层架构 2746 行） |
```

- [ ] **步骤 2：验证证据**——`npx vitest run packages/workflow/conditional-router`、包级 `tsc -p tsconfig.json --noEmit`、`npx oxlint`、禁用依赖与 `eval`/`new Function`/`node:vm` 的 `grep` 扫描，逐条 `ff_dev evidence` 登记；**测试通过**为准入条件。

```bash
npx vitest run packages/workflow/conditional-router
cd packages/workflow/conditional-router && npx tsc -p tsconfig.json --noEmit
cd /d/software/fl/flowlight/flowforge && npx oxlint packages/workflow/conditional-router
grep -rn "eval(\|new Function\|node:vm\|@cat-cafe/\|@deepseek-ai/\|@clowder/" packages/workflow/conditional-router/src
```

- [ ] **步骤 3：提交**——`./mgr sync "feat(workflow): F44 增量一 声明式条件路由引擎 conditional_router 移植 [sherlock]" --body "…"`（提交信息含实例名与验证结论）。

## 计划自审清单
- [ ] 覆盖设计 §5 交付物 1-5 与 §7 DoD 1-9
- [ ] 无占位符；每任务含 `tests/` 路径与可复算命令
- [ ] 每任务遵循先红后绿（测试通过为进入下一任务的前置）
- [ ] 五个 DCP 决策（D1-D5）在设计中已记录取舍

## 校验登记
`ff_dev gate f44-conditional-router plan --evidence docs/process/plans/2026-09-17-f44-conditional-router.md` → 通过后 `ff_doctor plan` 本文件合规。
