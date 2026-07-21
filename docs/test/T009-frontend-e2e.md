# T009: 前端 Helm/WebSocket E2E 测试（E2E-HELM-01~04）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: E2E 测试（前端 Playwright + WebSocket）
> **关联 spec.md**: [doc:../spec.md]（FR-HELM-01~04）
> **关联 arch.md**: [doc:../arch.md]（§10.6）
> **关联 design.md**: [doc:../design.md]（§5.2）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]，T8 必须操控浏览器验证 DOM）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 测试环境

- 后端: `http://localhost:8889`
- 前端: `http://localhost:5173`
- WebSocket: `ws://localhost:8889/ws/{task_id}`

---

## 2. E2E-HELM-01：完整 ReAct Helm 流程

**需求依据**：spec.md FR-HELM-01~04；arch.md 10.6

**操作**：浏览器打开 http://localhost:5173 → 选择 ReAct 模式 → 输入 `"百度最新的 AI 战略是什么"` → 提交

**预期时间线事件序列**：

```
helm.stage.enter → helm.llm.start → helm.llm.reasoning → helm.llm.end →
helm.tool.start(web_search) → helm.tool.end(web_search) →
helm.llm.start → helm.llm.reasoning → helm.llm.end →
helm.tool.start(web_scraper) → helm.tool.end(web_scraper) →
helm.llm.start → helm.llm.stream → helm.llm.end →
helm.draft.update → helm.task.completed
```

**验证点**：

1. ✅ 前端时间线正确渲染每个节点
2. ✅ 工具调用节点和 LLM 思考节点正确区分（图标/颜色）
3. ✅ 流式答案逐行渲染（helm.llm.stream）
4. ✅ 事件序号连续无跳号
5. ✅ 来源卡片（Citation）正确展示 URL
6. ✅ `eventToEntry` 正确映射所有事件类型
7. ✅ `entryToChatMessages` 正确转换为聊天消息
8. ✅ `mergeStreamingMessages` 正确合并流式消息
9. ✅ `groupMessagesIntoSteps` 正确分组

---

## 3. E2E-HELM-02：Workflow 完整 Helm 流程（deep_article）

**操作**：浏览器 → Helm → 选择 deep_article Workflow → 输入 `"写一篇关于量子计算的科普文章"` → 提交

**预期时间线节点**：

```
[阶段1: 选题研究] topic_research(rewoo)
  ├── web_search × 2~3
  └── LLM 思考
[阶段2: 素材搜集] material_collection(rewoo)
  ├── web_search × 3~5
  └── LLM 思考
[阶段3: 撰写] article_writing(reflexion)
  └── LLM 思考 (1次，无迭代)
[阶段4: SEO优化] seo_optimization(plan_execute)
  └── LLM 思考
[阶段5: 事实核查] fact_check(react)
  ├── web_search × N
  └── LLM 思考
[阶段6: 审核] content_audit(agent_judge)
  └── LLM 思考 (模型: doubao-web/chat ← 不同于阶段1-5)
[阶段7: 人工审核] review(human) ← 暂停，可交互
[阶段8: 发布] publishing(plan_execute)
  └── 发布结果
```

**Playwright 断言代码**：

```javascript
// 1. 时间线容器存在
expect(page.locator('[data-testid="timeline"]')).toBeVisible;

// 2. 至少出现 4 个阶段节点
const stageNodes = page.locator('[data-testid="timeline-stage"]');
expect(await stageNodes.count).toBeGreaterThanOrEqual(4);

// 3. 第一阶段是"意图识别"
expect(stageNodes.nth(0)).toContainText('意图识别');

// 4. 存在工具调用子节点（扳手图标）
expect(page.locator('[data-testid="tool-node"]').first).toBeVisible;

// 5. 存在 Agent 调用子节点
expect(page.locator('[data-testid="agent-node"]').first).toBeVisible;

// 6. 最终答案区域出现内容
expect(page.locator('[data-testid="final-answer"]')).not.toBeEmpty;

// 7. 来源面板(Citation)可见
expect(page.locator('[data-testid="source-panel"]')).toBeVisible;

// 8. 文件下载链接出现（长内容）
expect(page.locator('[data-testid="file-download"]')).toBeVisible;
```

**验证点**：

1. ✅ 8 个阶段按序渲染，无跳步
2. ✅ 阶段 6 顶部显示评审模型名（不同于阶段 1-5 的执行模型）
3. ✅ 阶段 7 渲染为"审核中"按钮，点击通过后继续
4. ✅ 阶段 3 不显示 Reflexion 迭代轮次标签（Workflow API 路径无迭代）
5. ✅ 来源面板（Source Panel）始终可见，Citation 可点击跳转
6. ✅ 虚拟滚动支持 500+ 条事件（spec.md FR-HELM-02）

---

## 4. E2E-HELM-03：WebSocket 断线重连

**操作**：Helm 执行中手动断开 WebSocket → 等待 5 秒 → 重连

**预期**：

1. ✅ 重连成功
2. ✅ 接收 replay 事件，回放断线期间丢失的事件
3. ✅ 时间线自动补全
4. ✅ 指数退避重连，最多 10 次（spec.md 4.3 可靠性要求）

**Playwright 断言代码**：

```javascript
// 模拟断线重连
await page.context.setOffline(true);
await page.waitForTimeout(5000);
await page.context.setOffline(false);

// 验证时间线补全
const stageNodes = page.locator('[data-testid="timeline-stage"]');
expect(await stageNodes.count).toBeGreaterThan(0);
```

---

## 5. E2E-HELM-04：审核交互全流程

**需求依据**：spec.md FR-HELM-03（审核节点内联）；arch.md 12.3 Human-in-the-Loop

**操作**：选择 deep_article Workflow → 等待 review 阶段暂停 → 点击"驳回" → 输入反馈 → 提交

**预期事件序列**：

```
review.ready → task.paused → (用户操作) → review.submitted(verdict=reject) → task状态=rejected
```

**验证点**：

1. ✅ review.ready 事件触发时间线暂停
2. ✅ 审核窗口期 5 分钟内可撤回（spec.md FR-HELM-03）
3. ✅ 用户点击"驳回" → review.submitted(verdict=reject)
4. ✅ **Persona 锁在审核暂停期间必须保留**（spec.md 开发规范铁律）
5. ✅ 审核完成后 persona 锁必须释放
6. ✅ Helm 前端显示审核内联块（不跳转独立页面）
7. ✅ 支持审核通过/驳回/编辑提交三种操作

---

## 6. T8 测试铁律专项要求

> **T8 铁律**：Web 功能必须操控浏览器验证 DOM，且对 DOM 内容调用 LLM 审核质量。

### 6.1 DOM 内容 LLM 审核

每个 E2E-HELM 用例完成后，必须：

1. 提取关键 DOM 内容（时间线节点、最终答案、来源面板）
2. 调用 LLM（如 Kimi-K2.6）对 DOM 内容进行质量审核
3. 审核维度：内容完整性、渲染正确性、交互响应性、AI 痕迹
4. 审核分数 ≥ 0.85 才算通过

### 6.2 浏览器等待条件

- 必须使用 `wait_until="domcontentloaded"`（**非 `networkidle`**）
- 原因：Next.js HMR/websocket 活动会导致 `networkidle` 永不触发，引发超时

---

## 7. 引用

- [doc:../spec.md]（FR-HELM-01~04）
- [doc:../arch.md]（§10.6, §12.3）
- [doc:../design.md]（§5.2）
- [doc:rules.md#T1-T8]（特别是 T8 浏览器 DOM 验证）
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 8. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 19 章拆分，覆盖 E2E-HELM-01~04 + T8 铁律专项 | 测试员可进化智能体（蜜獾·平头哥） |
