# [特性名] 实施计划（plan-template）

> 用途：`plan` 阶段产物，writing-plans（②）的落盘模板。
> 落点：`docs/process/plans/YYYY-MM-DD-<feature>.md`。
> **执行者必读**：使用 subagent-driven-development（④，推荐）或 executing-plans（③）逐任务执行。
> **No Placeholders 铁律**：每一步必须包含执行者需要的真实内容（代码/命令/预期输出），
> 任何"待补充/同上/细节略"写法都会被 `ff_doctor plan` 拦截。

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `<name>` |
| 规格（design） | `docs/process/specs/YYYY-MM-DD-<topic>-design.md` |
| 工作流 | feature / greenfield / change / hotfix |

**目标（Goal）**：[一句话]
**架构（Architecture）**：[2-3 句]
**技术栈（Tech Stack）**：[关键技术]

## 全局约束（Global Constraints）

[规格"全局约束"节照抄 + 本计划补充项。每个任务隐式继承本节。]

## 任务清单

### 任务 N：[组件名]

**文件（Files）**：
- 新建：`精确/路径/文件.ts`
- 修改：`精确/路径/现有.ts:123-145`
- 测试：`tests/精确/路径/测试.ts`

**接口（Interfaces）**：
- 消费：[来自早前任务的精确签名]
- 产出：[后续任务依赖的精确函数名、参数与返回类型]

- [ ] **步骤 1：写失败测试**（RED）
（完整测试代码——真实场景数据 T2，具体断言 T3，禁 Mock LLM T1）
- [ ] **步骤 2：运行测试确认失败**
（`pnpm vitest run <路径>` + 预期失败信息）
- [ ] **步骤 3：写最小实现**（GREEN）
（完整实现代码）
- [ ] **步骤 4：运行测试确认通过**
（`pnpm vitest run <路径>` + 预期 N passed）
- [ ] **步骤 5：提交**
（mgr 命令与规范 commit 消息：`type(scope): 描述 [署名]`）

## 计划自审清单（落盘前）

- [ ] 规格覆盖：设计文档每节都能指到对应任务
- [ ] 占位符扫描：无 TBD/TODO/"以后实现"/无代码块步骤/"类似任务 N"引用
- [ ] 类型一致性：任务 N 引用的签名与任务 M 定义的一致（逐个核对）
- [ ] 每个任务含测试步骤（plan→implement 硬门禁校验项）

## 校验登记

`ff_dev gate <name> plan --evidence docs/process/plans/YYYY-MM-DD-<feature>.md`
（登记后 `ff_doctor plan <本文件>` 应输出 PASS）
