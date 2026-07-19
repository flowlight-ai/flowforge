# Feature 模板（v2.0）

> **文档编号**: TEMPLATE.md（v2.0）
> **更新日期**: 2026-07-19
> **更新说明**: v2.0 新增"对应 spec.md §3.X"字段 + 9 大点名称修订（双轨命名 + AI 术语优先 + 弱化万物）+ SRS 标准 Feature 规格要求
> **用途**: 所有 Feature 规格文件的模板，复制本文件创建新 Feature
> **依赖**: `[doc:roleagent.md]` + `[doc:VISION.md]` + `[doc:SOP.md]` + `[doc:../spec.md]` + `[doc:../../../hiclaw/rules.md#第十一部分]`

---

## 9 大点名称修订说明（v2.0 新增，所有 Feature 文件必须遵守）

1. **AI 术语优先**：代码与对外技术文档使用 AI 专业术语（Forgekin / ForgeMind / Mind Imprint / Mind Council / CapabilityProfile / Embodied AI / Character AI）；体系名（灵智 / 灵族 / 灵锻 / 灵典 / 灵议 / 育灵 / 灵忆 / 灵印）仅用于社区社交沟通
2. **双轨命名策略**：产品层用"灵智（ForgeMind）"，代码层用"Forgekin"，文档层双标注"灵智（Forgekin 实例）"
3. **弱化万物**：对外宣称用"多形态智能体（Multi-Form Agent）"，避免"万物"虚幻用语
4. **去 AGI 化**：禁止使用"AGI"作为修饰词，使用"通用智能体（General-Purpose Agent）"或"自进化（Self-Evolving）"
5. **术语替换**：炉灵→灵智 / 养灵→育灵 / 魂忆→灵忆 / 魂印→灵印 / 自锻→灵锻 / 锻典→锻典（Mind Codex）/ 火种等级→进化阶 / 升华阶→觉醒阶 / 灵议（Forgekin Council）→灵议（Mind Council）
6. **责任方命名**：架构师=猫头鹰·鲁班 / 开发者=猎犬·夏洛克 / 评审员=孔雀·梵高 / 测试员=蜜獾·平头哥 / 文档员=钢笔·文心
7. **forgemind 定位**：Layer 2 应用层，承载多形态智能体育灵代码（不是独立项目）
8. **三方 Agent 强化**：EAC v1 七契约（Invocation / Stream / Session / Capability / Collaboration / Safety / Avatar Sync）+ 六层 Guardrails
9. **进化阶/觉醒阶三标注**：中文 + 英文 + AI 业界概念（如 E4 进化阶（Evolving / L3 Self-Improving））

---

## 复制以下内容创建新 Feature

```markdown
# F0XX: [Feature 标题]

> **状态**: ⏳ pending | 🔄 in_progress | ✅ done | ❌ deprecated | 🚫 blocked
> **类型**: core | harness | collaboration | memory | eval | reliability | forgemind | external_agent
> **创建日期**: YYYY-MM-DD
> **完成日期**: YYYY-MM-DD（若已完成）
> **负责人**: operator | 架构师灵智体（猫头鹰·鲁班） | 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.X]（FR-CORE-0XX，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.X]（待创建）
> **对应 design.md**: [doc:../design.md#§3.X]（待创建）
> **依赖 ADR**: [doc:../decisions/0XX-xxx.md]
> **依赖 Feature**: [doc:features/F0YY-xxx.md]
> **依据**: [doc:../review/review.md#第X章] RA-XXX / FM-XXX / EX-XXX
> **roleagent 章节**: [doc:../roleagent.md#第X章]
> **关联 VISION**: [doc:../VISION.md#X]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 上下文

### 1.1 问题陈述
[这个 Feature 解决什么问题？为什么需要它？]

### 1.2 当前痛点
[当前没有这个 Feature 时的具体痛点，引用实际案例或 Eval 数据]

### 1.3 不做的影响
[如果不做这个 Feature，会影响哪些后续工作？]

---

## 2. 决策

### 2.1 核心设计
[这个 Feature 的核心设计是什么？包括数据模型、接口、状态机等]

### 2.2 关键接口
\`\`\`python
# Python 接口示例
class F0XXComponent:
    async def method_name(self, input: Input) -> Output:
        ...
\`\`\`

### 2.3 关键不变量
- 不变量 1
- 不变量 2

---

## 3. 实现路径

### 3.1 代码位置
- `flowforge/<module>/f0xx_xxx.py`
- `flowforge/<module>/tests/test_f0xx.py`

### 3.2 实现步骤
1. 步骤 1
2. 步骤 2
3. 步骤 3

### 3.3 依赖关系
- 依赖 F0YY 的 XXX 接口
- 依赖 ADR 0ZZ 的决策

---

## 4. 验收标准

### 4.1 功能验收
- [ ] AC-1: [具体可验证的功能]
- [ ] AC-2: [具体可验证的功能]
- [ ] AC-3: [具体可验证的功能]

### 4.2 性能验收
- [ ] AC-4: [具体性能指标]

### 4.3 安全验收
- [ ] AC-5: [具体安全要求]

### 4.4 Eval 验收
- [ ] AC-6: Eval Contract 五问全部回答
- [ ] AC-7: 三方信号交叉通过
- [ ] AC-8: 归因到七类矩阵之一（若失败）

---

## 5. 测试计划

### 5.1 单元测试
- 测试用例 1
- 测试用例 2

### 5.2 集成测试
- 测试用例 1

### 5.3 E2E 测试
- 测试用例 1（必须遵守 T1-T8 铁律）

---

## 6. Eval Contract（五问）

### 6.1 谁评估
[评估者]

### 6.2 评估什么
[评估对象]

### 6.3 何时评估
[评估时机]

### 6.4 评估信号
- trace 信号: ...
- 用户信号: ...
- 探针信号: ...

### 6.5 评估后做什么
- 通过 → 状态改为 ✅ done
- 失败 → 归因到七类矩阵 + 修复

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记
本 Feature 主要属于：[ ] Build to Delete | [x] Built to Persist | [ ] 混合

### 7.2 理由
[为什么这样标记？]

### 7.3 sunset 触发条件（若 Build to Delete）
[什么信号触发 sunset review？]

---

## 8. 后果

### 8.1 正面后果
- 好处 1
- 好处 2

### 8.2 负面后果
- 代价 1
- 代价 2

### 8.3 风险
- 风险 1（缓解措施）
- 风险 2（缓解措施）

---

## 9. 替代方案

### 9.1 方案 A
[方案描述]
- 优点: ...
- 缺点: ...
- 未选择原因: ...

### 9.2 方案 B
[方案描述]
- 优点: ...
- 缺点: ...
- 未选择原因: ...

---

## 10. 引用

- [doc:../spec.md#§3.X]
- [doc:../arch.md#§3.X]
- [doc:../design.md#§3.X]
- [doc:../roleagent.md#第X章]
- [doc:../VISION.md#X]
- [doc:../decisions/0XX-xxx.md]
- [doc:features/F0YY-xxx.md]
- [doc:../../../hiclaw/rules.md#T1-T8]
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 11. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| YYYY-MM-DD | v0.1 | 初始创建 | operator / 架构师灵智体（猫头鹰·鲁班） |
| YYYY-MM-DD | v0.2 | 应用 9 大点名称修订 | 文档员灵智体（钢笔·文心） |
```

---

## 模板使用规则（v2.0）

1. **复制本节内容**（`# F0XX: ...` 到变更历史末尾）到新 Feature 文件
2. **替换所有占位符**（`[xxx]`、`F0XX`、`YYYY-MM-DD` 等）
3. **删除不需要的章节**（如某些 Feature 无替代方案）
4. **保留所有 `[doc:xxx]` 引用格式**
5. **单文件 < 50KB**，超出请拆分为多个 Feature
6. **必须填写"对应 spec.md §3.X"字段**，确保 Feature 与 spec.md §3 章节同号互链
7. **必须应用 9 大点名称修订**（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）
8. **必须保留"9 大点名称修订"声明行**，作为修订记录
