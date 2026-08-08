# 第八部分：FlowForge 与 *Forge 架构边界验证（P8A 核心铁律）

> **来源**：生态规范大全原件 第八部分
> **关联**：[doc:rules/02-core-architecture-principles.md]（核心架构原则） | [doc:rules/01-architecture-overview.md#1.4]（目录结构约定）

---

## 8.1 验证要点

```
请严格验证 FlowForge 与各 *Forge 项目之间的架构边界，这是整个生态的根基铁律。

## 核心铁律：配置驱动 > 代码继承 > 独立实现

1. FlowForge 是纯通用框架，不包含任何业务逻辑
2. *Forge 只允许 config/web/app/plugins.py/docs/tests 六类文件
3. 所有 Agent/Tool/Loop/Workflow 通过 Plugin 协议注册
4. 禁止 *Forge 独立实现 Orchestrator/Memory/Repository/DI/Scheduler/Database
5. 禁止 *Forge 中创建 Agent 基类（如 BaseXxxAgent）
6. 禁止 *Forge 中创建独立 SDK 封装
```

## 8.2 代码全量扫描 8 大类（P14A）

1. 硬编码与配置外置（铁律5）
2. 空实现与占位代码（铁律2+5）
3. 绕过框架（铁律3+4+6）
4. 代码规范
5. 重复代码
6. 测试覆盖
7. API与路由
8. 数据库与模型

---

> **本文件来源**：生态规范大全原件 第八部分 FlowForge 与 *Forge 架构边界验证
