# 实施计划：示例特性（测试 fixture，合法样例）

**目标**：为 ff_dev / ff_doctor 提供一个通过 No-Placeholder 校验的合法计划样例。
**架构**：packages/plugins/dev 单包内纯函数实现，无跨包依赖，状态不外泄。
**技术栈**：TypeScript、vitest。
**规格**：规格（Spec）引用 docs/process/templates/plan-template.md 结构约定。

## 全局约束

- 提交一律走 ./mgr PR，禁止直接 push 远端。
- 测试遵守 T1-T9：禁止 Mock LLM、禁止无断言测试、禁止假数据。

### 任务 1：实现核心函数并配套测试

- [ ] 步骤 1：写失败测试 tests/example.spec.ts，断言 add(1, 2) === 3。
- [ ] 步骤 2：实现 src/example.ts 的 add 函数（下方代码全文）。
- [ ] 步骤 3：运行 pnpm vitest run，确认测试通过后走 ./mgr sync 提交。

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

```ts
import { describe, expect, it } from 'vitest'
import { add } from '../src/example.ts'

describe('add', () => {
  it('returns the sum', () => {
    expect(add(1, 2)).toBe(3)
  })
})
```
