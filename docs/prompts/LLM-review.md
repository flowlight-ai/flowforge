# LLM 内容审核与 Web 功能验证方法论（V1-V6 + T9）

> **核心原则**：测试验证不能只看"调用是否返回无异常"，必须验证"生成内容是否正确"和"网页操作是否真正成功"。
> **铁律T7**：凡涉及LLM和内容生成的场景，必须调用LLM对生成内容审核，审核通过才算验证通过。
> **铁律T8**：凡涉及网页Web功能验证的场景，必须操控浏览器查看DOM中的功能和内容，确认真实成功才算通过。
> **铁律T9**：凡涉及运行时生成数据文件的场景，必须验证文件存放路径在 `agents/main/data/` 目录下，禁止污染 `scripts/vendor/platforms/prompts/config` 等代码目录。
> **适用项目**：FlowForge、ContentForge、DevForge、NovelForge、MallForge、OpenRoute、OpenSieve、HicLaw 全部8个项目。

---

## 标准案例模板（参考实现）

> 以下模板基于 openclaw_pkg/content 项目 `hiclaw/test/test_interact.py` 的真实实现，供其他7个项目编写 T7/T8 测试用例参考。

### T7 LLM二次审核标准案例

**场景**：评论生成后，调用 reviewer agent（与生成所用模型不同的 LLM）对评论进行二次审核，只输出 `VERDICT: PASS` 或 `VERDICT: FAIL`。

**实现要点**：
1. 生成与审核使用不同模型（creator=豆包生成，polisher=DeepSeek审核），避免同模型自评放水
2. 审核提示词只做客观拦截：指令泄露、AI痕迹、格式异常、内容违规、纯套话
3. 审核提示词明确要求"只输出 VERDICT 和 REASON"，便于程序解析
4. 解析 `VERDICT: PASS/FAIL` 作为通过判定，`REASON` 仅记录不参与判定
5. 候选链 fallback 时，跳过当前模型尝试下一个，避免单点故障

**审核提示词模板**（参考 `prompts/comment_review.j2`）：

```
你是评论审核员，负责判断评论是否合格。只拦截指令泄露、AI痕迹、格式异常、
内容违规和纯套话，不要对口语化表达过度审核。

## 审核原则
- 宁可放过，不可误杀：口语化、简短、有情绪表达都视为合格
- 只拦截明显不合格的内容

## 审核维度（仅6项客观检查）
1. 指令泄露：是否暴露了"你是xx用户"等系统提示
2. AI痕迹：是否有"作为AI"、"我是一个"等明显痕迹
3. 格式异常：是否包含 markdown 符号、JSON 结构等非自然语言
4. 内容违规：是否包含仇恨、暴力、色情等违规内容
5. 纯套话：是否为"写得真好"、"非常棒"等无信息量套话
6. 与文章无关：是否完全偏离文章主题

## 输出格式（严格）
VERDICT: PASS 或 VERDICT: FAIL
REASON: 简短说明（一句话）
```

### T8 DOM验证标准案例

**场景**：评论提交后，从子进程 stdout 解析"评论已确认发布"日志，或通过 CDP 浏览器连接目标页面，在 DOM 中查找评论内容确认真实发布。

**实现要点**：
1. 子进程 stdout 必须打印关键日志：`打开文章: {url}`、`尝试发布评论: {comment}...`、`评论已确认发布`
2. 测试程序解析 stdout 提取 (url, comment) 元组
3. Linux 平台：默认基于 stdout 日志确认（速度快，不依赖浏览器）；`--verify` 启用时使用 CDP 浏览器
4. Windows 平台：基于 stdout 日志中的"评论已确认发布"标记确认
5. 验证结果计入 `DOMVerifier.results`，由 `TestReporter` 汇总

**stdout 解析正则模板**：

```python
# 提取文章URL
url_match = re.search(r'打开文章[:：]\s*(https?://\S+)', line)

# 提取评论文本
comment_match = re.search(r'尝试发布评论[:：]\s*(.+?)\.\.\.', line)

# DOM确认日志（Windows / Linux stdout 模式）
dom_confirm_keywords = {
    "comment": "评论已确认发布",
    "reply": "回复已确认发布",
}
```

**CDP 浏览器验证模板**：

```python
# 1. 连接浏览器（CDP端口从 browser_config.json 读取）
browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
page = browser.contexts[0].pages[0]

# 2. 导航到目标文章
await page.goto(article_url)

# 3. 在DOM中查找评论文本
comment_locator = page.locator(f"text={comment_text}")
found = await comment_locator.count() > 0

# 4. 返回验证结果
return found
```

### T7/T8 联合验证流程（开关化）

**默认关闭策略**：
- 评论生成已内置 LLM 二次审核（creator→polisher），T7 仅在交叉验证时开启
- DOM 验证依赖浏览器或日志，T8 仅在需要确认真实发布时开启
- 默认关闭可大幅提升测试速度，避免重复 LLM 调用

**开关设计**：

```python
parser.add_argument("--t7", action="store_true",
                    help="启用T7 LLM二次审核（默认关闭；评论生成已含LLM审核）")
parser.add_argument("--t8", action="store_true",
                    help="启用T8 DOM验证（默认关闭；如需对发布结果做DOM校验时开启）")
```

**典型执行命令**：

```bash
# 默认（T7/T8关闭）：仅评论生成+发布，不二次验证
python3 test_interact.py --scenario all --platform toutiao --count 3

# 启用 T7：交叉验证评论质量
python3 test_interact.py --scenario content --platform toutiao --count 3 --t7

# 启用 T7+T8：完整审核链路（含CDP浏览器DOM验证）
python3 test_interact.py --scenario content --platform toutiao --count 3 --t7 --t8 --verify
```

### 跨项目适配清单

| 项目 | T7 审核对象 | T8 DOM验证对象 | 关键脚本 |
|------|-----------|---------------|---------|
| FlowForge | 流程生成内容 | 流程执行后页面状态 | flowforge/test/test_*.py |
| ContentForge | 文章/微头条内容 | 文章发布后页面 | contentforge/test/test_publish.py |
| DevForge | 代码/文档生成内容 | 部署后页面 | devforge/test/test_*.py |
| NovelForge | 小说章节内容 | 章节发布后页面 | novelforge/test/test_*.py |
| MallForge | 商品描述/文案 | 商品上架后页面 | mallforge/test/test_*.py |
| OpenRoute | 模型路由决策 | 路由配置生效后页面 | hiclaw/test/test_*.py |
| OpenSieve | 筛选结果 | 筛选结果展示页 | opensieve/test/test_*.py |

**适配步骤**：
1. 在测试脚本中添加 `--t7` / `--t8` CLI 开关，默认关闭
2. 实现 stdout 解析函数，提取待验证内容（URL、标题、正文等）
3. T7：调用 reviewer agent 审核，解析 `VERDICT: PASS/FAIL`
4. T8：基于 stdout 日志或 CDP 浏览器查找 DOM
5. 验证结果写入 `MetricsCollector` 和 `TestReporter`
6. 提供 `--verify` 启用 CDP 浏览器完整 DOM 验证

---

## V1 LLM生成内容审核验证

```
请对 {项目名} 中所有LLM生成内容的场景增加LLM审核流程，确保生成内容的质量和正确性。

审核流程：LLM生成内容 → 规则过滤（白名单/黑名单/格式校验） → LLM二次审核 → 审核通过才发布

审核维度（6项，按内容类型调整权重）：
1. 自然度 — 是否有AI生成痕迹（"作为一个AI"、免责声明、模板化表达等）
2. 相关性 — 是否与上下文/需求/输入相关，是否答非所问
3. 格式 — 是否符合预期格式（纯文本/代码/JSON/Markdown等），有无异常格式
4. 长度 — 仅极端过短或明显过长才不合格，不因字数略低于建议范围而判失败
5. 内容 — 是否含广告/引流/违规/敏感/攻击性内容，是否含"SKIP/无法处理"等错误响应
6. 连贯性 — 语句/代码/逻辑是否通顺自洽，有无语病/错乱/拼接痕迹

审核结果格式（LLM必须严格返回）：
  VERDICT: PASS  或  VERDICT: FAIL\nREASON: <原因>
- 只有 VERDICT: PASS 才放行
- 返回格式异常或调用失败时默认不通过（fail-closed）

适用场景清单（按项目逐一检查是否已接入LLM审核）：
□ FlowForge: Agent决策推理、反馈循环评估、Reflexion自修正、Agent Handoff决策、Self-Discover推理结构生成、文档园丁修复PR
□ ContentForge: 文章创作（选题→研究→写作→SEO→事实核查）、微头条创作、评论生成、回复评论、视频文案、SEO标题优化、素材抓取摘要、事实核查判断
□ DevForge: 代码生成（Reflexion自检）、需求分析文档、架构设计文档（GoT）、详细设计文档、测试用例生成、代码审核意见、安全审查报告、门禁评审决策
□ NovelForge: 小说章节创作（Reflexion）、角色对话、情节大纲、世界观设定、概念包生成、风格校准样本、章/卷/全书摘要、一致性检测、润色优化、通读报告、盲评评分
□ MallForge: 商品文案、SEO标题（多语言）、产品描述、营销文案、客服自动回复、意图分类、差评告警、选品决策
□ OpenRoute: 路由决策说明、ToolParser解析、Prompt组合注入、上下文管理去重
□ OpenSieve: 查询理解、CRAG反思、Self-RAG评估、Multi-Hop分解、内容提取、RAGAS评估
□ HicLaw: 法律文书起草、案例分析、合规说明、条款解读、Content创作引擎全场景、模型评分计算

对每个未接入审核的场景，立即实现审核流程并回归验证。
参考实现：toutiao_interactor.py / douyin_interactor.py 的 _review_comment_with_llm() 方法
```

---

## V2 LLM审核提示词设计规范

```
请检查 {项目名} 中所有LLM审核提示词是否符合以下设计规范：

1. 角色设定：必须明确"你是严格的审核员"，不能让LLM以创作者身份审核自己的内容
2. 审核维度：必须覆盖6项维度（自然度/相关性/格式/长度/内容/连贯性）
3. 字数维度：不能因字数略低于建议范围就判FAIL，仅极端过短（<5字）或过长（>200字）才不合格
4. 输出格式：必须要求LLM严格返回 VERDICT: PASS/FAIL 格式，便于程序解析
5. 上下文提供：审核时必须提供原始上下文（文章内容/视频信息/原评论），让LLM判断相关性
6. 场景区分：评论审核和回复审核应使用不同的上下文（评论用article，回复用comment+article）
7. 失败处理：审核失败时不得发布，应重新生成或跳过，不能强制发布未通过审核的内容

对每个不符合规范的审核提示词，给出修复方案并实施。
```

---

## V3 Web功能DOM验证

```
请对 {项目名} 中所有涉及网页操作的功能增加浏览器DOM验证，确保功能真正执行成功。

验证流程：功能执行完成 → 连接浏览器（CDP） → 导航到目标页面 → 查看DOM内容 → 确认结果存在

验证模式（按场景选择）：
1. 存在性验证 — 导航到目标页面，搜索标题/内容是否存在
2. 状态验证 — 导航到管理页，检查状态字段（已发布/草稿/上架/部署等）
3. 内容验证 — 打开详情页，搜索具体文本内容是否正确
4. 交互验证 — 打开目标页，检查评论/回复/点赞/提交等操作是否生效

验证要求：
1. 必须通过CDP连接真实浏览器实例，禁止Mock浏览器
2. 必须导航到真实页面，在DOM中搜索内容
3. 搜索采用模糊匹配（取前30字），支持多次滚动加载（最多5次）
4. 验证过程中必须调用LLM对DOM中获取的内容进行质量审核（T7+T8联合验证）
5. 只有DOM中确认找到目标内容且LLM审核通过才算通过

适用场景清单（按项目逐一检查是否已接入DOM验证）：
□ FlowForge: Helm界面工作区显示、任务列表过滤、步骤进度条同步、WebSocket事件推送、审核节点暂停/恢复、资源管理器高亮、Plan面板、Diff视图
□ ContentForge: 多平台发布（4平台）、Web控制台仪表盘、审核中心Human-in-the-Loop、定时任务管理、发布日志审计、Helm Studio实时观察
□ DevForge: 代码部署结果验证、CI/CD执行结果、PR状态页面、Issue状态页面、金丝雀发布监控面板、DevForge Web UI（任务/审核/代码页面）
□ NovelForge: 小说发布、章节更新页面、目录生成、NovelForge Web UI（写作/任务/世界观构建页面）
□ MallForge: 商品上架（TikTok/Amazon/Shopee）、文案发布、价格更新、库存变更、广告投放管理、客服消息回复、热榜监控爬取
□ OpenRoute: 7平台WebChat浏览器自动化（豆包/Kimi/DeepSeek/通义/元宝/GLM/MiniMax）、流式输出DOM监听、Cookie获取、路由配置生效验证
□ OpenSieve: 爬虫框架浏览器自动化（Playwright反检测）、20+搜索源爬取、图片下载（四层发现策略）、筛选结果展示、Prometheus+Grafana监控
□ HicLaw: 多平台发布（4平台）、平台互动（浏览/点赞/评论/回复）、视频发布、浏览器验证、QQ机器人消息收发、微信机器人扫码登录

对每个未接入DOM验证的场景，使用 hiclaw/test/browser_verify.py 实现验证并回归测试。
验证工具：python3 test_verify_result.py --platform <平台> --mode <模式> --account <账户> ...
```

---

## V4 测试用例DOM验证集成

```
请检查 {项目名} 的所有测试用例，确保涉及网页操作的测试都集成了浏览器DOM验证。

当前问题：测试用例只看 subprocess.returncode == 0，不检查浏览器端是否真正成功。
要求：所有涉及网页操作的测试，必须在操作完成后自动运行浏览器DOM验证+LLM内容审核。

集成方式：
1. 测试脚本通过 --verify 参数启用浏览器验证
2. 操作完成后，从stdout解析目标内容（URL、标题、评论文本等）
3. 调用 browser_verify 模块连接浏览器，导航到目标页面
4. 在DOM中搜索目标内容，确认真实存在
5. 对DOM中获取的内容调用LLM进行质量审核（T7）
6. 验证结果计入测试报告（DOM验证+LLM审核都通过才算测试通过）

检查清单（按项目逐一检查）：
□ ContentForge: test_publish.py / test_interact.py / test_weitoutiao.py / test_video_e2e.py 是否支持 --verify
□ FlowForge: 流程执行测试是否检查页面DOM结果
□ DevForge: 代码部署测试是否检查部署后页面状态
□ NovelForge: 小说发布测试是否检查发布后页面
□ MallForge: 商品上架测试是否检查上架后页面
□ OpenRoute: 路由配置测试是否检查配置生效后页面
□ OpenSieve: 筛选结果测试是否检查筛选后页面
□ HicLaw: 文书发布测试是否检查发布后页面
对每个不支持的测试文件，添加 --verify 参数和验证逻辑。
```

---

## V5 全链路验证（通用）

```
请对 {项目名} 的核心功能执行全链路验证，确保从内容生成到网页操作的每个环节都真实成功。

验证链路（T7+T8联合）：
1. LLM生成内容 → 规则过滤 → LLM审核（T7）→ 审核通过
2. 内容输出/发布到目标 → 浏览器DOM验证（T8）→ 确认成功
3. DOM中获取的内容 → LLM质量审核（T7）→ 确认内容正确
4. （如涉及交互）交互操作 → DOM验证交互结果 → LLM审核交互内容

执行步骤：
1. 运行功能测试，启用 --verify 参数
2. 检查LLM审核是否通过（看日志中 VERDICT: PASS）
3. 检查浏览器DOM验证是否通过（看日志中 ✅ 验证通过）
4. 检查DOM内容的LLM质量审核是否通过
5. 全链路通过的标志：LLM审核 PASS + DOM验证找到 + DOM内容LLM审核 PASS
```

---

## V6 验证结果报告模板

```
请按以下格式输出验证结果报告：

## 验证结果报告

### LLM内容审核结果（T7）
| 场景 | 生成内容 | 审核结果 | 审核原因 |
|------|---------|---------|---------|
| 内容生成 | 内容前30字... | ✅ PASS | - |
| 交互内容 | 内容前30字... | ❌ FAIL | 原因说明 |

### Web功能DOM验证结果（T8）
| 场景 | 验证模式 | 目标 | DOM验证结果 | 详情 |
|------|---------|------|------------|------|
| 内容发布 | 存在性 | 标题前30字 | ✅ 找到 | 页面中存在 |
| 交互操作 | 交互验证 | URL+内容 | ❌ 未找到 | 页面未找到 |

### DOM内容LLM质量审核（T7+T8联合）
| 场景 | DOM获取内容 | LLM审核结果 | 审核原因 |
|------|-----------|------------|---------|
| 内容发布 | DOM中的标题和摘要 | ✅ PASS | 内容正确 |
| 交互操作 | DOM中的评论内容 | ❌ FAIL | 质量不达标 |

### 总结
- LLM审核：X/Y 通过
- DOM验证：X/Y 通过
- DOM内容LLM审核：X/Y 通过
- 整体结论：✅ 全部通过 / ❌ 有失败项需修复
```

---

## T9 运行时数据文件存放校验

> **铁律T9**：凡涉及运行时生成数据文件（缓存、持久化记录、浏览器数据等）的场景，必须验证文件存放路径在 `agents/main/data/` 目录下，禁止污染 `scripts/vendor/platforms/prompts/config` 等代码目录。

**背景**：发现 `scripts/vendor/toutiao-publisher/replied_comments_*.json` 违规存放在 vendor 代码目录。根因是 `toutiao_interactor.py._get_replied_comments_file()` 使用了 `os.path.dirname(__file__)` 直接拼接文件名，而 `douyin_interactor.py` 写法正确（用 `Path(__file__).parent.parent.parent / "data" / "douyin"`）。

**校验步骤**：

1. **静态扫描代码**：搜索所有 `os.path.dirname(__file__)`、`Path(__file__).parent` 的使用，确认目标路径是 `data/` 目录
   ```bash
   grep -rn "os.path.dirname(__file__)" scripts/vendor/
   grep -rn "Path(__file__).parent" scripts/vendor/
   ```

2. **扫描已有违规文件**：检查代码目录下是否存在运行时数据文件
   ```bash
   find scripts/vendor/ -name "*.json" -o -name "*.db" -o -name "*.log" 2>/dev/null
   find data/ -name "*.json" -o -name "*.db" 2>/dev/null
   ```

3. **运行时验证**：执行一次完整流程后，检查 data 目录是否生成预期文件
   ```bash
   ls data/toutiao/replied_comments_*.json
   ls data/douyin/replied_*.json
   ls scripts/vendor/toutiao-publisher/*.json 2>/dev/null  # 应该为空
   ```

**正确写法模板**（参考 `douyin_interactor.py:241`）：

```python
from pathlib import Path

def _get_replied_comments_file(self) -> str:
    """缓存文件统一存放到 article-orchestrator/data/<platform>/ 目录"""
    data_dir = Path(__file__).parent.parent.parent / "data" / "toutiao"
    data_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r'[^\w\u4e00-\u9fff]', '_', account_name)
    return str(data_dir / f"replied_comments_{safe_name}.json")
```

**违规写法（必须避免）**：

```python
# ❌ 错误：写到代码所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
filepath = os.path.join(script_dir, f"replied_comments_{name}.json")

# ❌ 错误：写到 vendor 目录
filepath = os.path.join(os.path.dirname(__file__), "cache.json")
```

**跨项目适配清单**：

| 项目 | 数据目录 | 常见运行时数据文件 | 校验脚本 |
|------|---------|-------------------|---------|
| FlowForge | `agents/main/data/` | task_state.json, loop_checkpoints.db | `find scripts/vendor -name "*.json"` |
| ContentForge | `agents/main/data/` | replied_comments_*.json, commented_articles_*.json | 同上 |
| DevForge | `agents/main/data/` | deploy_state.json, build_log.db | 同上 |
| NovelForge | `agents/main/data/` | chapter_outline.json, review_state.json | 同上 |
| MallForge | `agents/main/data/` | product_cache.json, listing_state.json | 同上 |
| OpenRoute | `data/` | model_routes.yaml (配置除外), fallback_state.json | `find . -name "*.json" -not -path "./data/*"` |
| OpenSieve | `data/` | semantic_cache.db, embedding_cache/ | 同上 |

**自动化校验脚本模板**：

```python
def verify_data_file_location(project_root: str) -> bool:
    """校验所有运行时数据文件都在 data/ 目录下"""
    code_dirs = ["scripts/vendor", "scripts/platforms", "scripts/prompts", "scripts/config"]
    bad_extensions = [".json", ".db", ".log", ".csv", ".tmp"]
    
    violations = []
    for code_dir in code_dirs:
        full_path = os.path.join(project_root, code_dir)
        if not os.path.exists(full_path):
            continue
        for root, dirs, files in os.walk(full_path):
            for f in files:
                if any(f.endswith(ext) for ext in bad_extensions):
                    # 配置文件白名单
                    if f in ("browser_config.json", "default.yaml", "model_routes.yaml"):
                        continue
                    violations.append(os.path.join(root, f))
    
    if violations:
        print(f"❌ 发现 {len(violations)} 个违规数据文件：")
        for v in violations:
            print(f"   {v}")
        return False
    print("✅ 所有运行时数据文件均存放在 data/ 目录")
    return True
```
