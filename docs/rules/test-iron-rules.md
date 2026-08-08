# 测试铁律 T1-T9（独立索引）

> **来源**：原 `hiclaw/rules.md` §5.5 抽取
> **用途**：本文件为测试铁律的独立索引，便于跨文档引用。规范正文见 [doc:rules/05-dev-spec.md#5.5]。
> **关联**：[doc:rules/coding-redlines.md]（编程红线 15 条） | [doc:rules/07-coding-redlines.md]（第七部分 编程红线）

---

## 一、铁律总览

| 编号 | 铁律 | 说明 |
|------|------|------|
| **T1** | **禁止使用 Mock LLM** | 所有 E2E/集成测试必须调用真实 LLM |
| **T2** | **禁止使用假数据** | 测试输入必须是真实场景数据，不得用"test"、"hello"等 |
| **T3** | **禁止跳过验证** | 必须有具体断言，不得 `status in ("completed","error")` |
| **T4** | **禁止 Mock 工具** | web_search/publish/fact_check 等必须真实调用 |
| **T5** | **未实现即 Bug** | 发现代码未实现必须记录为 Bug 并修复 |
| **T6** | **必须采集指标** | E2E 测试必须用 MetricsCollector 采集完整指标 |
| **T7** | **LLM 内容必须经 LLM 审核** | 凡 LLM 生成的内容（代码/文章/评论/文案/小说等），必须再调用 LLM 审核通过后才算验证通过（生成与审核使用不同模型） |
| **T8** | **Web 功能必须操控浏览器验证 DOM** | 凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看 DOM 确认真实成功，且对 DOM 内容调用 LLM 审核质量 |
| **T9** | **运行时数据文件必须存放 data 目录** | 禁止污染代码目录，所有运行时数据存放在 `agents/main/data/` |

---

## 二、铁律详解

### T1：禁止使用 Mock LLM

**适用范围**：所有 E2E 测试、集成测试、回归测试。

**禁止做法**：
- ❌ 用 `unittest.mock.Mock` 模拟 LLM 响应
- ❌ 用预录制的 LLM 响应回放
- ❌ 用 hash 生成假文本假装是 LLM 输出
- ❌ 用本地小模型替代 OpenRoute 调用

**正确做法**：
- ✅ 通过 OpenRoute 调用真实 LLM（豆包/Kimi/DeepSeek/通义/元宝/GLM/MiniMax）
- ✅ 使用真实模型候选链回退
- ✅ 记录真实 LLM 调用的延迟/质量分

### T2：禁止使用假数据

**禁止做法**：
- ❌ 测试输入用 `"test"`、`"hello"`、`"你好"` 等无意义内容
- ❌ 用 `uuid.uuid4()` 生成随机字符串作为输入
- ❌ 用 Lorem Ipsum 占位文本

**正确做法**：
- ✅ 测试输入必须是真实场景数据（如真实选题、真实 URL、真实用户意图）
- ✅ 数据规模与生产环境一致

### T3：禁止跳过验证

**禁止做法**：
- ❌ 断言 `status in ("completed", "error")`（这种断言永远通过）
- ❌ 只检查 HTTP 200 不检查响应内容
- ❌ 只检查退出码 0 不检查输出质量

**正确做法**：
- ✅ 必须有具体断言（如 `assert quality_score >= 0.85`）
- ✅ 必须检查 LLM 输出的实际内容质量
- ✅ 必须验证 DOM 中的具体文本（T8）

### T4：禁止 Mock 工具

**禁止做法**：
- ❌ Mock `web_search` 返回预定义结果
- ❌ Mock `publish` 返回 `{"status": "ok"}`
- ❌ Mock `fact_check` 返回硬编码通过

**正确做法**：
- ✅ `web_search` 真实调用 OpenSieve / SearXNG
- ✅ `publish` 真实发布到头条/公众号/百家号/知乎（测试环境）
- ✅ `fact_check` 真实调用 fact_check 工具

### T5：未实现即 Bug

**铁律**：发现代码未实现必须记录为 Bug 并修复，禁止"标注 TODO 跳过"。

**判定标准**：
- 函数返回 `{"status": "ok"}` 硬编码 → Bug
- 函数体只有 `pass` 或 `...` → Bug
- 函数抛出 `NotImplementedError` 但被上层 catch → Bug
- 配置文件声明的能力但代码未实现 → Bug

### T6：必须采集指标

**强制要求**：E2E 测试必须用 `MetricsCollector` 采集完整指标。

**必采指标**：
- `quality_score`：质量分
- `iterations`：迭代次数
- `strategy`：执行策略
- `execution_time`：执行耗时
- `judge_count`：评委数量
- `pass_threshold`：阈值
- 每个具体输出的细分维度分

### T7：LLM 内容必须经 LLM 审核

**铁律**：凡 LLM 生成的内容（代码/文章/评论/文案/小说等），必须再调用 LLM 审核通过后才算验证通过。

**关键约束**：
- 生成模型与审核模型**必须不同**（避免自评偏差）
- 审核维度：自然度（无 AI 痕迹）、相关性、格式、内容、连贯性
- 全部维度通过才算 PASS

### T8：Web 功能必须操控浏览器验证 DOM

**铁律**：凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看 DOM 确认真实成功。

**操作流程**：
1. 用 Playwright 操控真实浏览器（非 Mock）
2. 等待 `domcontentloaded`（不要用 `networkidle`，SPA 站点永远不空闲）
3. 检查 DOM 中的具体文本/元素
4. 对 DOM 内容调用 LLM 审核质量（与 T7 结合）

**Windows 平台注意**：
- openroute browser 必须用 `headless=False`（可见模式）
- 默认超时从 30s 提升到 60s
- 浏览器实例失效后必须重建（包括 `is_connected()` 检测和 `new_page()` 失败重试）

### T9：运行时数据文件必须存放 data 目录

**铁律**：所有运行时生成的数据文件必须存放在 `agents/main/data/` 目录下，**严禁**在代码目录中创建运行时数据文件。

**禁止做法**：
- ❌ 在 `scripts/` 下生成 `.json` 数据文件
- ❌ 在 `agents/main/` 根目录生成临时文件
- ❌ 在 `flows/` 下生成执行日志

**正确做法**：
- ✅ 所有运行时数据存 `agents/main/data/`
- ✅ 临时文件存 `agents/main/data/tmp/` 或 `tmp/`
- ✅ `.gitignore` 中排除 `agents/main/data/`

---

## 三、铁律与编程红线对应关系

| 测试铁律 | 对应编程红线 | 说明 |
|---------|------------|------|
| T1 | 红线 3 | 禁止 Mock LLM |
| T2 | 红线 4 | 禁止假数据 |
| T3 | 红线 5 | 禁止跳过验证 |
| T5 | 红线 15 | 未实现即 Bug |

详见 [doc:rules/coding-redlines.md]。

---

## 四、违反铁律的后果

**违反任一铁律的测试用例视为无效，必须重写**。

**违反任一铁律的代码修改视为作废，全部回滚**。

---

> **本文件来源**：原 `hiclaw/rules.md` §5.5 测试铁律（独立抽取）
> **规范正文**：[doc:rules/05-dev-spec.md#5.5]
> **关联文档**：[doc:prompts.md] P7（测试铁律自检）| [doc:prompts.md] P34（禁止事项清单）
