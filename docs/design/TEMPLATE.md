# Design Feature 模板（v1.0）

> **文档编号**: TEMPLATE.md（v1.0）
> **更新日期**: 2026-07-19
> **用途**: 所有 Design Feature 规格文件的模板（Feature 级 SDD），与 [features/F0XX-xxx.md](../features/) + [architecture/A0XX-xxx.md](../architecture/) 同号一一对应
> **依赖**: `[doc:../spec.md]` + `[doc:../arch.md]` + `[doc:../design.md]` + `[doc:../features/F0XX-xxx.md]` + `[doc:../architecture/A0XX-xxx.md]` + `[doc:../../../hiclaw/rules.md#第十一部分]`

---

## 模板使用规则（v1.0）

1. **D0XX 与 F0XX / A0XX 同号一一对应**：D001 对应 F001 + A001，D040 对应 F040 + A040
2. **D0XX 文件是 Feature 级 SDD**：补充详细设计视角（类签名 / 算法 / 时序 / 数据结构 / 配置项），不重复 Feature / Architecture 内容
3. **单文件 < 50KB**，超出请拆分
4. **必须填写"对应 spec.md / arch.md / design.md / F0XX / A0XX"五字段**
5. **必须**（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）
6. **每节模板要素**：关联文档引用 + 关键类/接口代码 + 关键算法 + 数据结构 + 时序图 + 错误处理 + 性能设计 + 安全设计 + 配置项 + Built to Delete/Persist 标记
7. **禁止使用全角问号 `？`**，必须用半角 `?`
8. **禁止写"待补充"占位符**——未实现部分必须明确标注 `TODO` 并记录为 Bug（T5 铁律）

---

## 复制以下内容创建新 Design Feature

```markdown
# D0XX: [Feature 标题] 详细设计

> **状态**: ⏳ pending
> **创建日期**: YYYY-MM-DD
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.X]（FR-CORE-0XX）
> **对应 arch.md**: [doc:../arch.md#§3.X]
> **对应 design.md**: [doc:../design.md#§3.X]
> **对应 Feature**: [doc:../features/F0XX-xxx.md]（同号Feature级SRS）
> **对应 Architecture**: [doc:../architecture/A0XX-xxx.md]（同号Feature级SAD）
> **依赖 ADR**: [doc:../decisions/0XX-xxx.md]（如有）

---

## 1. 详细设计上下文

### 1.1 设计问题
[这个 Feature 在详细设计层解决什么问题? 关键类 / 接口 / 算法 / 数据结构需要落地什么?]

### 1.2 设计约束
- 单向依赖约束（上层可依赖下层，下层绝对禁止 import 上层模块）
- DI 容器约束（所有依赖通过构造函数注入，由 DI 容器管理）
- Repository 层约束（所有数据库操作必须通过 Repository 层）
- 配置驱动约束（所有提示词 / 路径 / 密钥 / 端口通过 YAML 配置注入）
- 觉醒阶护栏约束（行动受觉醒阶自主范围约束）
- Plugin V3 约束（*Forge 通过 Plugin V3 四钩子注册，不直接实例化核心模块）

### 1.3 设计影响
[这个 Feature 对整体详细设计的影响? 哪些类 / 接口需要新增或修改? 哪些数据结构需要落地?]

---

## 2. 详细设计

### 2.1 类图
\`\`\`
[类图，展示核心类之间的继承 / 组合 / 依赖关系]
\`\`\`

### 2.2 接口实现
\`\`\`python
from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class D0XXComponent(ABC):
    """[组件描述，含 AI 业界概念标注]"""

    @abstractmethod
    async def method(self, input: "Input") -> "Output":
        """[方法用途，含错误场景说明]"""
        ...
\`\`\`

### 2.3 数据结构
\`\`\`python
class D0XXData(BaseModel):
    """[数据模型描述]"""
    field_id: str
    field_name: str
    created_at: datetime
    # ... 完整字段定义
\`\`\`

### 2.4 算法
\`\`\`
算法：D0XXComponent.method(input)
输入：Input
输出：Output

1. [步骤 1]
2. [步骤 2]
3. [步骤 3]
4. return output

复杂度：O(N) for N candidates
\`\`\`

---

## 3. 模块实现

### 3.1 关键代码
\`\`\`python
class D0XXComponentImpl(D0XXComponent):
    """[实现类描述]"""

    def __init__(self, dep_a: "DepA", dep_b: "DepB") -> None:
        self._dep_a = dep_a  # DI 容器注入
        self._dep_b = dep_b

    async def method(self, input: "Input") -> "Output":
        # 实现细节
        ...
\`\`\`

### 3.2 关键流程
\`\`\`
[关键业务流程，展示从输入到输出的完整路径]
Input → Validate → Process → Persist → Output
\`\`\`

### 3.3 时序图
\`\`\`
Caller ──→ D0XXComponent ──→ Dependency A
                                │
                                ↓
                            Operation
                                │
            ┌───────────────────┘
            ↓
        Dependency B
            │
            ↓
        Result
\`\`\`

---

## 4. 跨模块协作实现

### 4.1 上游依赖实现
- 依赖 [F0YY / A0YY / D0YY] 的 xxx 接口
- 调用方式：`await self._dep.method(...)`
- 错误处理：[上游失败时的处理策略]

### 4.2 下游影响实现
- 影响 [F0ZZ / A0ZZ / D0ZZ] 的 xxx 行为
- 影响方式：[下游如何感知本模块的变更]
- 兼容性：[向后兼容性保证]

### 4.3 跨模块不变量
- 跨模块不变量 1：[描述]
- 跨模块不变量 2：[描述]

---

## 5. 详细设计验收

### 5.1 功能验收
- [ ] AC-1: [功能验收点 1，对应 spec.md AC]
- [ ] AC-2: [功能验收点 2]
- [ ] AC-3: [功能验收点 3]

### 5.2 性能验收
- [ ] AC-4: 单次操作延迟 < [X]ms
- [ ] AC-5: 吞吐量 ≥ [X] QPS
- [ ] AC-6: 并发安全（N 个并发请求无竞争）

### 5.3 安全验收
- [ ] AC-7: 通过 Repository 层访问数据库（编程红线第 13 条）
- [ ] AC-8: 通过 DI 容器注入依赖（编程红线第 12 条）
- [ ] AC-9: 提示词 / 路径 / 密钥 / 端口通过 YAML 配置注入（编程红线第 11 条）
- [ ] AC-10: 觉醒阶护栏生效（行动受自主范围约束）
- [ ] AC-11: T1-T8 测试铁律全部通过

### 5.4 Build to Delete vs Built to Persist 验收
- [ ] AC-12: 所有元素已标记 Build to Delete 或 Built to Persist
- [ ] AC-13: Build to Delete 元素已配置半衰期 / TTL
- [ ] AC-14: Built to Persist 元素已通过 Repository 层持久化

---

## 6. 引用

- [doc:../spec.md#§3.X]
- [doc:../arch.md#§3.X]
- [doc:../design.md#§3.X]
- [doc:../features/F0XX-xxx.md]
- [doc:../architecture/A0XX-xxx.md]
- [doc:../decisions/0XX-xxx.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/prompts.md#P53]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架） | 开发者 Forgekin（猎犬·夏洛克） |
```

---

## 模板填写说明

### 必填字段

1. **状态**：⏳ pending / 🔄 in_progress / ✅ done / ❌ deprecated / 🚫 blocked
2. **创建日期**：YYYY-MM-DD 格式
3. **负责人**：开发者 Forgekin（猎犬·夏洛克）
4. **对应 spec.md**：引用 spec.md §3.X（FR-CORE-0XX）
5. **对应 arch.md**：引用 arch.md §3.X
6. **对应 design.md**：引用 design.md §3.X
7. **对应 Feature**：引用 features/F0XX-xxx.md（同号 Feature 级 SRS）
8. **对应 Architecture**：引用 architecture/A0XX-xxx.md（同号 Feature 级 SAD）
9. **依赖 ADR**：引用 decisions/0XX-xxx.md（如有）

### 7 节结构说明

| 节 | 标题 | 用途 |
|---|------|------|
| 1 | 详细设计上下文 | 设计问题 / 设计约束 / 设计影响 |
| 2 | 详细设计 | 类图 / 接口实现 / 数据结构 / 算法 |
| 3 | 模块实现 | 关键代码 / 关键流程 / 时序图 |
| 4 | 跨模块协作实现 | 上游依赖实现 / 下游影响实现 / 跨模块不变量 |
| 5 | 详细设计验收 | 功能验收 / 性能验收 / 安全验收 / Build to Delete/Persist 验收 |
| 6 | 引用 | 跨文档引用 |
| 7 | 变更历史 | 版本变更记录 |
