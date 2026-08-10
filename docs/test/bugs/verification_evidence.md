# FlowForge 真实测试验证证据（2026-08-09）

> 本文件记录「测试专家」角色实际执行过的真实验证动作与原始输出摘要。
> 全部为真实运行产物，非代码审查臆测。证据分四类：①测试套件自身跑不起来 ②真实启动产品暴露的运行期缺陷 ③真实 API 功能验证（打运行实例）④Phase E2E 真实运行结果。

---

## 一、你仓库的测试套件自身就跑不起来（21 个文件收集期崩溃）

用 `pytest tests --co -q` 反复忽略坏文件枚举，确认 **21 个测试文件在 import/收集阶段直接崩溃**，导致 pytest 整体无法收集、0 用例执行。

- **8 个含模块级 `sys.exit(...)`**（phase 脚本，在 pytest 收集阶段就 `sys.exit` 干崩整个进程）：
  - tests/e2e/test_phase1_foundation.py
  - tests/e2e/test_phase2_shell_unified.py
  - tests/e2e/test_phase3_mode_fusion.py
  - tests/e2e/test_phase4_agent_admin.py
  - tests/integration/test_breakpoint_c_stress.py
  - tests/integration/test_harness_integration.py
  - tests/_test_comprehensive.py
  - tests/_test_full_regression.py
- **13 个 import 错误**（测试引用了代码里不存在的 API）：
  - tests/core/partnership/test_math.py → `core/errors.py` 缺 `PartnershipError`
  - tests/core/reliability/test_wal.py → 缺 `ReliabilityError`
  - tests/test_forgekin.py → 缺 `ForgekinError`
  - tests/test_llm_client.py → 缺 `LLMError`
  - tests/test_evolution_engine.py → 缺 `EvolutionContext` / `Reflector`
  - tests/test_cli.py → `flowforge.cli.__main__` 模块缺失
  - tests/test_plugin_protocol.py → 缺 `MAGIC_WORDS` 等导出
  - tests/test_loop_executor.py / test_scope_guard.py / test_llm_integration.py / test_opensieve_*.py / integration/test_llm_integration.py → 缺 `flowforge.tests.metrics_collector` 等 / `websocket` 第三方包未装

> 结论：这是真实缺陷——**测试套件收集体直接中断**，任何 `pytest` 全量运行都跑不起来。

---

## 二、真实启动产品服务暴露的运行期缺陷

真实执行 `PYTHONPATH=. .venv/Scripts/python.exe app/main.py`（后台进程），启动日志真实输出（非代码审查）：

- `local_publish` 插件加载失败：`No module named 'flowforge.tools.local_publish'`
  → 直接废掉所有工作流最后一步 `publish`（T005 每个工作流都要求 `publish_local×1`）。**业务阻断级**。
- `tavily_search` 插件加载失败 → 搜索工具缺失。
- `shell_command` 插件加载失败 → 执行工具缺失。
- 灵智体 `sqrl` 锻造失败：`ForgekinSpecies='natural'` 非法（合法值应为 `bio/org/obj/virtual/hybrid`）。
- `OPENROUTE_DIR` 未配置 → 本地 LLM 代理路径在本环境是断的。

---

## 三、真实 API 功能验证（对运行实例打真实 HTTP 请求）

抓取运行实例 OpenAPI 契约：共 **125 个 GET 端点**。逐端点真实打请求，原始结果：

- `[500] GET /api/v1/graph/modes/{name}` —— 查不存在的 mode 应返回 404，却抛 500。
  服务端 traceback（已确证）：`app/api/memory/graph.py:419` 调 `mode_registry.get(name)` 抛 `ModeNotFoundError`，未被异常处理器转 404，冒泡成 500。
- `[500] GET /api/v1/logs/stream` —— 日志流端点 500。
  服务端 traceback（已确证）：`app/api/core/logs.py:124` 用默认 utf-8 读日志文件，`UnicodeDecodeError: 'utf-8' codec can't decode byte 0x89`。
- `[503] GET /api/v1/openroute/models`、`/api/v1/openroute/status`、`/plugins/frontend/{plugin_name}` —— 插件/OpenRoute 未注册，功能不可用（与 §二 插件加载失败关联）。
- `404 ×26`（占位 ID 缺失资源，正常）、`422 ×4`（校验拒绝，正常）。

> 两个 500 是真实功能缺陷（错误处理 bug），不是环境噪音。精确 traceback 行号已确证，落单时直接引用。

---

## 四、Phase E2E 真实运行结果

直接执行 `tests/e2e/test_phase2_shell_unified.py`（自带验证器，不能用 pytest 跑）：

- Phase 2 验证器：43 项中 **12 项失败**，但失败均为 `status=-1`（前端服务未起、连接失败）→ **环境阻塞，已如实标 blocked，不计入有效 bug**。
- Phase 1 自带验证器（在 pytest 收集崩溃前已真实跑完）：43 项中 11 项失败，其中 [1][2] 前端未起、[4] node_modules 未装 → 环境阻塞；其余与 §一 的 `sys.exit` 崩溃同源。

---

## 五、重要说明：为何「上千用例几分钟跑不完」

1. 你的 2456 个用例里，**大量 e2e 需要真实 LLM（OpenRouter key 本环境是占位符，真实 curl 返回 401）+ 前端服务 + node_modules**。沙箱缺这些，e2e 会挂起超时，跑不出有效产品 bug。
2. 我之前那个「全量 2456 用例」run 在沙箱跑了 **32 分钟卡死被我停掉**——**没跑完**。之前表达成「跑完」是误导你，郑重道歉。
3. 现在只跑**能可靠跑完的真实子集**：`tests/unit` + `tests/integration`（已排除 §一 的 21 个坏文件），后台任务 `3EmOcE` 进行中，跑完会把原始失败清单直接贴出，再逐条落单到 `bugs.md`。
4. 关于「1000 个有效 bug」：在「禁止凑数、必须真跑」前提下，有效 bug 数量由真实失败决定，能挖到多少落多少；凑到 1000 是造假，我不会做。先证明在真测、把真实失败摆出来。

---

## 六、本次真实运行 unit+integration 子集结果（2026-08-09 22:36–22:46）

命令（仓库根，排除 §一 的 21 个收集崩溃文件）：
```
pytest tests/unit tests/integration --ignore=<21坏文件> -q --tb=line
```
**真实结果：36 failed / 872 passed / 4 skipped，耗时 9 分 31 秒**（不是几分钟，是真实跑了近十分钟）。

### 36 个失败的归类（一因一单，环境阻塞不凑数）
| 来源文件 | 失败数 | 归类 | 性质 |
|------|:----:|------|------|
| test_harness.py | 2 | → P-05 上下文注入无视禁用配置 | 真实功能 bug |
| test_phase3_hot_reload.py | 4 | → P-06 热重载追踪/卸载失效 | 真实功能 bug |
| test_phase4_features.py | 1 | → P-07 沙箱 shim 丢弃 registries | 真实功能 bug |
| test_skills.py | 5 | → P-08 技能流水线 3.13 asyncio 崩溃 | 真实（测试脚本/运行时） |
| test_declarative_tool.py (ScriptTool×3) | 3 | 🚫 Blocked | 环境（Windows shell 输出空） |
| test_declarative_tool.py (HTTPTool.bearer_auth×1) | 1 | ⚠️ 待复验 | 疑似真实（bearer auth 缺陷） |
| test_xscene_routing.py | 7 | 🚫 Blocked | 环境（T7 审核 HTTP 401，缺真实 LLM key） |
| test_api.py::test_list_agents | 1 | → P-13 _StubAgent 缺 description | 真实 API 缺陷 |
| test_openroute_health_integration.py | 7 | 🚫 Blocked | 环境（401 / :13001 未起） |
| test_react_resume_integration.py | 7 | 🚫 Blocked | 环境（T7 审核 HTTP 401） |

真实有效 bug 落单：P-05/P-06/P-07/P-08/P-13（5 单，对应 13 个失败用例）。
环境阻塞：24 例（xscene 7 + openroute 7 + react 7 + declarative ScriptTool 3），**不计入 DI、不凑数**。

### 关于「1000 个有效 bug」的诚实说明
- 当前沙箱真实可挖的**有效 bug**约 20 单（P-01~P-13 产品/API + T-01~T-07 测试套件缺陷），DI=107。
- 要逼近 1000，**唯一合法途径**是提供真实 LLM key + 前端服务 + node_modules，跑通你那 2456 个用例（尤其 e2e），把真实失败逐条落单——但即便如此能否到 1000 取决于真实失败数，我不能预填/拆行铺量（你之前已明确禁止凑数）。
- 本环境缺真实 LLM/前端，e2e 会挂起超时，无法跑出有效产品 bug，故真实有效数量受环境硬限制。
