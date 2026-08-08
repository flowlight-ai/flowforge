# DevForge 模板（DF1-DF6）

> **本文件内容**：DevForge（AI 开发工厂）专用提示词模板
> **适用项目**：DevForge
> **端口**：8002/5176
> **关键目录**：devforge/

---

## 4.1 场景自适应流程

### DF1 开发全流程验证

```
请验证DevForge的开发全流程：需求分析→架构设计→编码→代码审查→单元测试→部署→监控自愈。
确保每个环节都有对应的Agent和Tool支撑，且通过Helm界面可以完整追踪执行过程。
```

### DF2 四种任务类型流程验证

```
请验证DevForge的场景自适应流程引擎，逐一测试4种任务类型：
1. greenfield（全新项目）— IPD全流程，9个门禁（6 DCP + 3 TR），6阶段
2. feature（功能迭代）— IPD简化流程，3个门禁（2 DCP + 1 TR），5阶段
3. change（需求变更/优化）— DevOps轻量流程，2个自动门禁，4阶段
4. hotfix（Bug修复）— GitFlow热修复流程，1个门禁+自动回滚，3阶段
每种类型用真实的开发任务验证，确保门禁评审和流程跳转正确。
```

---

## 4.2 IPD门禁系统

### DF3 门禁评审验证

```
请验证DevForge的IPD门禁系统：
1. decision门禁：多维度加权评分，验证一票否决维度
2. technical门禁：技术产物专项审查
3. ci_auto门禁：lint+test+coverage自动检查
4. 三种投票策略：weighted/consensus/majority
5. 打回重试：reflexion自我修正 / regenerate完全重做
6. 超时策略：3种计时起点
7. 人工确认和升级到人工
8. 审计日志完整性
```

### DF4 14个业务Agent验证

```
请验证DevForge的14个业务Agent是否正确实现：
需求分析师(Self-Discover) → 架构师(Graph of Thoughts) → 详细设计(Plan-and-Execute)
→ 编码(Reflexion) → 测试生成(ReWOO) → 集成测试(ReAct) → 代码审核(Multi-Agent辩论)
→ 安全审查(Agent-as-Judge) → 性能分析(Agent-as-Judge) → 文档审核(Agent-as-Judge)
→ 验收(Plan-and-Execute) → 部署(ReWOO) → 运维(ReAct) → 知识管理(Plan-and-Execute)
每个Agent用真实开发任务验证，确保使用正确的执行模式。
```

---

## 4.3 金丝雀发布

### DF5 金丝雀发布与回滚验证

```
请验证DevForge的金丝雀发布与自动回滚：
1. 金丝雀阶段：10% → 50% → 100%，每阶段观测
2. 自动回滚触发条件：错误率>1% / P99延迟>2x基线 / 人工触发
3. 回滚目标：上一个稳定版本（Git tag）
4. 回滚失败时自动升级到人工处理
5. 验证审计日志记录完整的发布和回滚操作
```

---

## 4.4 安全与沙箱

### DF6 代码执行沙箱验证

```
请验证DevForge的代码执行沙箱安全机制：
1. 进程隔离：沙箱进程与主进程完全隔离
2. 资源限制：CPU/内存/磁盘/网络限制
3. 危险函数禁用：os.system/subprocess/eval/exec等
4. Git操作权限控制：仓库白名单、命令注入防护、强制推送保护
5. 部署安全：环境隔离、金丝雀发布、自动回滚
```
