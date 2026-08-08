# NovelForge 模板（NF1-NF8）

> **本文件内容**：NovelForge（AI 小说创作工厂）专用提示词模板
> **适用项目**：NovelForge
> **端口**：8003/5177
> **关键目录**：novelforge/

---

## 5.1 创作全流程

### NF1 小说创作全流程验证

```
请验证NovelForge的小说创作全流程：大纲策划→人物设定→章节编排→逐集创作→审核→补发/重写。
确保连载场景的Agent协作系统正常工作，且通过Helm界面可以完整追踪执行过程。
```

### NF2 八大创作阶段验证

```
请验证NovelForge的8个创作阶段：
1. 概念孵化 — 创意总监+市场分析(Graph of Thoughts)，Human强制
2. 大纲编制 — 大纲Agent(Plan-and-Execute + Agent-as-Judge)，Human强制
3. 风格校准 — 写手Agent(Reflexion)，Human强制
4. 分章写作 — 写手Agent(Reflexion)，SOUL风格注入
5. 章节自审/一致性检查 — 一致性检测Agent(ReAct)
6. 润色优化 — 润色Agent(ReWOO + 对比确认)
7. 全集通读 — 通读Agent(Graph of Thoughts)，Human强制
8. 完稿审核 — 情感+结构+出版顾问(Multi-Agent合议)，Human强制
每个阶段用真实小说创作验证，确保质量门检查正确。
```

---

## 5.2 上下文与一致性

### NF3 五层上下文管理验证

```
请验证NovelForge的五层上下文管理（解决100万字超窗口问题）：
1. L1全文 — 所有章节完整文本（SQLite + 向量索引）
2. L2章摘要 — 每章200字摘要
3. L3卷摘要 — 每卷（10章）500字摘要
4. L4全书摘要 — 1000字全书梗概 + 人物弧光
5. 世界状态表 — 结构化JSON（人物/时间线/伏笔/战力/地理）
验证写第N章时的输入组装：L4+L3+L2+向量检索+第N-1章全文+SOUL参数
```

### NF4 SOUL风格参数验证

```
请验证NovelForge的SOUL风格参数系统：
1. 5个核心维度：叙事视角/语言风格/描写倾向/对话风格/节奏倾向
2. 3个反馈维度：作家特别要求/预设标签/段落级标注
3. 验证SOUL在风格校准阶段写入
4. 验证后续所有章节的system prompt均注入SOUL参数
5. 验证不同SOUL配置生成的内容风格确实不同
```

### NF5 一致性检测验证

```
请验证NovelForge的一致性检测系统：
1. 每5/10章自动触发一致性检测
2. 5个专用Tool：search_character/search_timeline/check_foreshadowing/verify_power_system/compare_geography
3. 验证伏笔状态追踪：伏笔回收率>=80%
4. 验证人物性格一致性
5. 验证逻辑矛盾自检
6. 验证全局一致性分析
```

---

## 5.3 审核与质量

### NF6 七道质量门验证

```
请验证NovelForge的7道质量门：
QG-1 概念孵化→大纲编制：logline+selling_point+world_setting+main_characters非空
QG-2 大纲编制→风格校准：outline_score>=60
QG-3 风格校准→分章写作：style_confirmed==true
QG-4 分章写作→润色优化：review_score>=70
QG-5 全集通读→完稿审核：foreshadowing_recovery_rate>=0.8
QG-6 完稿审核→完成：author_confirmed==true
每道质量门用一个不达标的场景验证拦截是否生效。
```

### NF7 盲评与仲裁验证

```
请验证NovelForge的ReviewOrchestrator盲评+加权+仲裁：
1. 三个评论Agent并行盲评（asyncio.gather）
2. 加权平均分：emotion 40% + structure 35% + prose 25%
3. 评分标准差>20时触发仲裁Agent
4. 加权平均<70打回重写，>=70通过
5. 验证Reflexion 2轮不达标自动降级（缩减字数目标20%）
```

---

## 5.4 项目管理

### NF8 冻结与续写验证

```
请验证NovelForge的冻结/解冻续写功能：
1. 作家中途放弃 → 自动保存快照 → frozen状态
2. 解冻续写：从检查点恢复，继续创作
3. 验证跨天审核持久化：审核暂停期间状态不丢失
4. 验证多版本管理：章节版本历史、版本diff、版本回滚
5. 验证回溯修改：删除整条角色线时触发回溯修改Workflow
```
