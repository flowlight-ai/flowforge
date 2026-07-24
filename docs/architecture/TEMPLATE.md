# Architecture Feature 模板（v1.0）

> **文档编号**: TEMPLATE.md（v1.0）
> **更新日期**: 2026-07-19
> **用途**: 所有 Architecture Feature 规格文件的模板（Feature 级 SAD），与 [features/F0XX-xxx.md](../features/) 同号一一对应
> **依赖**: `[doc:../spec.md]` + `[doc:../arch.md]` + `[doc:../features/F0XX-xxx.md]` + `[doc:../../CONTRIBUTING.md]`

---

## 模板使用规则（v1.0）

1. **A0XX 与 F0XX 同号一一对应**：A001 对应 F001，A040 对应 F040
2. **A0XX 文件是 Feature 级 SAD**：补充架构视角，不重复 Feature 内容
3. **单文件 < 50KB**，超出请拆分
4. **必须填写"对应 spec.md/arch.md/design.md/F0XX"四字段**
5. **必须**

---

## 复制以下内容创建新 Architecture Feature

```markdown
# A0XX: [Feature 标题] 架构设计

> **状态**: ⏳ pending | 🔄 in_progress | ✅ done
> **创建日期**: YYYY-MM-DD
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.X]（FR-CORE-0XX）
> **对应 arch.md**: [doc:../arch.md#§3.X]
> **对应 design.md**: [doc:../design.md#§3.X]（待创建）
> **对应 Feature**: [doc:../features/F0XX-xxx.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D0XX-xxx.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/0XX-xxx.md]

---

## 1. 架构上下文

### 1.1 架构问题
[这个 Feature 在架构层解决什么问题？]

### 1.2 架构约束
- 单向依赖约束
- DI 容器约束
- Repository 层约束
- 配置驱动约束

### 1.3 架构影响
[这个 Feature 对整体架构的影响？]

---

## 2. 架构设计

### 2.1 组件架构图
\`\`\`
[组件架构图，展示模块间依赖关系]
\`\`\`

### 2.2 关键架构决策
- 决策 1：xxx
- 决策 2：xxx

### 2.3 架构不变量
- 不变量 1
- 不变量 2

---

## 3. 模块设计

### 3.1 模块边界
- 模块 A：职责
- 模块 B：职责

### 3.2 接口契约
\`\`\`python
class A0XXComponent:
    async def method(self, input: Input) -> Output:
        ...
\`\`\`

### 3.3 数据流
\`\`\`
输入 → 模块 A → 模块 B → 输出
\`\`\`

---

## 4. 跨模块协作

### 4.1 上游依赖
- 依赖 F0YY 的 xxx 接口

### 4.2 下游影响
- 影响 F0ZZ 的 xxx 行为

### 4.3 跨模块不变量
- 跨模块不变量 1

---

## 5. 架构验收

### 5.1 架构契约验收
- [ ] AC-1: 单向依赖通过
- [ ] AC-2: DI 容器注入通过
- [ ] AC-3: Repository 层通过
- [ ] AC-4: 配置驱动通过

### 5.2 架构不变量验收
- [ ] AC-5: 不变量 1 通过
- [ ] AC-6: 不变量 2 通过

---

## 6. 引用

- [doc:../spec.md#§3.X]
- [doc:../arch.md#§3.X]
- [doc:../features/F0XX-xxx.md]
- [doc:../decisions/0XX-xxx.md]
- [doc:../../CONTRIBUTING.md]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架） | 架构师 Forgekin（猫头鹰·鲁班） |
```
