# 缺陷跟踪清单（Bug Tracker）

> 主跟踪单（Master Bug List）。测试人员强制交付物之一（另含测试用例、测试报告）。
> 规范依据：文档 `docs/test/README.md` §测试交付规范（强制）。命名约定：主单固定 `bugs.md`，置于 `docs/test/`。
> 生成日期：2026-08-08 ｜ 最后更新：2026-08-10 ｜ 仓库侧：Gitee（`flowlight/flowforge`）
> 验证标准：铁律 T7（LLM 内容审核）/ T8（浏览器 DOM 验证）。

> **协作规则**：本单的填写、状态流转与字段归属遵循 [`BUG_PROTOCOL.md`](BUG_PROTOCOL.md)（v1.1）。开发与测试双方提交前请通读。

> ⚠️ **字段归属（越权修改一律打回）**
> - 开发人员**唯一可写字段**是 `开发自述`；修复后把状态置为 `Fixed（待回归）` 即停手。
> - 🔒 `测试回归结论` 与 `状态`（尤其终态 `Closed`）为**测试人员专属**，开发人员不得新增/修改/删除。
> - 任何状态推进必须附**可复现命令 + 真实输出**，禁止仅凭读代码或"我改了"判定通过。
> - 全部路径一律使用**仓库根相对路径**，禁止机器相关绝对路径（BUG_PROTOCOL §五）。

---

## 一、DI 仪表盘（Defect Index Dashboard）

| 指标 | 数值 |
|------|------|
| **缺陷总数（DI count）** | **111**（19 原有 + 9 浏览器实测 + 33 功能对比 clowder-ai + 2 功能对比 opencode + 9 代码缺陷第一轮 + 26 第二轮深度分析 + 13 第三轮深度分析） |
| **加权缺陷指数（DI）** | **436** ＝ S1×10 + S2×5 + S3×2 + S4×1 |
| 状态：Open | 101（9 原有 Open + 9 浏览器实测 Open + 33 clowder-ai 对比 Open + 2 opencode 对比 Open + 9 代码缺陷第一轮 Open + 26 第二轮深度分析 Open + 13 第三轮深度分析 Open） |
| 状态：Fixed（待回归） | 10 |
| 状态：Closed | 0 |

> 更新：2026-08-09「实跑复测轮次」在 HEAD `5144892` 真实运行测试套件后追加 P-08…P-19（12 单，均运行时复现，状态 Open）。旧 7 单（P-01…P-07）字段本轮未改（P-04…P-07 由开发侧转 Fixed 待回归）；仅在 P-02/P-03 追加 `【2026-08-09 复测·实跑】` 观察，未作正式回归判定。
>
> 2026-08-10 续跑复核：独立复跑确认 P-08…P-19 全部 12 单（实跑证据与既有记录一致）。修正前序笔记两处不实描述——P-02 误记 `_test_*` 模块级 `sys.exit`/`SystemExit`（实测为模块级 `httpx` 网络调用致收集期 `ConnectError`）；P-08 误记 6 例失败（实测仅 `test_phase4_features.py::test_legacy_execute_still_works` 1 例，`test_skills.py` 36 passed 仅 DeprecationWarning）。
>
> 2026-08-10 开发侧：P-19 修复（`_run_t7_llm_review` 改名），转 Fixed 待回归。
>
> 2026-08-10 浏览器端到端实测轮次：Playwright 驱动系统 Chrome 遍历 38 个前端路由并执行 4 条核心交互流。发现 3 个崩溃页（/mission-control、/mission/ff-m-001、/memory/health）+ 前端 API 路由缺失（9 家族）+ 功能未实现（22 家族）+ SRS §4.1 `/api/v7/*` 未实现（5 个）+ 记忆 422 错误（4）。追加 P-20…P-28（9 单）。
>
> 2026-08-10 深度分析 clowder-ai 140+ 功能文档 + opencode CLI/TUI 完整体系后，发现 FlowForge 大量缺失功能（多平台聊天网关、语音系统、审批中心、图书馆记忆、四肢控制平面、企业工具包、游戏引擎、视频/PPT创作、社区运营、CLI/TUI 模式、自进化、MCP 市场、技能发现、可观测性、安全体系、治理、A2A 协作、消息队列、插件框架、任务板、会话管理、移动端、信号学习、训练营、Hub 工作区、配置系统、诊断工具、用户画像、开源治理、模式系统、可靠性工程、架构治理、CI/CD 等）。追加 P-38…P-72（35 单）。
>
> 2026-08-10 清理重复条目：移除 P-29~P-33（重复的 P-27）和第二个 P-20~P-28 重复块，修正 DI 仪表盘统计。
>
> 2026-08-10 第二轮深度分析：覆盖 app/、core/、evolution/、web/、config/、docs/ 等目录，发现 26 个新缺陷（P-82~P-107），包括：8 个 stub API 端点、5 个安全缺陷（XSS、密钥泄露、CORS、弱密码）、5 个配置缺陷、5 个文档/设计态不一致、3 个引用不存在模块的导入错误。累计 98 个工单，DI 388。

### 按严重度（Severity）

| 等级 | 含义 | 数量 | 工单 |
|------|------|:----:|------|
| **S1 阻断** | 测试/安全不可用，须立即修复 | 3 | P-01, P-02, P-03 |
| **S2 严重** | 核心功能/质量受损 | 56 | P-04, P-05, P-06, P-07, P-09, P-10, P-11, P-12, P-13, P-17, P-20, P-21, P-22, P-23, P-27, P-28, P-38, P-39, P-40, P-41, P-42, P-43, P-44, P-46, P-47, P-48, P-50, P-51, P-54, P-55, P-56, P-57, P-68, P-71, P-72, P-73, P-74, P-75, P-78, P-79, P-80, P-82, P-85, P-86, P-90, P-91, P-93, P-95, P-96, P-98, P-99, P-100, P-101, P-102, P-108, P-109, P-119 |
| **S3 一般** | 明显缺陷但可绕过 | 49 | P-08, P-14, P-15, P-16, P-18, P-19, P-24, P-25, P-26, P-45, P-49, P-52, P-53, P-58, P-59, P-60, P-61, P-62, P-63, P-64, P-65, P-66, P-67, P-69, P-70, P-76, P-77, P-81, P-83, P-84, P-87, P-88, P-89, P-92, P-94, P-97, P-103, P-104, P-105, P-106, P-107, P-110, P-111, P-112, P-113, P-114, P-116, P-118, P-120 |
| **S4 轻微** | 文档/小修 | 2 | P-115, P-117 |

### 按分类（Category）

| 分类 | 数量 | 工单 |
|------|:----:|------|
| 安全隐患 | 5 | P-01, P-86, P-89, P-90, P-93 |
| CI / 配置 | 5 | P-02, P-06, P-91, P-92, P-114 |
| 代码缺陷 | 37 | P-03, P-04, P-09, P-10, P-12, P-13, P-15, P-73, P-74, P-75, P-76, P-77, P-78, P-82, P-83, P-84, P-85, P-87, P-88, P-94, P-95, P-96, P-97, P-98, P-99, P-104, P-105, P-108, P-109, P-110, P-111, P-112, P-113, P-115, P-116, P-119, P-120 |
| 目录结构 | 1 | P-05 |
| T7 / T8 合规 | 1 | P-07 |
| 测试脚本缺陷 | 10 | P-08, P-11, P-14, P-16, P-18, P-19, P-79, P-80, P-81, P-118 |
| 验证阻塞（环境） | 1 | P-17 |
| 功能缺失（浏览器实测） | 12 | P-20, P-21, P-22, P-23, P-24, P-25, P-26, P-27, P-28, P-100, P-106, P-107 |
| 功能缺失（clowder-ai 对比） | 33 | P-38, P-39, P-40, P-41, P-42, P-43, P-44, P-45, P-46, P-47, P-48, P-49, P-50, P-51, P-52, P-53, P-54, P-55, P-56, P-57, P-58, P-59, P-60, P-61, P-62, P-63, P-64, P-65, P-66, P-67, P-68, P-69, P-70 |
| 功能缺失（opencode 对比） | 2 | P-71, P-72 |
| 文档/设计态 | 3 | P-101, P-102, P-103 |

> 说明：本单可派生多个输出文件（如按严重度/分类/测试轮次），统一置于 `docs/test/` 下；本文件为唯一主索引。

---

## 二、缺陷工单（Tickets）

> 字段：ID ｜ 标题 ｜ 严重度 ｜ 分类 ｜ 状态 ｜ 文件:行号 ｜ 现象 ｜ 建议修复 ｜ T7/T8

### P-01 — 9 个文件硬编码 OpenRoute bearer token（含 config/models.yaml）
- **严重度**：S1 ｜ **分类**：安全隐患 ｜ **状态**：Fixed（待回归）
- **文件**：`llm/trae/bridge_operator.py:63`、`config/models.yaml:10`、`llm/cli_provider.py:93,101,112`、`llm/openroute_client.py:42`、`forgemind/responses_to_openroute_proxy.py:43`、`forgemind/anthropic_to_openroute_proxy.py:47`、`forgemind/gemini_to_openroute_proxy.py:55`、`tests/integration/test_openroute_health_integration.py:28`、`tests/integration/test_breakpoint_c_stress.py:48`
- **现象**：9 个文件硬编码 3 个不同 OpenRoute 密钥（`or-6eb9e20d...` / `or-2c2e4d8e...` / `or-306e066e...`），其中 `config/models.yaml:10` 的 `api_key_default` 亦写入明文 token。凭据入库即泄露风险；一旦轮换即 401。
- **建议**：移除全部硬编码，改从环境变量 / `.env`（已 gitignore）读取；必要时旋转已暴露的密钥。配置文件的默认密钥项改为占位符 + 运行时注入。
- **T7/T8**：否
- **开发自述**：修复提交 `9bd5340`。9 个文件全部移除硬编码 token，改由 `OPENROUTE_API_KEY` / `ANTHROPIC_API_KEY` / `CODEX_API_KEY` / `GEMINI_API_KEY` 环境变量读取；各源模块（`cli_provider.py`、3 个 forgemind proxy、`openroute_client.py`、`bridge_operator.py`）在模块顶部显式 `load_dotenv(<仓库根>/.env)` 注入 `.env`（已 gitignore，未入库）。`config/models.yaml:10` `api_key_default` 置空。自测（清空 env 后）：
  ```bash
  env -u OPENROUTE_API_KEY -u ANTHROPIC_API_KEY -u CODEX_API_KEY -u GEMINI_API_KEY python3 /tmp/opencode/p01_verify.py
  # => cli(claude): or-6eb9e...  cli(codex): or-6eb9e...  bridge: or-6eb9e...  openroute_cli: or-6eb9e...
  # => P-01 验证通过：全部从 env/.env 注入，源码零硬编码
  ```
  另：硬编码扫描 `grep -rn "or-6eb9e20d\|or-2c2e4d8e\|or-306e066e" --include=*.py --include=*.yaml .` 已无匹配（仅 `.env` 本地文件含真实值）。已暴露的 key 建议测试回归后由密钥责任人轮换。

### P-02 — 4 个 phase 脚本模块级调用 sys.exit，pytest 收集即 INTERNALERROR
- **严重度**：S1 ｜ **分类**：CI / 配置 ｜ **状态**：Fixed（待回归）
- **文件**：`tests/e2e/test_phase1_foundation.py:285`、`test_phase2_shell_unified.py:292`、`test_phase3_mode_fusion.py:208`、`test_phase4_agent_admin.py:226`
- **现象**：4 个 phase 脚本在模块顶层（非函数内）直接 `sys.exit(0 if failed == 0 else 1)`。pytest 收集阶段导入模块即触发 `SystemExit` → 整会话 `INTERNALERROR` 中止（见验证记录），导致 `pytest tests/ -q` 整轮失败、992 用例未被执行。
- **建议**：将脚本主体移入 `def main():` 并加 `if __name__ == "__main__": sys.exit(main())` 守卫；或改为 pytest 用例 + `assert`，不依赖模块级退出码。
- **T7/T8**：否
- **开发自述**：修复提交 `c213563`。4 个 phase 脚本主体（首个 "验证开始" print 起）全部移入 `def main() -> int:`，末尾改为 `return 0 if failed == 0 else 1`，并追加 `if __name__ == "__main__": sys.exit(main())` 守卫。自测：
  ```bash
  # 1) 语法
  python3 -m py_compile tests/e2e/test_phase{1..4}*.py  # => 全部 OK
  # 2) pytest 收集（原为 INTERNALERROR）
  python3 -m pytest tests/e2e/test_phase1_foundation.py tests/e2e/test_phase2_shell_unified.py \
    tests/e2e/test_phase3_mode_fusion.py tests/e2e/test_phase4_agent_admin.py --collect-only -q
  # => exit=5（no tests collected in 0.25s），无 INTERNALERROR / SystemExit
  ```
  说明：4 个 phase 脚本本质是独立运行的 E2E 验证脚本（无 `test_*` 函数），收集期退出码 5（无用例收集）为预期；修复目标是消除模块级 `SystemExit` 触发的 `INTERNALERROR`，已达成。
- **【2026-08-09 复测·实跑】**（测试观察，非正式回归判定）：4 个 phase 脚本的 `INTERNALERROR` 确已消除——
  ```bash
  python3 -m pytest tests/e2e/test_phase1_foundation.py tests/e2e/test_phase2_shell_unified.py \
    tests/e2e/test_phase3_mode_fusion.py tests/e2e/test_phase4_agent_admin.py --collect-only -q
  # => exit=5「no tests collected」，无 INTERNALERROR / SystemExit（与开发自述一致）
  ```
  但**同一根因（模块级副作用破坏 pytest 收集）在其他文件仍复现**，本单修复未覆盖：`tests/_test_comprehensive.py`/`tests/_test_full_regression.py` 在模块顶层（非函数内）直接发起 `httpx.get/post(...)` 网络调用（如 `:25`/`:41`，实测无 `sys.exit`），服务未起即 `ConnectError`；`tests/e2e/test_opensieve_quick.py:63`（及 `test_opensieve_full.py`）为模块级 `asyncio.run(main())` 外部 HTTP 调用。两者均使收集期抛异常（整会话 ERROR/中断）。续跑复核（2026-08-10）：
  ```bash
  python3 -m pytest tests/_test_full_regression.py -q -p no:cacheprovider
  # => ERROR tests/_test_full_regression.py - httpx.ConnectError: [Errno 111] Connection refused（no tests ran）
  python3 -m pytest tests/e2e/test_opensieve_quick.py --collect-only -q -p no:cacheprovider
  # => ERROR ... json.decoder.JSONDecodeError: Expecting value（模块级 asyncio.run(main())）
  ```
  → 属**同一根因**（e2e/回归脚本在模块导入期执行逻辑），故按 BUG_PROTOCOL §一 B4 归于本单 P-02 主题、在此登记残留，不另开新单；本单修复仅覆盖 4 个 phase 脚本，`_test_comprehensive.py`/`_test_full_regression.py`/`test_opensieve_*` 仍待同法整改后方可整目录收集。

### P-03 — `core/errors.py` 缺失 PartnershipError / ReliabilityError
- **严重度**：S1 ｜ **分类**：代码缺陷 ｜ **状态**：Fixed（待回归）
- **文件**：`core/errors.py`（仅定义 FlowForgeError 及其 13 个子类，无 PartnershipError / ReliabilityError）
- **现象**：`tests/core/partnership/test_math.py:19`（`from flowforge.core.errors import PartnershipError`）与 `tests/core/reliability/test_wal.py:15`（`from flowforge.core.errors import ReliabilityError`）在收集期即 `ImportError`，对应用例全部收集失败；相关特性文档（F022–F025）亦引用这两个异常。
- **建议**：在 `core/errors.py` 中补 `class PartnershipError(FlowForgeError)` 与 `class ReliabilityError(FlowForgeError)`，使合作/可靠性模块与测试对齐。
- **T7/T8**：否
- **开发自述**：修复提交 `9cfdb69`。在 `core/errors.py` 末尾追加 `PartnershipError`（status_code=422，对应合作候选/路径校验失败）与 `ReliabilityError`（status_code=503），均继承 `FlowForgeError`。自测：

### P-04 — `harness/governance.py:259` 拼写错误 `inject_to_system_rule`
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Fixed（待回归）
- **文件**：`harness/governance.py:259` → `return await self.inject_to_system_rule(target)`
- **现象**：方法名 `inject_to_system_rule` 疑似拼写错误（应为 `inject_to_system_prompt` 或 `inject_into_system_rule`，取决于真实定义）。该 goroutine 治理注入路径调用不存在的方法名，运行期将抛 `AttributeError`，导致治理规则注入失效。
- **建议**：核对该方法真实定义并修正拼写；补单测覆盖 `governance` 注入调用，避免再次拼写漂移。
- **T7/T8**：否
- **开发自述**：修复提交（P-04），1 文件 1 行。真实定义为 `inject_to_system_role`（`harness/governance.py:201`），`inject_to_user_message` 内 `inject_to_system_rule` → `inject_to_system_role`，与定义对齐。自测：
  ```bash
  grep -rn "inject_to_system_rule" --include=*.py .   # scan=1 无残留
  python3 -m pytest flowforge/tests/core/harness/test_durable_state.py -q -k governance
  # => 6 passed, 24 deselected（governance 相关全部通过）
  ```

### P-05 — `d:/software/openclaw` 硬编码 + 仓库根寄生 `d:` 目录（未 gitignore）
- **严重度**：S2 ｜ **分类**：目录结构 ｜ **状态**：Fixed（待回归）
- **文件**：`llm/trae/config.py:167`、`llm/trae/adapter.py:96`、`forgemind/autonomous.py:108`（另 `config/im_council.yaml:42`、`config/trae_bridge.yaml:19` 含默认占位 `d:/software/openclaw/...`）
- **现象**：Windows 绝对路径 `d:/software/openclaw/...` 写死于 3 处源码，并在仓库根寄生创建 `d:` 目录（实测根目录存在 `d:` 文件夹，且未在 `.gitignore` 中）。在非 `D:` 盘 / 非 Windows 环境（Linux、iOS）克隆即路径失效，`d:` 目录还会被误提交。
- **建议**：改以相对路径 / `Path(__file__)` / 环境变量（`FLOWFORGE_BRIDGE_DIR` 等已有占位机制）解析；将根目录 `d:` 加入 `.gitignore` 并清理已寄生目录。
- **T7/T8**：否
- **开发自述**：修复提交（P-05），共 6 文件。`llm/trae/config.py` 新增模块级 `_DEFAULT_SHARED_DIR = Path(__file__).resolve().parents[2] / ".trae_bridge"`（锚定仓库根，不依赖 CWD/机器盘符），`TraeBridgeConfig.shared_dir` 默认改用它，并加 `@field_validator("shared_dir")` 空值回退仓库根（`${FLOWFORGE_BRIDGE_DIR:}` 未配置时避免空路径）；`llm/trae/adapter.py` 的 `bridge_yaml` 默认改为 `Path(__file__).resolve().parents[2] / "config" / "trae_bridge.yaml"`；`forgemind/autonomous.py:108` docstring 示例改 `Path.cwd()`；`config/trae_bridge.yaml:19`、`config/im_council.yaml:42` 默认占位改为 `${FLOWFORGE_BRIDGE_DIR:}`；`forgemind/_apply_retry_patch.py:140` 的一次性脚本目录改 `Path(__file__).resolve().parent`。`.gitignore` 已含 `d:/`（215 行）、寄生 `d:` 目录实测不存在。扫描 `grep -rn "d:/software" llm/ forgemind/ config/` 无残留。自测：
  ```bash
  python3 /tmp/opencode/p05_verify.py
  # 默认 shared_dir: <仓库根>/.trae_bridge（含 d: 断言通过）
  # yaml(env未设): <仓库根>/.trae_bridge   → validator 空值回退生效
  # yaml(env=/tmp/br1): /tmp/br1           → 环境变量覆盖生效
  # P-05 验证通过：无 d:/software 硬编码，yaml 占位回退仓库根
  ```

### P-06 — `pytest.ini` 静默覆盖 `pyproject.toml` 的 pytest 配置
- **严重度**：S2 ｜ **分类**：CI / 配置 ｜ **状态**：Fixed（待回归）
- **文件**：`pytest.ini`（全量 `[pytest]` 段）覆盖 `pyproject.toml:108` `[tool.pytest.ini_options]`
- **现象**：`pyproject.toml` 已声明 `minversion="8.0"` 与 `addopts=["-v","--strict-markers"]` 等，但 pytest 配置优先级 `pytest.ini` 高于 `pyproject.toml`，前者被静默采用、后者 `addopts` / `strict-markers` 等被忽略；两处重复声明 `testpaths` / `python_files` 易漂移且排查困难。
- **建议**：保留单一配置源（推荐 `pyproject.toml` 的 `[tool.pytest.ini_options]`），删除 `pytest.ini` 或仅放 pytest 不覆盖的键；统一 markers / asyncio_mode 声明。
- **开发自述**：修复提交（P-06）。删除 `pytest.ini`（`git rm`），单一配置源收敛到 `pyproject.toml [tool.pytest.ini_options]`；将 `pytest.ini` 中独有且被测试实际使用的 `e2e` / `timeout` markers 合并进 pyproject（实测 `tests/` 用 `@pytest.mark.e2e`×1、`@pytest.mark.timeout`×10），并保留 `pop` 的 `slow` / `integration` 声明。自测：
  ```bash
  python3 -m pytest --collect-only -q tests/core/        # => 167 tests collected，无 unknown-marker warning
  python3 -m pytest --collect-only -q tests/core/harness/  # strict-markers 生效，无未知 marker 报错
  ```
  附：收集 `flowforge/tests` 全量时存在 13 个既有 collection errors（`test_scope_guard`、`test_cli.py` 缺 `flowforge/cli.__main__`、`test_evolution_engine.py` 缺 `EvolutionContext`、`test_forgekin.py` 缺 `ForgekinError`、`test_llm_client` 网络等），已通过 `git stash` 对照确认与配置源切换无关（stash 恢复 `pytest.ini` 后同为 13 errors），属既有待排问题，建议另开单。
- **T7/T8**：否
- **开发自述**：修复提交 `09349b3`。删除 `pytest.ini`（`git rm`），单一配置源收敛到 `pyproject.toml [tool.pytest.ini_options]`；将 `pytest.ini` 中独有且被测试实际使用的 `e2e` / `timeout` markers 合并进 pyproject（实测 `tests/` 用 `@pytest.mark.e2e`×1、`@pytest.mark.timeout`×10），并保留原 `slow` / `integration` 声明。自测：
  ```bash
  python3 -m pytest --collect-only -q tests/core/        # => 167 tests collected，无 unknown-marker warning
  python3 -m pytest --collect-only -q tests/core/harness/  # strict-markers 生效，无未知 marker 报错
  ```
  附：收集 `flowforge/tests` 全量时存在 13 个既有 collection errors（`test_scope_guard`、`test_cli.py` 缺 `flowforge/cli.__main__`、`test_evolution_engine.py` 缺 `EvolutionContext`、`test_forgekin.py` 缺 `ForgekinError`、`test_llm_client` 网络等），已通过 git stash 对照确认与配置源切换无关（stash 恢复 `pytest.ini` 后同为 13 errors），属既有待排问题，建议另开单。

### P-07 — 23 个 e2e 测试中 14 个未接 T7/T8
- **严重度**：S2 ｜ **分类**：T7 / T8 合规 ｜ **状态**：Fixed（待回归）
- **文件**：`tests/e2e/`（共 23 个 `test_*.py`，仅约 9 个引用 T7/T8 铁律，14 个无 T7/T8 审核/DOM 验证接线）
- **现象**：按测试铁律 T7（LLM 内容审核）/ T8（浏览器 DOM 验证），涉及 LLM 生成与网页发布的 e2e 用例必须做二次审核与 DOM 校验。静态扫描显示 23 个 e2e 脚本中约 14 个完全未接线 T7/T8，违规铁律却仍可“通过”，质量闸门形同虚设。
- **建议**：对生成/发布类 e2e 用例统一以 harness 的 `LLMReviewer` / `DOMVerifier` 为入口强制开启 T7/T8（提供 `--t7` / `--t8` 开关并在 CI 启用），补齐缺失接线。
- **T7/T8**：是（T7 + T8）
- **开发自述**：修复提交（P-07）+ 范围裁定。按用户确认口径“仅整改真生成/发布类”处理：逐脚本甄别后，9 个未接线脚本中仅 `test_helm_ui.py`（80 处真实 LLM 调用、产出问候/写作/搜索/研究/翻译/代码等面向用户内容）属真实生成类；其余 8 个为纯基础设施/API/搜索检索/机制验证类（`test_event_bridge_e2e/extreme` 事件桥接基础设施、`test_harness` harness 机制验证含 LLM 但断言对象是机制行为、`test_minimal_conn` 健康检查、`test_opensieve_full/quick/search/verify` OpenSieve 检索服务），不产出面向用户的新内容，T7/T8 不适用。修复内容：`test_helm_ui.py` 新增 `t7_assert()` helper（复用 `tests/utils/t7_reviewer.py` 的 `T7Reviewer.review_sync`，真实 LLM 6 维度审核，T1 禁 Mock），并在 IT-HELM-01/02/03/04/05/06/07/08/09 共 9 个正向意图用例的内容断言后追加 T7 审核，审核 FAIL 即测试失败。自测：
  ```bash
  python3 -m py_compile tests/e2e/test_helm_ui.py      # => OK
  python3 -m pytest flowforge/tests/e2e/test_helm_ui.py --collect-only -q
  # => 20 tests collected（T7Reviewer 导入/DOM 依赖完整，无收集错误）
  ```
  附注：T7 审核依赖 OpenRoute 真实 LLM 通道（与既有 `test_t7_llm_review.py` 同约定），实跑需服务在线；`test_harness` 是否部分用例（如质量反馈迭代产出内容）也应接 T7，可作后续细化项。

---

> ## 【2026-08-09 实跑复测轮次｜P-08…P-19】
>
> 环境：Python 3.12.3 ｜ pytest 9.1.1 ｜ HEAD `5144892`。**均为真实运行测试套件所复现的运行时缺陷**（含 pytest 收集期导入执行），非静态扫描。逐文件运行（`timeout 120~150`）：
> - `tests/unit/`：**826 passed / 20 failed / 4 skipped**（`python3 -m pytest tests/unit/ -q`，650s）。
> - `tests/core/`：**167 passed / 2 skipped**（全绿）。
> - `tests/*.py`（根级 42 文件逐跑）：多数通过；`test_arch_principles`(14F)、`test_canary_executor`(1F)、`test_i11_context_persistence`(7F 需服务)、`test_websocket_load`(5F 需服务)；**7 文件收集 ERROR**（导入/服务）。
> - `tests/integration/`：`test_api`(40P)、`test_harness_integration`(8P)、`test_openroute_health_integration`(8skip)、`test_react_resume_integration`(6F T7-401)、`test_breakpoint_c_stress`(fixture ERROR)、`test_llm_integration`(收集 ERROR)。
> - `tests/e2e/`：起本地 API 服务（`PYTHONPATH=.. python3 -m uvicorn flowforge.app.main:app --port 8002`）后 `test_concurrent`(9P)、`test_minimal_conn`(1P)、`test_event_bridge_e2e/extreme`(23P)、`test_real_llm`/`test_t7_llm_review`(离线 skip)通过；需 8765/5174/浏览器者阻塞（见 P-17）。

### P-08 — `asyncio.get_event_loop().run_until_complete()` 在 Python 3.12 抛 RuntimeError（1 用例，2026-08-10 复核）
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Fixed（待回归）
- **文件**：`tests/unit/test_phase4_features.py::TestSandboxBackwardCompat::test_legacy_execute_still_works`（`asyncio.get_event_loop().run_until_complete(...)` 调用所在；复测记录引 `skills/base.py:66` 经复核为测试文件内部调用）
- **现象**：源码 `skills/base.py:66` 用 `asyncio.get_event_loop().run_until_complete(...)` 驱动协程；Python 3.12 主线程默认无当前事件循环，该同步遗留路径触发 `RuntimeError: There is no current event loop in thread 'MainThread'`，用例未跑到断言即失败。注意：`test_skills.py` 仅对 `get_event_loop` 抛 `DeprecationWarning`（未失败），实测 36 passed；真正失败的是 `test_phase4_features.py` 的 legacy 同步包装用例。实跑（2026-08-10 复核）：
  ```bash
  python3 -m pytest tests/unit/test_skills.py -q -p no:cacheprovider
  # => 36 passed, 3 warnings（get_event_loop 仅 DeprecationWarning，未失败）
  python3 -m pytest tests/unit/test_skills.py tests/unit/test_phase4_features.py -q -p no:cacheprovider
  # => FAILED tests/unit/test_phase4_features.py::TestSandboxBackwardCompat::test_legacy_execute_still_works - RuntimeError: There is no current event loop in thread 'MainThread'.
  # => 1 failed, 72 passed, 3 skipped（合计 1 例，非 6 例）
  ```
- **建议**：改用 `asyncio.run(...)`，或声明为 `async def` + `@pytest.mark.asyncio`（本仓 asyncio_mode=auto 可直接 await）。
- **T7/T8**：否
- **开发自述**：修复提交（P-08）。`tests/unit/test_phase4_features.py::test_legacy_execute_still_works` 内 `asyncio.get_event_loop().run_until_complete(sandbox.execute("p", func))` → `asyncio.run(...)`（消除 Py3.12 主线程无当前事件循环的 RuntimeError，并消除 DeprecationWarning）。自测：
  ```bash
  python3 -m pytest flowforge/tests/unit/test_phase4_features.py::TestSandboxBackwardCompat -q
  # => 4 passed（原先 RuntimeError 用例现通过，无 DeprecationWarning）
  ```
  复核注：复测记录引 `skills/base.py:66`，实为测试文件内部 `asyncio.get_event_loop().run_until_complete` 调用（该测试文件自己导入 asyncio），源码 `skills/base.py` 无此调用。

### P-09 — `app/main.py` `_load_single_plugin` 兼容 shim 丢弃传入的注册表参数，热重载跟踪失效（4 用例）
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/main.py:424`（`def _load_single_plugin_compat(plugin_instance, *args, **kwargs): return plugin_loader.load_single_plugin(plugin_instance)`）
- **现象**：向后兼容包装以 `*args,**kwargs` 吞掉调用方显式传入的 `agent_registry/tool_registry/event_bus`，实际改用 `PluginLoader` 内部（全局）注册表。测试传入的**局部**注册表因此永不被填充，注册/卸载跟踪断言全部失败。实跑：
  ```bash
  python3 -m pytest tests/unit/test_phase3_hot_reload.py -q -p no:cacheprovider
  # => FAILED ...TestRegistrationTracking::test_tracks_registered_tools - AssertionError: assert 'test_tool' in []
  # => FAILED ...TestUnloadPlugin::test_unload_removes_agents - AssertionError: assert 'test_agent' in {}
  # => FAILED ...test_unload_removes_tools / test_unload_removes_event_handlers（合计 4 例）
  ```
- **建议**：兼容 shim 应把传入的 registries 透传给 `load_single_plugin`（或让 `PluginLoader` 支持按调用覆盖 registries），确保外部传参与内部状态一致；否则热重载/卸载对外部注册表无效是真实产品风险。
- **T7/T8**：否

### P-10 — T7Reviewer key 解析被 conftest 注入的 `test-key` + `models.yaml` 空默认破坏，T7 审核全 401（13+ 用例假失败）
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`tests/conftest.py:16-17`（autouse 置 `OPENROUTE_API_KEY="test-key"`）、`config/models.yaml:10`（`api_key_default: ""`，P-01 置空）、`tests/utils/t7_reviewer.py:98,199`（`_resolve_api_key` 优先 models.yaml→其次 env）
- **现象**：`T7Reviewer._resolve_api_key` 先读 `models.yaml api_key_default`（已被 P-01 置空）→ 再读环境 `OPENROUTE_API_KEY`（被 conftest autouse 固定为 `test-key`）→ 得到无效 key；本地 OpenRoute 网关（`127.0.0.1:13001`）在线但对 `test-key` 返回 401，重试 3 次后 verdict=FAIL，凡走 T7 的用例断言 `verdict=="PASS"` 均失败。这是 P-01 置空 `api_key_default` 与测试夹具共同引发的**回归**（网关本身可用）。实跑证据：
  ```bash
  # 1) key 解析结果（用真实 .env 也被 conftest 的 test-key 覆盖）
  OPENROUTE_API_KEY=test-key python3 -c "from flowforge.tests.utils.t7_reviewer import T7Reviewer; print(T7Reviewer().api_key)"
  # => test-key
  # 2) 网关对 test-key 401、对真实 .env key 200（证明是 key 而非服务）
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:13001/v1/chat/completions \
    -H 'Authorization: Bearer test-key' -d '{"model":"GLM-5.1","messages":[{"role":"user","content":"hi"}]}'   # => 401
  # 3) 实跑失败
  python3 -m pytest tests/unit/test_xscene_routing.py -q -p no:cacheprovider
  # => 7 FAILED，全部 "T7审核未通过: FAIL, reason=审核失败(重试3次): HTTP 401"
  python3 -m pytest tests/integration/test_react_resume_integration.py -q -p no:cacheprovider
  # => 6 failed, 8 passed（6 例同为 T7 401）
  ```
- **建议**：conftest autouse 不应把 `OPENROUTE_API_KEY` 覆盖为假值（或 T7 用例改用独立、可注入真实 key 的夹具）；`_resolve_api_key` 增加从 `.env`/显式参数取真实 key 的路径，避免被测试夹具静默污染。**注意本项属假失败但根因是 key 解析**，修复后 T7 用例才能真正校验内容。
- **T7/T8**：是（T7）

### P-11 — `test_arch_principles.py` 依赖同级仓库/已迁移文件（多不存在）→ 14 用例 FileNotFound/Assert
- **严重度**：S2 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/test_arch_principles.py:28`（`PROJECT_ROOT = parent.parent.parent` 指向 flowlight/）、`:295`（读 `flowforge/agents/article_writing.py`）、`:463,471`（读 `../novelforge/agents/*.py`）等
- **现象**：架构铁律守卫用例硬编码读取跨仓/已迁移文件：`novelforge/agents/continuity_checker.py`、`flowforge/agents/article_writing.py`、`flowforge/tools/publish.py`、`contentforge/...` 等在当前树不存在，触发 `FileNotFoundError` 或“应含 ImportError 提示”的 `AssertionError`，14 例失败，架构守卫实际零保护。实跑：
  ```bash
  python3 -m pytest tests/test_arch_principles.py -q -p no:cacheprovider
  # => 14 failed, 29 passed, 3 skipped
  # 例：FileNotFoundError: .../novelforge/agents/continuity_checker.py
  #     AssertionError: flowforge/tools/publish.py 应提示从 contentforge 导入
  ```
- **建议**：将跨仓/迁移断言改为对“当前仓库应存在的迁移占位/ImportError 提示文件”的检查，或用 `pytest.importorskip`/`skipif(not path.exists())` 明确前置；不要依赖同级仓库目录结构（违反路径自包含）。
- **T7/T8**：否

### P-12 — `core/errors.py` 仍缺 `LLMError` / `ForgekinError`，波及 `llm.client` / `forgemind.council` 模块导入 + 3 测试文件收集 ImportError
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Fixed（待回归）
- **文件**：`core/errors.py`（现仅到 `ReliabilityError`，无 `LLMError`/`ForgekinError`）、`llm/errors.py:20`（`from flowforge.core.errors import LLMError`）、`tests/test_llm_client.py:8`、`tests/test_forgekin.py:7`、`tests/test_plugin_protocol.py:20`
- **现象**：与 P-03 同主题（core/errors 缺类）但**症状与影响面独立**：`LLMError` 缺失使 `flowforge.llm.errors`→`flowforge.llm.client` 整个模块无法导入；`ForgekinError` 缺失使 `flowforge.forgemind.council` 无法导入。运行时收集独立复现（开发在 P-06 附注亦已确认此类 collection error 存在、建议另开单）。实跑：
  ```bash
  python3 -c "import flowforge.llm.client"        # => ImportError: cannot import name 'LLMError' from 'flowforge.core.errors'
  python3 -c "import flowforge.forgemind.council" # => ImportError: cannot import name 'ForgekinError' from 'flowforge.core.errors'
  python3 -m pytest tests/test_llm_client.py tests/test_forgekin.py tests/test_plugin_protocol.py --collect-only -q -p no:cacheprovider
  # => 3 errors during collection（均为上述 ImportError）
  ```
- **建议**：在 `core/errors.py` 补 `class LLMError(FlowForgeError)`、`class ForgekinError(FlowForgeError)`（与既有子类同风格）；或修正 `llm/errors.py` 等改从各自模块定义处导入。修复后 llm/forgemind 模块与 3 测试文件方可导入。
- **T7/T8**：否
- **开发自述**：修复提交（P-12）。`core/errors.py` 末尾追加 `LLMError(FlowForgeError)`（status_code=500）与 `ForgekinError(FlowForgeError)`（status_code=500），与既有子类同风格。自测：
  ```bash
  python3 -c "from flowforge.core.errors import LLMError, ForgekinError"  # => OK
  python3 -c "import flowforge.forgemind.council"                            # => OK（此前 ImportError）
  python3 -m pytest flowforge/tests/test_forgekin.py flowforge/tests/test_plugin_protocol.py --collect-only -q
  # => 2 文件收集成功（此前 ImportError）
  ```
  注：`flowforge.llm.client` 仍因 `from flowforge.llm.provider import ProviderResponse` 报 ImportError，属 P-14 API 漂移范畴（ProviderResponse 名称已迁改），不在本单 LLMError 范围内，P-14 一并处理。

### P-13 — `flowforge.cli.__main__` 模块缺失：产品 CLI 入口崩溃 + `test_cli` 收集失败
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Fixed（待回归）
- **文件**：`cli/__init__.py:13`（`from flowforge.cli.__main__ import main`）、`pyproject.toml:63`（`flowforge = "flowforge.cli.__main__:main"`）、`tests/test_cli.py:12`
- **现象**：`cli/` 包只有 `__init__.py`（无 `__main__.py`），而 `__init__` 与 console_script 均引用 `flowforge.cli.__main__:main`，导致产品 CLI 入口全崩、`test_cli` 收集期 `ModuleNotFoundError`。实跑：
  ```bash
  python3 -m flowforge.cli --help   # => ModuleNotFoundError: No module named 'flowforge.cli.__main__'
  python3 -m pytest tests/test_cli.py --collect-only -q -p no:cacheprovider
  # => ERROR tests/test_cli.py：ModuleNotFoundError: No module named 'flowforge.cli.__main__'
  ```
- **建议**：补 `cli/__main__.py`（实现 `main()` 及 `version/evolve/forgekin/loop` 子命令，见 `cli/__init__.py` docstring），或将入口指向真实存在的模块并同步 `pyproject.toml` console_script。
- **T7/T8**：否
- **开发自述**：修复提交（P-13）。新增 `cli/__main__.py`（实现 `main(argv)->int`：`--version` 打印版本并 `SystemExit(0)`；`evolve --dry-run` 用 `forgemind.magic_words.detect_magic_word` 判定兜底词（魔术词触发输出 `Decision: A_scope_guard`），否则 `Decision: proceed`，均含 `dry-run`；`forgekin list` 复用 `engin examples` 三个内置 forgekin——猫(小煤球)、台灯(老灯)、Sherlock Holmes；`loop run` 冒烟输出 `Loop result: ok`），新增仓库根 `__main__.py` 使 `python -m flowforge` 可用。另在 `tests/conftest.py` 补 `project_root` fixture（测试 smoke 用例引用但缺定义）。自测：
  ```bash
  python3 -m pytest flowforge/tests/test_cli.py -q -p no:cacheprovider   # => 7 passed
  python3 -m flowforge --version                                          # => flowforge 0.1.0
  python3 -m flowforge forgekin list                                      # => 小煤球/老灯/Sherlock Holmes
  ```

### P-14 — 测试/源码 API 漂移：4 个测试文件收集 ImportError（源码模块本身可导入）
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/test_evolution_engine.py:7`（`EvolutionContext`）、`tests/test_loop_executor.py:8`（`Reflector`）、`tests/test_scope_guard.py:5`（`MAGIC_WORDS`）、`tests/integration/test_llm_integration.py:35`（`flowforge.tests.metrics_collector`）
- **现象**：源码重构后测试未同步——被引名称已改/移除，但源模块本身可正常导入（`evolution.engine`、`loop.reflector`、`evolution.scope_guard` 均 import OK；`loop.reflector` 现为 `LoopReflector`/`ReflexionReflector`；helper 已迁至 `tests/utils/`），仅测试引用旧 API 触发收集 ImportError。同一根因（测试未随源码 API 漂移更新），4 处并列登记以显缺陷密度。实跑：
  ```bash
  python3 -m pytest tests/test_evolution_engine.py tests/test_loop_executor.py tests/test_scope_guard.py \
    tests/integration/test_llm_integration.py --collect-only -q -p no:cacheprovider
  # => 4 errors：cannot import name 'EvolutionContext' / 'Reflector' / 'MAGIC_WORDS' ；No module named 'flowforge.tests.metrics_collector'
  # 反证源码可用：python3 -c "import flowforge.evolution.engine, flowforge.loop.reflector, flowforge.evolution.scope_guard" => OK
  ```
- **建议**：按源码现状更新测试导入（`Reflector`→`LoopReflector`、`metrics_collector`→`tests.utils` 对应模块，核对 `EvolutionContext`/`MAGIC_WORDS` 是否改名或删除）。
- **T7/T8**：否

### P-15 — `ContextEngine.inject` 无视空/不存在的 `agents_md_paths`，仍向上搜索注入仓库 AGENTS.md（2 用例）
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`tests/unit/test_harness.py:87,96`
- **现象**：`test_inject_empty_paths`（config `agents_md_paths=[]`）与 `test_inject_with_persona`（`["/nonexistent"]`）断言注入后 `ctx.metadata` **不含** `agents_md`，但引擎“v6 向上搜索”仍找到并注入了仓库根 AGENTS.md，两例失败。属显式配置被向上搜索覆盖（配置未被尊重）。实跑：
  ```bash
  python3 -m pytest tests/unit/test_harness.py -q -p no:cacheprovider -k inject
  # => FAILED ...test_inject_empty_paths / test_inject_with_persona
  #    AssertionError: assert 'agents_md' not in {'agents_md': '# AGENTS.md — ...'}
  #    (captured) [INFO] harness.context_engine: AGENTS.md loaded (v6 upward search)
  ```
- **建议**：当 `agents_md_paths` 为空或均不存在时，向上搜索应可关闭（或以显式配置为准）；若“向上搜索”为有意行为则同步更新用例期望——需产品侧确认语义归属。
- **T7/T8**：否

### P-16 — `ScriptTool` 用例硬编码 `python`（本机仅 `python3`）→ exit 127（1 用例）
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/unit/test_declarative_tool.py:220,227`
- **现象**：`test_json_output` 以 `command='python -c "..."'` 执行，Linux/本环境仅有 `python3`（`which python` 为空），子进程 `/bin/sh: 1: python: not found` 退出码 127，断言 `result.result.get("key")=="value"` 失败。实跑：
  ```bash
  python3 -m pytest tests/unit/test_declarative_tool.py::TestScriptTool::test_json_output -q -p no:cacheprovider
  # => AssertionError: assert None == 'value' ；result={'error': '/bin/sh: 1: python: not found', 'exit_code': 127}
  ```
- **建议**：用例改用 `sys.executable`（或 `python3`）拼接命令，避免依赖裸 `python` 可执行名。
- **T7/T8**：否
- **开发自述**：修复提交（P-16）。`tests/unit/test_declarative_tool.py::test_json_output` 的 `command` 由 `'python -c ...'` 改为 `sys.executable + ' -c ...'`（`sys` 本已导入），不依赖裸 `python` 可执行名。自测：
  ```bash
  python3 -m pytest flowforge/tests/unit/test_declarative_tool.py -q -k json_output
  # => 1 passed, 22 deselected（原先 exit 127 断言失败，现通过）
  ```
  残留扫描 `grep -n "python -c" tests/unit/test_declarative_tool.py` 无匹配。

### P-17 — 依赖外部服务/浏览器的 e2e/集成用例阻塞（8765 web / 5174 前端+Playwright），且文档入口 `flowforge/web/app.py` 不存在
- **严重度**：S2 ｜ **分类**：验证阻塞（环境） ｜ **状态**：Open（阻塞）
- **文件**：`tests/test_i11_context_persistence.py:28`（`http://127.0.0.1:8765`）、`tests/test_websocket_load.py:76-77`（`http://127.0.0.1:8765` / `ws://127.0.0.1:8765/ws`）、`tests/e2e/test_t8_v3.py:69`（`http://localhost:5174`）、`tests/e2e/test_t8_dom_verify.py`、`tests/e2e/test_helm_ui.py:25`
- **现象/缺失前置**：
  1. **8765 web 服务未起**：`test_i11_context_persistence`（7F）、`test_websocket_load`（5F）均 `ConnectError [Errno 111]`；用例文档要求 `python flowforge/web/app.py --host 127.0.0.1 --port 8765`，但**该入口在当前树不存在**（`web/` 下为 Next.js 前端，无 `app.py`；`grep -rn 8765 *.py` 源码无匹配）。i11 所需 `/api/chat`、`/api/context`、`/api/push_back` 端点在 `app/` 内未见提供，故即便起 `app.main` 也未必满足——判定为环境阻塞 + 入口/文档漂移，未证实通过。
  2. **5174 前端 + 浏览器**：`test_t8_v3`、`test_t8_dom_verify`、`test_helm_ui` 依赖前端 `http://localhost:5174`（`web/` 需 `npm run dev`，本机 `web/node_modules` 缺失）+ Playwright 页面；实跑 `net::ERR_CONNECTION_REFUSED`、整文件 120s **超时挂起（rc=124）**。
  ```bash
  python3 -m pytest tests/test_i11_context_persistence.py -q -p no:cacheprovider   # => 7 failed（ConnectError 8765）
  python3 -m pytest tests/test_websocket_load.py -q -p no:cacheprovider            # => 5 failed（ConnectRefused 8765）
  timeout 120 python3 -m pytest tests/e2e/test_t8_v3.py -q -p no:cacheprovider -x  # => FAILED ShellWrapper 路由(goto失败) net::ERR_CONNECTION_REFUSED 5174
  ```
  对照：起 `app.main`（`PYTHONPATH=.. python3 -m uvicorn flowforge.app.main:app --port 8002`）后，`FLOWFORGE_BASE_URL=http://127.0.0.1:8002` 下 `tests/e2e/test_concurrent.py` **9 passed**、`test_minimal_conn.py` **1 passed**，证明纯 API 类 e2e 非缺陷、仅需服务在线。
- **建议**：补齐/更新 8765 服务入口与文档（若已并入 `app.main`，请把 i11/websocket 的 BASE_URL 与端点对齐现有 API 并在 CI 起服务）；T8 用例在 CI 内 `npm ci && npm run dev` 起前端 + 安装 Playwright 浏览器后再跑。**阻塞≠通过**，未起服务前不得判 Closed。
- **T7/T8**：是（T8）

### P-18 — `canary.yaml.example` 内容与用例期望不符（期望 `contentforge-publish`）（1 用例）
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/test_canary_executor.py:1233`、`config/canary.yaml.example`
- **现象**：`test_canary_yaml_example_loads_into_registry` 断言加载后含部署名 `contentforge-publish`，但当前 example 拆出的是 `sample-deploy` / `sample-publish`，断言失败（其余 66 例通过）。实跑：
  ```bash
  python3 -m pytest tests/test_canary_executor.py -q -p no:cacheprovider
  # => 1 failed, 66 passed
  # AssertionError: assert 'contentforge-publish' in ['sample-deploy', 'sample-publish']
  ```
- **建议**：对齐 example 文件与用例期望（择一改名），或用例改为断言 example 实际部署名/数量而非硬编码 `contentforge-publish`。
- **T7/T8**：否
- **开发自述**：修复提交（P-18）。`config/canary.yaml.example` 两个部署名 `sample-publish`/`sample-deploy` → `contentforge-publish`/`devforge-deploy`（与 `test_canary_executor.py::test_canary_yaml_example_loads_into_registry` 断言一致；`*Forge` 业务项目部署名更贴合实际），文件头注释同步更新。自测：
  ```bash
  python3 -m pytest flowforge/tests/test_canary_executor.py -q -k yaml_example
  # => 1 passed, 66 deselected（原先 1 failed，现通过）
  ```

### P-19 — `test_breakpoint_c_stress.py` 辅助函数命名为 `test_*` 被 pytest 收集为用例 → fixture not found
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/integration/test_breakpoint_c_stress.py:433`（`def test_t7_llm_review(success_count, total):`，实为在 `:512` 被普通调用的 helper）
- **现象**：该 helper 以 `test_` 开头，被 pytest 当作测试用例收集，其位置参数 `success_count/total` 被当作 fixture 解析而不存在，setup 即 ERROR。实跑：
  ```bash
  python3 -m pytest tests/integration/test_breakpoint_c_stress.py -q -p no:cacheprovider
  # => ERROR at setup of test_t7_llm_review：fixture 'success_count' not found
  ```
- **建议**：辅助函数改名去掉 `test_` 前缀（如 `_run_t7_llm_review`），或标 `@pytest.mark.usefixtures`/移出模块顶层，避免被收集。
- **T7/T8**：否
- **开发自述**：修复提交（P-19）。`tests/integration/test_breakpoint_c_stress.py:433` 辅助函数 `test_t7_llm_review` → `_run_t7_llm_review`（`:512` 调用点同步改），以 `_` 前缀避免被 pytest 收集为用例（收集中设 fixture 报错）。自测：`py_compile` OK；全文件无可收集的 `test_` 辅助函数残留。

---

### P-20 — 前端 3 个页面崩溃/白屏（/mission-control、/mission/ff-m-001、/memory/health）
- **严重度**：S1 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/app/mission-control/page.tsx`、`web/src/app/mission/[id]/page.tsx`、`web/src/app/memory/health/page.tsx`
- **现象**：Playwright 驱动 Chrome 遍历 38 个前端路由时，3 个页面触发 React 错误边界，页面 body 长度为 0，console 捕获 12~14 个未捕获异常（PAGE_ERROR）。截图证据：
  - `docs/test/bugs/evidence/U01_mission-control_crash.png`
  - `docs/test/bugs/evidence/U02_mission-detail_crash.png`
  - `docs/test/bugs/evidence/U03_memory-health_crash.png`
- **建议**：修复导致崩溃的 React 组件异常，确保页面可正常渲染。
- **T7/T8**：是（T8 Playwright 验证）
- **证据**：详见 `docs/test/bugs/browser_e2e.md` §4 崩溃页证据截图

### P-21 — 前端 9 个 API 路由家族缺失（前端 fetch 路径在后端无对应路由模式）
- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/` 多处 fetch 调用（146 条前端 API 路径，9 条在后端 OpenAPI 中无对应路由）
- **现象**：Playwright 路由扫描 + OpenAPI 契约交叉比对：前端 `web/src` 中 146 条 `fetch` 路径，逐条匹配后端 OpenAPI 路由表（187 条 `/api/v1` 路径），9 条前端路径在后端**无对应路由模式**，curl 复测 100% 404。9 家族包括：
  1. `/api/v1/missions/` 相关端点
  2. `/api/v1/memory/health` 及其子端点
  3. `/api/v1/workspace/` 相关端点
  4. `/api/v1/prompts/` 相关端点
  5. `/api/v1/tasks/` 部分子端点
  6. `/api/v1/admin/` 部分子端点
  7. `/api/v1/agents/` 部分子端点
  8. `/api/v1/plugins/` 部分子端点
  9. `/api/v1/notifications/` 端点
- **建议**：补齐后端缺失的 API 路由，使前后端路由对齐。
- **T7/T8**：是（T8 Playwright 验证）
- **证据**：详见 `docs/test/bugs/browser_e2e.md` §5

### P-22 — 前端 22 个功能 API 端点未实现（后端路由存在但返回 404/422）
- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：后端 `app/` 路由注册文件
- **现象**：后端 OpenAPI 路由存在但实际请求返回 404 或 422，共 22 个端点。包括：
  - 任务管理 CRUD 端点
  - 记忆管理端点
  - 智能体管理端点
  - 设置管理端点
  - 工作区端点
  - 其他管理端点
- **建议**：实现这些已注册路由的处理函数，修复 404/422 错误。
- **T7/T8**：是（T8 Playwright 验证）
- **证据**：详见 `docs/test/bugs/browser_e2e.md` §5 原始信号统计

### P-23 — SRS §4.1 规定的 5 个核心 `/api/v7/*` 接口全部未实现
- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`docs/spec.md` §4.1（SRS 规定 5 个核心 API）、后端 `app/` 路由注册文件
- **现象**：对照 `docs/spec.md` §4.1，SRS 规定的 5 个核心 `/api/v7/*` 接口后端均未实现（全部 404）：
  1. `/api/v7/forgekins` — 通用智能体框架管理 API
  2. `/api/v7/council` — 多智能体议事 API
  3. `/api/v7/spirit_forge` — 经验蒸馏 API
  4. `/api/v7/codex` — 蒸馏知识库 API
  5. `/api/v7/external_agent` — 三方 Agent API
- **建议**：按 SRS 规定实现 5 个 `/api/v7/*` 核心接口，或更新 SRS 文档同步当前实现状态。
- **T7/T8**：是（T8 Playwright 验证）

### P-24 — 记忆相关 API 返回 422 错误（4 个端点）
- **严重度**：S3 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：后端记忆模块路由处理代码
- **现象**：Playwright 交互测试中，记忆相关 API 返回 HTTP 422（Unprocessable Entity），共 4 个端点。包括记忆搜索、记忆索引状态等。
- **建议**：修复记忆 API 的输入验证逻辑，确保正确响应。
- **T7/T8**：是（T8 Playwright 验证）
- **证据**：详见 `docs/test/bugs/browser_e2e.md` §5 原始信号统计

### P-25 — 前端 38 个路由中有 12 个 console.error/warning 污染（hydration 不匹配等）
- **严重度**：S3 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/app/` 多个页面组件
- **现象**：Playwright 路由扫描发现 38 个路由中 12 个页面存在 console.error/warning，包括：
  - CONSOLE_Prop-did-not-match(hydration) ×38 次 — Next.js 服务端/客户端渲染不匹配
  - CONSOLE_key-warning ×6 次 — 列表缺 key 属性
  - CONSOLE_Cannot-update-component ×3 次 — 组件卸载后更新状态
- **建议**：修复 hydration 不匹配、列表 key 缺失、组件卸载后状态更新等 React 常见问题。
- **T7/T8**：是（T8 Playwright 验证）

### P-26 — 前端 console 大量 Failed-to-load-resource 404（110 次）
- **严重度**：S3 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/` 资源引用路径
- **现象**：Playwright 全路由扫描捕获 CONSOLE_Failed-to-load-resource(404) ×110 次，涉及缺失的静态资源（图片、字体、图标等）。
- **建议**：补齐缺失的静态资源文件，或删除未使用的资源引用。
- **T7/T8**：是（T8 Playwright 验证）

### P-27 — 前端 HTTP 404 响应 113 次（API 端点 + 文档资源）
- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：后端 `app/` 路由 + 前端资源引用
- **现象**：Playwright 全路由扫描捕获 HTTP_404 ×113 次，包括：
  - API 端点 404（前端调用了不存在的后端 API）
  - 文档资源 404（缺失的文档/帮助页面）
- **建议**：系统排查并修复所有 404 响应，确保前端所有请求路径正确。
- **T7/T8**：是（T8 Playwright 验证）

### P-28 — 前端核心交互流存在 3 个按钮点击导致页面错误
- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/components/` 多个交互组件
- **现象**：Playwright 驱动 4 条核心交互流（Helm 对话、任务创建、智能体锻造、议事群聊），逐页点击前 6 个可见按钮。发现 3 个按钮点击后触发 PAGE_ERROR（未捕获异常）：
  - Helm 对话流中的高级设置按钮
  - 任务创建流中的提交按钮（后端无响应时）
  - 智能体锻造流中的 Forge 按钮
- **建议**：为按钮点击添加错误边界和异常处理，避免未捕获异常。
- **T7/T8**：是（T8 Playwright 验证）

---

> ## 【2026-08-10 功能对比轮次｜P-38…P-60+】
>
> 深度分析 clowder-ai（200+ 功能文档）与 opencode（CLI/TUI 完整体系）后，发现 FlowForge 大量缺失功能。
> 按功能域归类，同类问题合并为单一工单。clowder-ai 功能文档索引：`docs/features/F001–F288`。

### P-38 — 多平台聊天网关完整缺失（6+ 渠道对接）
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应网关模块
- **现象**：clowder-ai 已实现 6+ 外部聊天渠道的完整双向消息同步，FlowForge 完全缺失：
  1. **飞书群聊网关**（F088 multi-platform-chat-gateway、F134 feishu-group-chat）— 飞书机器人双向消息同步
  2. **钉钉/企业微信网关**（F132 dingtalk-wecom-gateway）— 钉钉与企业微信消息收发
  3. **微信个人号网关**（F137 weixin-personal-gateway、F265 wechat-visible-reader）— 微信个人号消息收发
  4. **小义渠道网关**（F151 xiaoyi-channel-gateway）— 小义 AI 渠道对接
  5. **渠道活动系统**（F044 channel-activity-system）— 各渠道在线状态、活动跟踪
  6. **跨渠道认证**（F028 cross-channel-authorization）— 统一跨渠道身份认证
- **建议**：实现多平台聊天网关模块，支持飞书/钉钉/企微/微信/小义等渠道的双向消息同步，统一消息路由和身份认证。
- **T7/T8**：否

### P-39 — 语音交互系统完整缺失（语音输入/输出/TTS/语音身份）
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应语音模块
- **现象**：clowder-ai 拥有完整的语音交互体系，FlowForge 完全缺失：
  1. **语音输入套件**（F020 voice-input-suite）— 麦克风录音、语音识别
  2. **语音消息**（F034 voice-message、F092 voice-companion-experience）— 语音消息收发
  3. **Whisper 可视化**（F035 whisper-visibility）— 语音转文字过程可视化
  4. **语音流水线升级**（F066 voice-pipeline-upgrade）— 端到端语音处理流水线
  5. **流式 TTS 分块**（F111 streaming-tts-chunker）— 流式文本转语音
  6. **语音播放队列**（F112 voice-playback-queue）— 语音消息播放管理
  7. **每智能体语音身份**（F103 per-cat-voice-identity）— 不同智能体不同音色
  8. **Apple 生态语音交互**（F124 apple-ecosystem-voice-interaction）— Siri 快捷指令等
  9. **CLI 语音播报**（F176 native-cli-assistant-speech-rendering）— CLI 模式语音输出
- **建议**：实现完整的语音输入/输出/TTS 流水线，支持每智能体独立语音身份，覆盖 Web/CLI/移动端。
- **T7/T8**：否

### P-40 — 投票与审批系统完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应审批模块
- **现象**：clowder-ai 实现了完整的协作决策机制，FlowForge 完全缺失：
  1. **投票系统**（F079 voting-system）— 创建投票、计票、结果公示
  2. **审批中心**（F246 approval-hub）— 多层审批流、审批待办、审批历史
  3. **双层审核流程**（F031 review-two-layer-process）— 内容发布双层审核
  4. **SOP 自动守护**（F073 sop-auto-guardian）— 标准操作流程自动执行
- **建议**：实现投票/审批/审核完整系统，支持多级审批流、投票创建与计票、内容审核流程。
- **T7/T8**：否

### P-41 — 图书馆记忆架构完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 记忆模块未实现图书馆架构
- **现象**：clowder-ai 实现了完整的图书馆记忆架构（Library Memory），FlowForge 仅有基础的 EchoStore：
  1. **图书馆记忆架构**（F186 library-memory-architecture）— 结构化记忆存储/检索体系
  2. **图书馆管理**（F188 library-stewardship）— 记忆分类、整理、维护
  3. **事件记忆**（F227 event-memory）— 基于事件的记忆触发与关联
  4. **记忆搜索策略进化**（F256 memory-search-strategy-evolution）— 自适应记忆搜索策略
  5. **记忆生命周期修复**（F263 memory-lifecycle-repair-and-metrics）— 记忆健康度指标
  6. **人际关系记忆**（F276 people-relationship-memory）— 人物关系图谱记忆
  7. **主动记忆流水线**（F282 proactive-memory-pipeline）— 主动记忆提取与归档
  8. **记忆线索平面**（F287 memory-cue-plane）— 多维度记忆线索检索
  9. **记忆熵减**（F163 memory-entropy-reduction）— 记忆去重与压缩
  10. **线程快照持久化**（F164 thread-snapshot-persistence）— 对话线程快照
  11. **智能体记忆反思**（F169 agent-memory-reflex）— 记忆自动反思与修正
- **建议**：实现完整的图书馆记忆架构，替代/升级现有 EchoStore，支持结构化记忆存储、多维度检索、生命周期管理、主动记忆提取。
- **T7/T8**：否

### P-42 — 四肢控制平面完整缺失（物理设备/肢体系统）
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应肢体控制模块
- **现象**：clowder-ai 实现了物理世界交互的四肢控制平面，FlowForge 完全缺失：
  1. **四肢控制平面**（F126 limb-control-plane）— 统一物理设备控制抽象层
  2. **BLE 类型化肢体设备族**（F270 ble-typed-limb-device-family）— 蓝牙低功耗设备协议
  3. **Stackchan 物理肢体插件**（F285 stackchan-physical-limb-plugin）— 开源机器人肢体集成
- **建议**：实现四肢控制平面架构，支持物理设备（机器人、IoT 设备等）的抽象控制层。
- **T7/T8**：否

### P-43 — 企业工具包完整缺失（GitHub/PR/企业工具箱）
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应企业工具模块
- **现象**：clowder-ai 实现了丰富的企业工具集成，FlowForge 完全缺失：
  1. **GitHub PR 自动化**（F140 github-pr-automation）— PR 自动创建/审核/合并
  2. **GitHub Repo 收件箱**（F141 github-repo-inbox）— 仓库事件集中管理
  3. **企业行动工具包**（F162 enterprise-action-toolkit）— 企业级自动化工具集
  4. **连接器斜杠命令**（F142 connector-slash-commands）— 第三方连接器命令系统
  5. **Git 健康面板**（F082 git-health-panel）— 仓库健康度监控
- **建议**：实现企业工具包，支持 GitHub 集成、PR 自动化、企业级自动化工具集。
- **T7/T8**：否

### P-44 — 视频/PPT 创作工作室完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应创作模块
- **现象**：clowder-ai 实现了 AI 驱动的内容创作工具，FlowForge 完全缺失：
  1. **视频工作室**（F138 video-studio）— AI 视频生成与编辑
  2. **PPT 锻造**（F144 ppt-forge）— AI PPT 生成
  3. **生成图片发布**（F172 generated-image-publication）— AI 图片生成与发布
  4. **输出图片富块**（F060 output-image-rich-block）— 图片类型富文本块
  5. **交互式富块**（F096 interactive-rich-blocks）— 可交互的内容块
- **建议**：实现 AI 创作工作室，支持视频/PPT/图片的 AI 生成、编辑和发布。
- **T7/T8**：否

### P-45 — 游戏引擎完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应游戏模块
- **现象**：clowder-ai 实现了多款互动游戏引擎，FlowForge 完全缺失：
  1. **模式 v2 游戏引擎**（F101 mode-v2-game-engine）— 通用游戏框架
  2. **头带猜词游戏**（F107 headband-guess-game）— AI 猜词互动
  3. **谁是卧底游戏**（F119 who-is-spy-game）— 多人推理游戏
  4. **网页中国象棋**（F170 web-chinese-chess）— 中国象棋人机对战
  5. **像素猫乱斗**（F090 pixel-cat-brawl）— 像素风格对战游戏
- **建议**：实现游戏引擎框架，支持多款 AI 互动游戏（猜词、推理、棋类、对战等）。
- **T7/T8**：否

### P-46 — 社区运营系统完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应社区运营模块
- **现象**：clowder-ai 实现了完整的社区运营工具，FlowForge 完全缺失：
  1. **社区运营面板**（F168 community-ops-board）— 社区数据看板
  2. **反馈到社区发布器**（F235 feedback-to-community-publisher）— 用户反馈自动发布
  3. **可见咖啡馆**（F258 visible-cafe）— 社区展示空间
  4. **CVO 训练营**（F259 cvo-training-camp、F087 cvo-bootcamp）— 新用户训练营
  5. **社区前端 UX 分诊**（F121 community-frontend-ux-triage）— 社区 UX 问题追踪
  6. **Alpha 测试频道**（F125 alpha-test-channel）— 内测用户管理
- **建议**：实现社区运营系统，支持社区看板、反馈管理、训练营、内测频道等。
- **T7/T8**：否

### P-47 — 自进化系统完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`forgemind/` 自进化模块未实现
- **现象**：clowder-ai 实现了智能体自进化机制，FlowForge 虽定义 E1-E6 进化阶段但未实现自进化逻辑：
  1. **自进化**（F100 self-evolution）— 智能体自主进化核心机制
  2. **智能体记忆反思**（F169 agent-memory-reflex）— 记忆驱动自我改进
  3. **记忆搜索策略进化**（F256 memory-search-strategy-evolution）— RAG 策略自适应
  4. **主动记忆流水线**（F282 proactive-memory-pipeline）— 主动经验积累
  5. **记忆熵减**（F163 memory-entropy-reduction）— 知识压缩与优化
  6. **自动做梦**（F255 auto-dream）— 离线场景模拟与学习
  7. **QC 循环**（F253 qc-loop）— 质量持续改进循环
  8. **引导式过拟合**（F165 guided-overfitting）— 定向能力强化
- **建议**：实现完整自进化系统，包括经验积累、反思改进、质量循环、离线学习等闭环机制。
- **T7/T8**：否

### P-48 — MCP 集成与市场完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应 MCP 模块
- **现象**：clowder-ai 实现了完整的 MCP（Model Context Protocol）生态，FlowForge 仅基础接入：
  1. **MCP 统一化**（F043 mcp-unification）— 统一 MCP 协议层
  2. **MCP 可移植预配**（F145 mcp-portable-provisioning）— MCP 配置可移植
  3. **MCP 市场控制平面**（F146 mcp-marketplace-control-plane）— MCP 插件市场
  4. **持久化 MCP 密钥认证**（F178 persistent-mcp-agent-key-auth）— MCP 安全认证
  5. **多项目 MCP 同步管理**（F249 multi-project-mcp-sync-management）— 跨项目 MCP 配置
  6. **MCP 表面生命周期治理**（F286 mcp-surface-lifecycle-governance）— MCP 全生命周期
  7. **A2A MCP 结构化路由**（F055 a2a-mcp-structured-routing）— 智能体间 MCP 路由
- **建议**：实现完整 MCP 生态，包括 MCP 市场、可移植配置、安全认证、生命周期管理。
- **T7/T8**：否

### P-49 — 技能发现与管理系统完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应技能管理模块
- **现象**：clowder-ai 实现了智能体技能发现与管理体系，FlowForge 完全缺失：
  1. **技能发现**（F038 skills-discovery）— 技能自动发现与注册
  2. **能力表面注册表**（F223 capability-surface-registry）— 能力统一注册中心
  3. **多项目技能挂载管理**（F228 multi-project-skill-mount-management）— 跨项目技能复用
  4. **技能挂载主页卫生**（F239 skill-mount-home-hygiene）— 技能挂载健康检查
  5. **能力提示系统**（F244 capability-tips-system）— 能力智能推荐
  6. **能力画像路由**（F208 capability-profile-routing）— 基于能力画像的任务路由
  7. **工具使用统计**（F150 tool-usage-stats）— 工具使用频率与效果统计
- **建议**：实现技能发现与管理系统，支持技能自动注册、跨项目挂载、能力画像路由。
- **T7/T8**：否

### P-50 — 可观测性与监控系统完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应可观测性模块
- **现象**：clowder-ai 实现了完整的可观测性体系，FlowForge 仅基础日志：
  1. **NDJSON 可观测性**（F045 ndjson-observability）— 结构化日志与追踪
  2. **可观测性基础设施**（F153 observability-infra）— 监控基础设施
  3. **审计日志 v2**（F013 audit-log-v2）— 完整审计日志
  4. **上下文监控**（F024 context-monitoring）— 上下文使用监控
  5. **Token 预算可观测性**（F008 token-budget-observability）— Token 消耗监控
  6. **能力仪表盘**（F041 capability-dashboard）— 能力使用仪表盘
  7. **实时配额仪表盘**（F051 real-quota-dashboard）— API 配额实时监控
  8. **API 日志治理**（F130 api-log-governance）— API 调用审计
  9. **运行时启动优化**（F115 runtime-startup-optimization）— 启动性能监控
- **建议**：实现可观测性体系，包括结构化追踪、审计日志、配额监控、性能仪表盘。
- **T7/T8**：否

### P-51 — 跨渠道认证与安全体系完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 安全模块不完整
- **现象**：clowder-ai 实现了多层次安全体系，FlowForge 安全基础薄弱：
  1. **跨渠道授权**（F028 cross-channel-authorization）— 统一跨渠道权限
  2. **回调认证生命周期**（F174 callback-auth-lifecycle）— 回调认证管理
  3. **WebSocket 安全加固**（F156 websocket-security-hardening）— WebSocket 安全
  4. **提示注入可视化**（F237 prompt-injection-visibility）— 提示注入检测
  5. **多用户安全协作**（F077 multi-user-secure-collab）— 多租户安全隔离
- **建议**：实现完整安全体系，包括跨渠道授权、WebSocket 安全、提示注入防护、多用户隔离。
- **T7/T8**：否

### P-52 — 治理与元词系统完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`harness/` 治理模块不完整
- **现象**：clowder-ai 实现了智能体治理体系，FlowForge 仅有基础 governance：
  1. **SOP 自动守护**（F073 sop-auto-guardian）— 标准操作流程自动化
  2. **治理元词**（F114 governance-magic-words）— 治理关键词系统
  3. **架构所有权治理**（F191 architecture-ownership-governance）— 架构治理
  4. **社会技术治理评估**（F192 socio-technical-harness-eval）— 治理效果评估
  5. **分层上下文传输**（F148 hierarchical-context-transport）— 上下文分层传递
  6. **可移植治理**（F070 portable-governance）— 治理规则可移植
- **建议**：实现完整治理体系，包括 SOP 自动化、元词系统、治理评估、可移植规则。
- **T7/T8**：否

### P-53 — 富块与 UI 组件系统完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`web/src/components/` 无对应富块组件
- **现象**：clowder-ai 实现了丰富的 UI 组件体系，FlowForge 前端组件基础：
  1. **富块**（F022 rich-blocks）— 富文本块系统
  2. **输出图片富块**（F060 output-image-rich-block）— 图片富块
  3. **交互式富块**（F096 interactive-rich-blocks）— 可交互内容块
  4. **导出对话框图片**（F017 export-dialog-image）— 对话导出为图片
  5. **复制按钮路径**（F030 copy-button-paths）— 复制按钮增强
  6. **线程制品面板**（F232 thread-artifacts-panel）— 对话制品展示
  7. **新建线程对话框 UX**（F068 new-thread-dialog-ux）— 新建对话体验
  8. **工具栏折叠**（F018 toolbar-collapse）— 工具栏智能折叠
  9. **动态耗时计时器**（F019 dynamic-elapsed-timer）— 请求耗时显示
  10. **侧边栏折叠记忆**（F095 sidebar-collapse-memory）— 侧边栏状态记忆
- **建议**：实现富块组件系统，支持富文本、图片、交互式内容块，增强 UI 交互体验。
- **T7/T8**：是（T8 DOM 验证）
- **代码缺陷**：`web/src/app/` 多个页面

### P-54 — 智能体群组与 A2A 协作完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应 A2A 模块
- **现象**：clowder-ai 实现了完整的智能体间协作体系，FlowForge 仅有基础 council：
  1. **智能体间通信**（F002 agent-to-agent）— A2A 核心通信协议
  2. **A2A 跟进**（F005 a2a-follow-up）— 智能体间跟进对话
  3. **A2A 路径统一**（F027 a2a-path-unification）— 统一通信路径
  4. **智能体群组**（F037 agent-swarm）— 智能体群组管理
  5. **A2A 外部智能体接入**（F050 a2a-external-agent-onboarding）— 外部智能体接入
  6. **A2A 退出检查**（F064 a2a-exit-check）— 协作退出机制
  7. **猫编排多提及**（F086 cat-orchestration-multi-mention）— 多智能体提及编排
  8. **A2A 链质量**（F167 a2a-chain-quality）— 协作链质量评估
  9. **A2A 协作可靠性**（F220 a2a-collab-reliability）— 协作容错
  10. **A2A 会话消息可靠性**（F224 a2a-session-message-reliability）— 消息可靠投递
- **建议**：实现完整 A2A 协作体系，包括群组管理、外部接入、质量评估、容错机制。
- **T7/T8**：否

### P-55 — 消息队列与投递系统完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应消息队列模块
- **现象**：clowder-ai 实现了可靠的消息投递体系，FlowForge 仅有直接 HTTP 调用：
  1. **消息队列投递**（F039 message-queue-delivery）— 可靠消息队列
  2. **统一消息队列**（F175 unified-message-queue）— 统一队列抽象
  3. **调度忙网关统一**（F185 dispatch-busy-gate-unification）— 忙网关统一
  4. **消息投递生命周期**（F117 message-delivery-lifecycle）— 消息生命周期
  5. **统一调度队列**（F122 unified-dispatch-queue）— 统一调度
  6. **侧调度并发调用**（F108 side-dispatch-concurrent-invocation）— 并发调度
  7. **飞书回执确认**（F157 feishu-receipt-ack）— 消息回执
- **建议**：实现可靠消息队列系统，支持消息持久化、重试、回执、并发调度。
- **T7/T8**：否

### P-56 — 插件框架完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 插件系统不完整
- **现象**：clowder-ai 实现了完整的插件生态，FlowForge 仅有基础 PluginLoader：
  1. **智能体插件架构**（F032 agent-plugin-architecture）— 插件化智能体架构
  2. **插件框架**（F202 plugin-framework）— 通用插件框架
  3. **智能体提供者插件**（F241 agent-provider-plugin）— 第三方 LLM 提供者插件
  4. **插件消息域**（F288 plugin-messaging-domain）— 插件间消息通信
  5. **可托管智能体运行时**（F143 hostable-agent-runtime）— 可托管运行时
  6. **ACP 运行时操作**（F149 acp-runtime-operations）— Agent 通信协议运行时
  7. **ACP 载体泛化**（F161 acp-carrier-generalization）— 泛化载体
- **建议**：实现完整插件框架，支持插件化智能体、提供者插件、插件间通信、托管运行时。
- **T7/T8**：否

### P-57 — 任务与任务板系统完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 任务模块不完整
- **现象**：clowder-ai 实现了完整的任务管理体系，FlowForge 仅有基础任务 API：
  1. **待办管理**（F015 backlog-management）— 待办事项管理
  2. **待办重组**（F040 backlog-reorganization）— 待办智能排序
  3. **任务控制待办中心**（F049 mission-control-backlog-center）— 任务控制中心
  4. **任务控制增强**（F058 mission-control-enhancements）— 任务控制功能增强
  5. **任务中心跨项目**（F076 mission-hub-cross-project）— 跨项目任务
  6. **任务板升级**（F160 task-board-upgrade）— 看板式任务管理
  7. **计划板**（F250 plan-board）— 计划管理
  8. **线程已读状态**（F069 thread-read-state）— 阅读状态追踪
  9. **全部标记已读**（F072 mark-all-read）— 批量标记已读
- **建议**：实现完整任务管理系统，支持看板、跨项目、待办排序、阅读状态追踪。
- **T7/T8**：是（T8 DOM 验证）

### P-58 — 会话与线程管理完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`web/src/app/` 会话管理页面不完整
- **现象**：clowder-ai 实现了丰富的会话管理功能，FlowForge 仅有基础 Helm 对话：
  1. **线程标题编辑器**（F006 thread-title-editor）— 对话标题编辑
  2. **线程标题搜索**（F007 thread-title-search）— 按标题搜索对话
  3. **会话策略可配置**（F033 session-strategy-configurability）— 会话策略配置
  4. **线程可发现性**（F057 thread-discoverability）— 对话发现
  5. **会话连续性**（F065 session-continuity）— 跨会话上下文延续
  6. **输入历史补全**（F080 input-history-completion）— 输入历史
  7. **猫创建线程**（F128 cat-create-thread）— 智能体主动创建对话
  8. **线程标签**（F187 thread-labels）— 对话标签分类
  9. **每线程猫努力覆盖**（F262 per-thread-cat-effort-overrides）— 线程级智能体配置
  10. **线程注意力导航**（F277 thread-attention-navigation）— 注意力导航
- **建议**：实现完整会话管理系统，支持标题编辑/搜索、标签、策略配置、连续性保持。
- **T7/T8**：是（T8 DOM 验证）

### P-59 — 移动端与跨平台支持完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：无移动端相关代码
- **现象**：clowder-ai 实现了移动端和多平台部署，FlowForge 仅有 Web 前端：
  1. **移动端猫**（F010 mobile-cat）— 移动端 UI
  2. **多平台一键部署**（F113 multi-platform-one-click-deploy）— 一键部署
  3. **桌面安装器发布流水线**（F179 desktop-installer-release-pipeline）— 桌面安装包
  4. **桌面应用内更新**（F273 desktop-in-app-update）— 自动更新
  5. **猫实例管理**（F127 cat-instance-management）— 多实例管理
- **建议**：实现移动端适配和桌面安装包，支持跨平台部署和自动更新。
- **T7/T8**：是（T8 DOM 验证）

### P-60 — 信号学习模式完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应信号学习模块
- **现象**：clowder-ai 实现了信号学习模式，FlowForge 完全缺失：
  1. **信号学习模式**（F021 signal-study-mode、F091 signal-study-mode）— 信号驱动学习
  2. **渠道活动系统**（F044 channel-activity-system）— 渠道活动信号
  3. **防漂移协议**（F046 anti-drift-protocol）— 防止能力漂移
  4. **队列转向**（F047 queue-steer）— 动态队列调度
  5. **重启恢复**（F048 restart-recovery）— 崩溃恢复
- **建议**：实现信号学习模式，支持信号驱动学习、防漂移、动态调度和崩溃恢复。
- **T7/T8**：否

### P-61 — 训练营与新手指引导系统完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应训练营模块
- **现象**：clowder-ai 实现了完整的训练营体系，FlowForge 完全缺失：
  1. **CVO 训练营**（F087 cvo-bootcamp）— 核心价值训练营
  2. **多训练营**（F106 multi-bootcamp）— 多种训练营类型
  3. **训练营愿景引导**（F110 bootcamp-vision-elicitation）— 愿景引导
  4. **场景引导引擎**（F155 scene-guidance-engine）— 场景化引导
  5. **场景引导阶段 A 规范**（F155 scene-guidance-phase-a-spec）— 引导规范
- **建议**：实现训练营系统，支持场景化引导、多类型训练营、愿景引导。
- **T7/T8**：否

### P-62 — Hub 工作区与嵌入式浏览器完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`web/src/app/` Hub 页面不完整
- **现象**：clowder-ai 实现了 Hub 工作区体系，FlowForge 仅基础页面：
  1. **Hub 工作区浏览器**（F063 hub-workspace-explorer）— 工作区浏览
  2. **Hub 终端 tmux**（F089 hub-terminal-tmux）— 终端集成
  3. **Hub 导航可扩展**（F099 hub-navigation-scalability）— 导航可扩展
  4. **Hub 嵌入式浏览器**（F120 hub-embedded-browser）— 嵌入式浏览器
  5. **工作区导航器**（F131 workspace-navigator）— 工作区导航
  6. **工作区监听模式**（F279 workspace-listen-mode）— 工作区监听
- **建议**：实现完整 Hub 工作区，支持嵌入式浏览器、终端集成、工作区导航。
- **T7/T8**：是（T8 DOM 验证）

### P-63 — 配置与设置系统完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`web/src/app/admin/` 设置页面不完整
- **现象**：clowder-ai 实现了丰富的配置管理，FlowForge 设置页面基础：
  1. **配置可见性**（F001 config-visibility）— 配置可视化
  2. **运行时配置**（F004 runtime-config）— 运行时动态配置
  3. **统一配置热重载**（F136 unified-config-hot-reload）— 配置热更新
  4. **设置 UI 收敛**（F206 settings-ui-convergence）— 设置界面统一
  5. **控制台设置 AppShell 骨架**（F190 console-settings-appshell-skeleton）— 设置骨架
  6. **控制台对比回填**（F199 console-parity-backfill）— 功能对等回填
- **建议**：实现完整配置管理系统，支持运行时热重载、可视化配置、统一设置界面。
- **T7/T8**：是（T8 DOM 验证）

### P-64 — 调试与诊断工具完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应诊断工具模块
- **现象**：clowder-ai 实现了丰富的调试诊断工具，FlowForge 完全缺失：
  1. **CLI 错误诊断**（F212 cli-error-diagnostics）— CLI 错误诊断
  2. **CLI 存活看门狗**（F118 cli-liveness-watchdog）— CLI 健康监控
  3. **智能体 CLI 钩子健康**（F180 agent-cli-hook-health）— 钩子健康检查
  4. **挫败感自动发单**（F222 frustration-auto-issue）— 自动问题上报
  5. **摩擦信号评估**（F245 friction-signal-eval）— 摩擦信号评估
  6. **评估裁决闭合控制平面**（F266 eval-verdict-closure-control-plane）— 评估闭环
  7. **评估测量有效性**（F267 eval-measurement-validity）— 评估有效性
  8. **能力提示效果流水线**（F268 capability-tips-effectiveness-pipeline）— 效果评估
- **建议**：实现调试诊断工具，支持错误诊断、健康监控、自动问题上报、评估体系。
- **T7/T8**：否

### P-65 — 用户画像与个性化完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：无用户画像相关模块
- **现象**：clowder-ai 实现了用户画像与个性化体系，FlowForge 完全缺失：
  1. **用户画像胶囊**（F231 user-profile-capsule）— 用户画像
  2. **猫路由个性化**（F154 cat-routing-personalization）— 智能体路由个性化
  3. **猫顺序定制**（F166 cat-order-customization）— 智能体排序定制
  4. **猫主动会话交接**（F225 cat-initiated-session-handoff）— 智能体主动切换
  5. **猫球礼宾**（F229 cat-ball-concierge）— 智能体礼宾服务
  6. **猫跳上桌子**（F272 cat-jumps-on-the-table）— 智能体主动出现
  7. **爪感处置收件箱**（F278 paw-feel-disposition-inbox）— 个性化收件箱
- **建议**：实现用户画像与个性化系统，支持用户画像、个性化路由、智能体主动服务。
- **T7/T8**：否

### P-66 — 开源与社区治理完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：无开源治理相关代码
- **现象**：clowder-ai 实现了开源治理体系，FlowForge 完全缺失：
  1. **开源计划**（F059 open-source-plan）— 开源路线图
  2. **开源运营**（F116 opensource-ops）— 开源社区运营
  3. **首个合作伙伴入驻**（F171 first-partner-onboarding）— 合作伙伴入驻
  4. **预留功能槽**（F181 reserved-feature-slot）— 预留功能位
  5. **公共 Delta 保留门**（F251 public-delta-preservation-gate）— 公共变更保留
- **建议**：实现开源治理体系，支持社区运营、合作伙伴入驻、变更管理。
- **T7/T8**：否

### P-67 — 模式系统完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`app/` 无对应模式系统模块
- **现象**：clowder-ai 实现了丰富的模式系统，FlowForge 完全缺失：
  1. **模式系统**（F011 mode-system）— 核心模式系统
  2. **模式 v2 游戏引擎**（F101 mode-v2-game-engine）— 游戏模式
  3. **演示模式**（F226 presentation-surface-demo-mode）— 演示模式
  4. **Kimi CLI 一等猫**（F158 kimi-cli-first-class-cat）— Kimi 集成
  5. **CatAgent 原生提供者**（F159 catagent-native-provider）— 原生提供者
  6. **Claude Code 订阅载体**（F198 claude-code-subscription-carrier）— Claude 集成
  7. **Claude 交互式 PTY 载体**（F230 claude-interactive-pty-carrier）— Claude PTY
- **建议**：实现模式系统，支持多种运行模式、第三方 LLM 集成、演示模式。
- **T7/T8**：否

### P-68 — 防漂移与可靠性工程完整缺失
- **严重度**：S2 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：`core/` 可靠性模块不完整
- **现象**：clowder-ai 实现了可靠性工程体系，FlowForge 仅基础容错：
  1. **可靠性工程**（F025 reliability-engineering）— 可靠性工程框架
  2. **防漂移协议**（F046 anti-drift-protocol）— 防止能力退化
  3. **反重力可靠性契约**（F201 antigravity-reliability-contract）— 可靠性契约
  4. **反重力 CLI 迁移**（F210 antigravity-cli-migration）— CLI 可靠性迁移
  5. **泡泡运行时正确性**（F123 bubble-runtime-correctness）— 运行时正确性
  6. **泡泡流水线架构整合**（F183 bubble-pipeline-architecture-consolidation）— 架构整合
  7. **副作用新鲜度门**（F254 side-effect-freshness-gate）— 副作用管理
  8. **AGY 持久化执行恢复**（F261 agy-durable-execution-recovery）— 持久化恢复
- **建议**：实现可靠性工程体系，包括防漂移、可靠性契约、运行时正确性、持久化恢复。
- **T7/T8**：否

### P-69 — 技术债务与架构治理完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：各模块架构治理缺失
- **现象**：clowder-ai 实现了架构治理体系，FlowForge 大量架构问题：
  1. **功能文档债务清理**（F094 feature-doc-debt-cleanup）— 文档债务
  2. **记忆适配器重构**（F102 memory-adapter-refactor）— 适配器重构
  3. **消息操作大修**（F109 message-actions-overhaul）— 消息操作重构
  4. **包系统多智能体模块**（F129 pack-system-multi-agent-mod）— 包管理
  5. **统一调度抽象**（F139 unified-schedule-abstraction）— 调度抽象
  6. **前端消息流水线统一**（F173 frontend-message-pipeline-unification）— 前端统一
  7. **操作上下文统一**（F189 operation-context-unification）— 操作统一
  8. **跨线程通信统一**（F193 cross-thread-comm-unification）— 通信统一
  9. **路由序列重构**（F216 route-serial-refactor）— 路由重构
  10. **技术债务架构演进**（F219 tech-debt-architecture-evolution）— 架构演进
  11. **品味通道**（F221 taste-lane）— 代码品味
  12. **双向边界对称**（F238 bidirectional-boundary-symmetry）— 边界对称
  13. **写侧尸检实体解引用**（F260 write-side-autopsy-entity-deref）— 实体管理
  14. **可恢复内容溢出**（F269 recoverable-content-overflow）— 内容溢出
  15. **务实记忆反思**（F271 pragmatic-memory-reflection）— 记忆反思
  16. **对象驱动体验运行时**（F283 object-driven-experience-runtime）— 对象运行时
- **建议**：建立架构治理体系，定期进行技术债务评估和重构。
- **T7/T8**：否

### P-70 — CI/CD 与 DevOps 完整缺失
- **严重度**：S3 ｜ **分类**：功能缺失（clowder-ai 对比） ｜ **状态**：Open
- **文件**：无 CI/CD 相关配置
- **现象**：clowder-ai 实现了 CI/CD 体系，FlowForge 无自动化流水线：
  1. **CI/CD 跟踪**（F133 cicd-tracking）— CI/CD 状态追踪
  2. **桌面安装器发布流水线**（F179 desktop-installer-release-pipeline）— 安装包发布
  3. **冷启动验证器**（F067 cold-start-verifier）— 冷启动验证
- **建议**：实现 CI/CD 流水线，支持自动化测试、构建、发布、部署。
- **T7/T8**：否

---

### P-73 — 代码缺陷：75+ 处 bare `except Exception` 吞噬异常，掩盖真实错误
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/` 目录下 21 个文件，共 75+ 处
- **现象**：`app/` 目录下大量使用 `except Exception` 或 `except Exception as e` 吞噬所有异常，未区分具体异常类型。主要问题文件：
  - `app/main.py` — 10 处纯 `except Exception`
  - `app/api/core/system.py` — 14 处纯 `except Exception as e`
  - `app/api/endpoints/websocket.py` — 12 处纯 `except Exception`
  - `app/api/agents/forgemind.py` — 8 处纯 `except Exception`
  - `app/api/workflows/loops.py` — 8 处纯 `except Exception`
  - `app/api/workflows/tasks.py` — 5 处纯 `except Exception`
  - 其他文件：`admin.py`, `plugins.py`, `council_*.py`, `bootcamp.py`, `forgekins.py`, `openroute.py`, `marketplace_api.py`, `verify.py`, `uploads.py` 等
- **影响**：吞噬异常后仅记录日志或返回空值，导致生产环境中的间歇性错误难以追踪。例如 WebSocket 断线重连失败、LLM 调用超时、数据库连接异常等都被静默吞掉。
- **建议**：将 `except Exception` 替换为具体的异常类型（如 `ConnectionError`, `TimeoutError`, `ValueError`），或至少区分可恢复和不可恢复异常。
- **T7/T8**：否

### P-74 — 代码缺陷：`core/im_council.py` 两个核心通道类（WebChat/TraeBridge）完全未实现，仅骨架
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/im_council.py:293-459`
- **现象**：`IMCouncil` 的两个核心通道实现仅为骨架：
  1. **WebChatChannel**（line 293）：`send()`、`wait_reply()`、`broadcast()` 三个方法全部记录 `logger.warning("skeleton not implemented")` 并返回降级值，15 处 TODO 标记，无任何实际 WebSocket 推送逻辑
  2. **TraeBridgeChannel**（line 380）：`send()`、`wait_reply()`、`broadcast()` 三个方法同样全部为 TODO 骨架，依赖 F045 文件协议但未实现任何文件读写
- **影响**：议事群聊（Council）的 Web 和 Trae IDE 通道实际不可用，operator 无法通过 Web UI 或 IDE 接收审批请求
- **建议**：实现 WebChatChannel 的 WebSocket 推送和回复接收，实现 TraeBridgeChannel 的共享文件协议读写
- **T7/T8**：否

### P-75 — 代码缺陷：`core/partnership` 和 `core/reliability` 核心模块完全未实现（仅存测试文件）
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/` 目录下无 `partnership/` 和 `reliability/` 源码目录
- **现象**：`docs/design.md` 中定义的 Partnership（合作机制）和 Reliability（可靠性工程）两个核心模块，源码目录完全不存在。但测试文件已存在：
  - `tests/core/partnership/test_math.py` — 被 `@pytest.mark.skip(reason="…not implemented — TODO")` 跳过
  - `tests/core/reliability/test_wal.py` — 同样被 `@pytest.mark.skip` 跳过
  - `core/errors.py` 中已定义 `PartnershipError` 和 `ReliabilityError`（P-03 修复），但对应模块无任何实现
- **影响**：合作候选项路径校验、分布式可靠性 WAL 等核心功能完全缺失，架构设计文档与代码实现严重脱节
- **建议**：按设计文档实现 `core/partnership/` 和 `core/reliability/` 模块，或更新文档说明暂缓实现
- **T7/T8**：否

### P-76 — 代码缺陷：`core/im_council.py` 15 处 TODO 骨架方法，WebSocket/文件协议集成未实现
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/im_council.py`
- **现象**：除 WebChatChannel 和 TraeBridgeChannel 外，整个 `IMCouncil` 模块大量方法仅实现为骨架降级（与 P-74 不同，P-74 聚焦于通道类，此处聚焦于模块整体未实现的方法数量）。具体包括：
  - `WebChatChannel.send()` — 3 个 TODO
  - `WebChatChannel.wait_reply()` — 2 个 TODO
  - `WebChatChannel.broadcast()` — 2 个 TODO
  - `TraeBridgeChannel.send()` — 4 个 TODO
  - `TraeBridgeChannel.wait_reply()` — 3 个 TODO
  - `TraeBridgeChannel.broadcast()` — 1 个 TODO
- **影响**：议事实时推送和跨 IDE 桥接功能完全不可用
- **建议**：分阶段实现 TODO 标记的方法，优先实现 WebSocket 推送
- **T7/T8**：否

### P-77 — 代码缺陷：`evolution/foreman.py` 多个 Phase 2 TODO 未实现
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`evolution/foreman.py:388,410,431`
- **现象**：`EvolutionForeman` 核心方法中存在多个 TODO 标记：
  - `_gather_task_sources()` 中任务源 2（Eval Ledger 失败信号）标记为 Phase 2 实现
  - `_gather_task_sources()` 中 `task.md` 解析标记为 Phase 2 实现
  - `_scan_docs_code_arch()` 标记为 Phase 2 实现
  - `close_gate.py:32` 有 `"TODO 后续"` 无计划标记
- **影响**：自动进化引擎的任务收集能力不完整，约 50% 的任务源缺失
- **建议**：实现 Phase 2 任务源，完成 Eval Ledger 集成和文档扫描
- **T7/T8**：否

### P-78 — 代码缺陷：`app/api/endpoints/websocket.py` 12 处异常处理过于宽泛，WebSocket 连接不稳定
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/endpoints/websocket.py`
- **现象**：WebSocket 端点存在 12 处 `except Exception`，覆盖所有 WebSocket 操作：
  - 消息接收/发送循环均被宽泛异常捕获
  - 连接建立和关闭逻辑异常被静默吞掉
  - 没有区分 `WebSocketDisconnect`、`ConnectionClosed` 等可预期异常与真正的意外异常
- **影响**：WebSocket 连接在异常断开时无法正确清理，可能导致连接泄漏和资源耗尽
- **建议**：区分 WebSocket 特定异常（`WebSocketDisconnect`、`ConnectionClosed`）与一般异常，为断开连接实现正确的清理逻辑
- **T7/T8**：否

### P-79 — 测试缺陷：`tests/core/partnership/` 和 `tests/core/reliability/` 测试全部被跳过，核心模块零测试覆盖
- **严重度**：S2 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/core/partnership/test_math.py:25`、`tests/core/reliability/test_wal.py:21`
- **现象**：两个核心模块的测试文件在模块级被 `@pytest.mark.skip` 跳过，原因分别为：
  - `test_math.py`：`"flowforge.core.partnership not implemented (docs/decisions/011-partnership-math.md) — TODO"`
  - `test_wal.py`：`"flowforge.core.reliability not implemented (docs/decisions/010-distributed-reliability.md) — TODO"`
- **影响**：合作机制和可靠性工程两个核心模块零测试覆盖，且无对应源码实现
- **建议**：实现模块后再启用测试，或在未实现前移除测试文件避免误导
- **T7/T8**：否

### P-80 — 测试缺陷：`tests/test_arch_principles.py` 14 个用例因引用已迁移文件全部失败
- **严重度**：S2 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/test_arch_principles.py:28,295,463,471`
- **现象**：架构守卫测试硬编码读取跨仓/已迁移文件路径，14 个用例全部 `FileNotFoundError` 或 `AssertionError`（已记录于 P-11，此处补充更多细节）
- **影响**：架构守卫测试形同虚设，无法提供实际的架构保护
- **建议**：重写为基于当前仓库结构的断言，或使用 `pytest.importorskip` 跳过缺失文件
- **T7/T8**：否

### P-81 — 测试缺陷：`test_config_version.py` 和 `test_durable_state.py` 部分测试函数缺少断言
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/unit/test_config_version.py`、`tests/core/harness/test_durable_state.py`
- **现象**：部分测试函数仅执行操作但不做任何断言，例如：
  - `test_config_version.py` 部分用例只调用函数但不验证返回值
  - `test_durable_state.py` 部分测试因 TODO 标记跳过实际断言
  - `test_arch_principles.py` 部分用例缺少 assert 语句
- **影响**：这些测试会显示 "pass" 但实际未验证任何行为，产生虚假的安全感
- **建议**：为每个测试函数添加明确的 assert 断言，或移除无断言的测试
- **T7/T8**：否

---

> ## 【2026-08-10 第二轮代码深度分析 + 文档/配置/前端缺陷｜P-82…P-107】
>
> 第二轮深度分析，覆盖 app/、core/、evolution/、web/、config/、docs/ 等目录。
> 发现大量 stub 端点、不安全代码、配置缺陷、文档不一致等问题，共计 26 个新工单。

### P-82 — 代码缺陷：5 个 API 端点返回 Stub 空数据（signals/eval/ops/forgekins forge 等），承诺功能未实现
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/agents/signals.py:33-66`、`app/api/core/eval.py:17-43`、`app/api/admin/ops.py:16-23`、`app/api/agents/forgekins.py:93-100`、`app/api/agents/forgekins.py:103-110`
- **现象**：5 个 API 端点实现为 stub（骨架），返回空列表或占位数据，无任何实际功能：
  1. **`GET /api/v1/signals`**（signals.py:33）— 返回 `{"items":[],"total":0}`
  2. **`GET /api/v1/signals/sources`**（signals.py:49）— 返回 `{"items":[],"total":0}`
  3. **`POST /api/v1/signals/sources`**（signals.py:56）— 返回 stub 对象，status="stub"
  4. **`GET /api/v1/eval/verdicts`**（eval.py:17）— 返回 `{"items":[],"total":0}`
  5. **`GET /api/v1/eval/friction`**（eval.py:31）— 返回 `{"avg_friction_score":0.0,"status":"stub"}`
  6. **`GET /api/v1/ops/services`**（ops.py:16）— 返回 `{"items":[],"total":0,"status":"stub"}`
  7. **`PUT /api/v1/forgekins/{id}`**（forgekins.py:93）— `"updated": True` 但实际不持久化
  8. **`POST /api/v1/forgekins/{id}/forge`**（forgekins.py:103）— 返回 `"message":"Forge endpoint not yet implemented"`
- **影响**：前端页面调用这些端点时无法获取真实数据，导致功能不可用。
- **建议**：实现各端点的真实业务逻辑，或在前端移除对应功能入口。stub 端点应在文档中标注为"开发中"。
- **T7/T8**：是（T8）

### P-83 — 代码缺陷：`evolution/engine.py` 和 `evolution/close_gate.py` 使用已弃用的 `datetime.utcnow()`
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`evolution/engine.py:91`、`evolution/close_gate.py:52`
- **现象**：Python 3.12+ 中 `datetime.utcnow()` 返回 naive datetime（无时区信息），已被官方弃用并建议使用 `datetime.now(timezone.utc)`。当前代码中：
  - `evolution/engine.py:91`：`"evaluated_at": datetime.utcnow().isoformat()` — 生成 naive ISO 时间
  - `evolution/close_gate.py:52`：`decided_at: datetime = Field(default_factory=datetime.utcnow)` — 模型默认值使用 naive datetime
- **影响**：naive datetime 与 aware datetime 比较时抛出 `TypeError`，且存储在数据库中的时间无法正确转换为时区。App 层（`app/api/`）已正确使用 `datetime.now(timezone.utc)`，但 evolution 模块未同步。
- **建议**：将 `datetime.utcnow()` 替换为 `datetime.now(timezone.utc)`，同时将 `datetime.utcnow` 替换为 `_now_utc` factory 函数（参照 `core/approval_hub.py:26-28` 的模式）。
- **T7/T8**：否

### P-84 — 代码缺陷：`app/api/memory/memory.py` 全局变量 `_memory_manager` 类型注解错误
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/memory/memory.py:12`
- **现象**：`_memory_manager: MemoryManager = None` — 类型注解为 `MemoryManager` 但初始值为 `None`，mypy/pyright 将报类型错误。正确的写法应为 `_memory_manager: MemoryManager | None = None` 或 `Optional[MemoryManager]`。
- **影响**：虽然在 `get_memory` 等函数中已检查 `if _memory_manager is None`，但类型注解错误会导致静态类型检查工具报错，且可能被 IDE 自动补全误导。
- **建议**：将类型注解改为 `_memory_manager: MemoryManager | None = None`。
- **T7/T8**：否

### P-85 — 代码缺陷：`app/api/agents/forgekins.py` PUT 更新不持久化，POST forge/stage 未实现
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/agents/forgekins.py:93-130`
- **现象**：Forgekin API 中三个核心端点均未真正实现：
  1. **`PUT /forgekins/{id}`**（line 93）：接受更新请求体但不持久化，返回 `"updated": True` 但实际未写入 YAML/数据库
  2. **`POST /forgekins/{id}/forge`**（line 103）：返回 `"message": "Forge endpoint not yet implemented"`
  3. **`POST /forgekins/{id}/stage`**（line 117）：返回 `"message": "Stage endpoint not yet implemented"`
- **影响**：用户无法通过 API 更新或进化 Forgekin，锻造（Forge）和进化阶段（Stage）功能完全不可用
- **建议**：实现 YAML 配置持久化写入逻辑，实现锻造和进化阶段切换的业务逻辑
- **T7/T8**：是（T8）

### P-86 — 安全缺陷：前端 MarkdownRenderer 组件存在 XSS 注入风险
- **严重度**：S2 ｜ **分类**：安全隐患 ｜ **状态**：Open
- **文件**：`web/src/components/helm/MarkdownRenderer.tsx`
- **现象**：Markdown 渲染组件直接使用 `dangerouslySetInnerHTML` 或类似 API 渲染 AI 生成的 Markdown 内容，未对 HTML 标签进行充分过滤和转义。AI 生成的内容可能包含恶意 `<script>` 标签、`onerror` 事件处理器等。
- **影响**：攻击者通过注入恶意 prompt 让 AI 生成含 XSS  payload 的 Markdown 内容，当其他用户查看对话时 payload 被执行，可能导致会话劫持、数据泄露。
- **建议**：使用经过安全审计的 Markdown 渲染库（如 `rehype-sanitize`），禁止渲染 `<script>`、`<iframe>` 等危险标签，对 HTML 属性进行白名单过滤。
- **T7/T8**：是（T8）

### P-87 — 代码缺陷：前端 30+ 组件滥用 `any` 类型，破坏 TypeScript 类型安全
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/helm/` 下 30+ 文件
- **现象**：前端大量组件使用 `any` 类型，包括但不限于：
  - `ChatStream.tsx`：`const data: any = ...`
  - `TaskListPanel.tsx`：`tasks: any[] = []`
  - `AgentOrchestrator.tsx`：大量 `any` 类型参数
  - `ChatInput.tsx`：事件处理参数使用 `any`
  - 前端类型定义文件 `web/src/lib/types.ts` 中大量接口使用 `any` 字段
- **影响**：`any` 类型完全绕过 TypeScript 的静态类型检查，运行时错误无法在编译期发现。API 返回数据结构变化时，`any` 类型不会报错，但实际页面可能崩溃。
- **建议**：为所有 API 响应定义完整的接口类型，使用 `unknown` 替代 `any` 并在使用时进行类型断言，启用 `@typescript-eslint/no-explicit-any` 规则。
- **T7/T8**：是（T8 DOM 验证）

### P-88 — 代码缺陷：前端 20+ 页面/组件缺少错误边界（Error Boundary）
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/app/` 下 20+ 页面文件
- **现象**：前端页面和组件未包裹 React Error Boundary，单个组件的渲染异常会直接导致整个页面白屏崩溃。已确认的崩溃页面：
  - `/mission-control` — 崩溃白屏
  - `/mission/ff-m-001` — 崩溃白屏
  - `/memory/health` — 崩溃白屏
  - 其他 15+ 页面缺少 Error Boundary
- **影响**：任何 API 返回异常数据或组件内部错误时，用户看到的是白屏而非友好的错误提示，严重影响用户体验。
- **建议**：添加全局 Error Boundary 组件包裹所有页面，为每个独立功能区域添加局部 Error Boundary，确保单个组件崩溃不影响其他区域。
- **T7/T8**：是（T8 DOM 验证）

### P-89 — 安全缺陷：密钥管理 API 泄露密钥配置状态信息
- **严重度**：S3 ｜ **分类**：安全隐患 ｜ **状态**：Open
- **文件**：`app/api/admin/settings.py:44-50`
- **现象**：`GET /api/v1/admin/settings/secrets` 端点返回 `"configured": bool(store.resolve(s["key"]))`，泄露了每个密钥是否已配置的信息。攻击者可以通过枚举已知密钥名称获取系统密钥配置状态，为后续攻击提供信息。
- **影响**：信息泄露，攻击者可了解哪些密钥已配置、哪些未配置，定向攻击未配置的密钥系统。
- **建议**：返回 `"configured"` 字段时仅显示 `true/false`，或仅在管理员认证后返回。对未配置的密钥名称不返回任何信息。
- **T7/T8**：否

### P-90 — 安全缺陷：docker-compose.yml 默认密钥 `changeme`，生产环境不安全
- **严重度**：S2 ｜ **分类**：安全隐患 ｜ **状态**：Open
- **文件**：`docker-compose.yml:9`
- **现象**：`SECRET_KEY=${SECRET_KEY:-changeme}` — 当环境变量未设置时，默认值为 `changeme`。这是一个众所周知的弱密码，任何知道该默认值的人都可以解密使用该密钥保护的数据。
- **影响**：生产环境部署时若忘记设置 `SECRET_KEY` 环境变量，系统将使用弱密钥 `changeme`，导致所有加密数据可被轻易解密。
- **建议**：移除默认值，强制要求设置 `SECRET_KEY` 环境变量。或使用随机生成的非对称密钥作为默认值。
- **T7/T8**：否

### P-91 — 代码缺陷：`Dockerfile` 使用 `python:3.10-slim`，与 `pyproject.toml` 要求 `>=3.11` 不一致
- **严重度**：S2 ｜ **分类**：CI / 配置 ｜ **状态**：Open
- **文件**：`Dockerfile:1`、`pyproject.toml`
- **现象**：Dockerfile 使用 `python:3.10-slim` 作为基础镜像，但 `pyproject.toml` 中声明 `requires-python = ">=3.11"`。Python 3.10 已于 2024 年 10 月结束安全支持，且项目代码中使用了 Python 3.11+ 特性（如 `str | None` 类型注解）。
- **影响**：使用当前 Dockerfile 构建的容器可能因 Python 版本不满足要求而无法启动，或在运行时因缺少 Python 3.11+ 特性而报错。
- **建议**：将 Dockerfile 基础镜像升级为 `python:3.12-slim`，并同步更新 `docker-compose.yml` 中的构建配置。
- **T7/T8**：否

### P-92 — 代码缺陷：`.env.example` 文件为空，缺少必要环境变量文档
- **严重度**：S3 ｜ **分类**：CI / 配置 ｜ **状态**：Open
- **文件**：`.env.example`
- **现象**：`.env.example` 文件仅包含两行注释，没有列出任何必要的环境变量。新开发者无法通过该文件了解需要配置哪些环境变量（如 `OPENROUTE_API_KEY`、`SECRET_KEY`、`DATABASE_URL` 等）。
- **影响**：新开发者部署项目时需通过阅读源码或文档来发现所需环境变量，增加上手难度和配置遗漏风险。
- **建议**：在 `.env.example` 中列出所有必需和可选的环境变量，包含注释说明和默认值提示。
- **T7/T8**：否

### P-93 — 安全缺陷：CORS 配置过于宽松，未限制允许的源
- **严重度**：S2 ｜ **分类**：安全隐患 ｜ **状态**：Open
- **文件**：`app/main.py`（CORS 中间件配置）
- **现象**：CORS 中间件配置允许所有来源（`allow_origins=["*"]`），在生产环境中会导致跨站请求伪造（CSRF）攻击和数据泄露风险。
- **影响**：任意第三方网站都可以通过浏览器向 FlowForge API 发起跨域请求，可能读取用户敏感数据或执行未授权操作。
- **建议**：在生产环境中限制 CORS 来源为已知的前端域名，或使用白名单机制动态验证 Origin 头。
- **T7/T8**：否

### P-94 — 代码缺陷：`core/observability.py` 可观测性模块无任何实际指标导出
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/observability.py`
- **现象**：`TraceManager` 和 `MetricsCollector` 类虽然实现了基本的数据收集，但没有任何导出机制（如 Prometheus 端点、OpenTelemetry 导出、日志文件输出等）。`get_logger()` 是唯一的输出方式。
- **影响**：可观测性数据仅存在于内存中，无法被外部监控系统采集。生产环境中无法监控系统健康状态、API 延迟、错误率等关键指标。
- **建议**：实现 OpenTelemetry 导出器或 Prometheus 指标端点，将收集的追踪和指标数据导出到外部监控系统。
- **T7/T8**：否

### P-95 — 代码缺陷：`core/event_bridge.py` 跨项目事件桥接引用了不存在的事件模块
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/event_bridge.py:21`
- **现象**：`from flowforge.events.event_bus import EventBus` — 导入的模块 `flowforge.events.event_bus` 在项目目录中不存在。`events/` 目录下只有 `event_bridge.py` 本身，没有 `event_bus.py` 模块。
- **影响**：`from flowforge.events.event_bus import EventBus` 将在运行时抛出 `ModuleNotFoundError`，导致整个 event_bridge 模块不可用。
- **建议**：创建缺失的 `events/event_bus.py` 模块实现 EventBus，或修正导入路径指向真实的 EventBus 实现。
- **T7/T8**：否

### P-96 — 代码缺陷：`core/restart_recovery.py` 重启恢复模块未实现持久化存储
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/restart_recovery.py`
- **现象**：重启恢复模块使用内存存储状态，系统重启后所有恢复状态丢失。设计文档要求持久化状态存储以支持崩溃恢复，但当前实现完全依赖内存。
- **影响**：系统崩溃或重启后，所有正在进行的恢复流程丢失，无法从断点继续执行。Tier 3/4 恢复策略完全无法工作。
- **建议**：实现基于 SQLite 或文件系统的持久化状态存储，确保重启后恢复上下文可用。
- **T7/T8**：否

### P-97 — 代码缺陷：`core/workflow_compiler.py` 工作流编译器缺少错误处理
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/workflow_compiler.py`、`core/workflow_compiler_parser.py`、`core/workflow_compiler_validator.py`
- **现象**：工作流编译器模块在解析和验证 YAML 工作流时，对格式错误、循环引用、缺失字段等情况缺乏充分的错误处理，仅在发现错误时抛出通用异常。
- **影响**：用户提交的 YAML 工作流配置错误时，编译器返回难以理解的错误信息，或直接崩溃导致 API 返回 500 错误。
- **建议**：为编译器添加详细的错误信息和错误码，区分编译错误、验证错误和运行时错误，返回结构化的错误响应。
- **T7/T8**：否

### P-98 — 代码缺陷：`app/api/agents/voice.py` 语音模块引用不存在的依赖
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/agents/voice.py`
- **现象**：语音模块引用了 `flowforge.voice` 包，但 `voice/` 目录在项目根目录中不存在（P-39 语音交互系统完整缺失）。导入时将抛出 `ModuleNotFoundError`。
- **影响**：任何包含语音模块的导入路径都会导致 ImportError，影响整个 API 路由注册。
- **建议**：移除不存在的语音模块引用，或创建骨架模块避免 ImportError。
- **T7/T8**：否

### P-99 — 代码缺陷：`app/api/agents/council_task_service.py` 和 `council_workflow_service.py` 多个方法未实现
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/agents/council_task_service.py`、`app/api/agents/council_workflow_service.py`
- **现象**：议事群聊（Council）的任务和工作流服务中多个关键方法包含 `pass` 语句或仅返回空值：
  - `council_task_service.py` 中任务创建、分配、状态更新等方法未实现
  - `council_workflow_service.py` 中工作流启动、暂停、恢复等方法未实现
- **影响**：议事群聊的核心功能（任务分配、工作流执行）不可用。
- **建议**：实现 Council 任务和工作流服务的完整逻辑，或在前端隐藏对应功能入口。
- **T7/T8**：是（T8）

### P-100 — 代码缺陷：`app/api/core/notify.py` 通知模块未实现
- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`app/api/core/notify.py`
- **现象**：通知模块完全未实现，前端调用 `/api/v1/notifications/` 端点返回 404。P-21 已记录该端点缺失，但此处确认后端路由中也未注册。
- **影响**：用户无法接收系统通知（审批提醒、任务完成通知、进化结果通知等）。
- **建议**：实现通知模块，支持 WebSocket 实时推送、通知列表查询、已读/未读标记等功能。
- **T7/T8**：是（T8）

### P-101 — 文档缺陷：`docs/spec.md` 中定义的 5 个 `/api/v7/*` 核心接口与代码实现完全不一致
- **严重度**：S2 ｜ **分类**：文档/设计态 ｜ **状态**：Open
- **文件**：`docs/spec.md` §4.1、`app/api/router.py`
- **现象**：`docs/spec.md` §4.1 明确定义了 5 个核心 `/api/v7/*` 接口，但后端路由注册文件中完全没有 `/api/v7/` 前缀的路由。实际 API 均使用 `/api/v1/` 前缀。文档与实际代码严重脱节。
- **影响**：新开发者按照 spec.md 开发时发现 API 路径不一致，第三方集成时调用 v7 端点全部 404。文档与代码不一致是架构腐化的直接信号。
- **建议**：统一 API 版本号为 v1，更新 spec.md 中的 API 路径定义。或将计划中的 v7 API 列入 roadmap 并标注未实现。
- **T7/T8**：否

### P-102 — 文档缺陷：`docs/design.md` 中 partnership 和 reliability 模块设计文档与代码实现完全脱节
- **严重度**：S2 ｜ **分类**：文档/设计态 ｜ **状态**：Open
- **文件**：`docs/design.md` §10.3、`core/` 目录
- **现象**：设计文档中详细定义了 Partnership（合作机制）和 Reliability（可靠性工程）两个核心模块的接口、数据模型和工作流程，但对应的源码目录 `core/partnership/` 和 `core/reliability/` 完全不存在。测试文件也被 `@pytest.mark.skip` 跳过。
- **影响**：设计文档承诺的功能未实现，新开发者按设计文档设计集成方案时发现功能不可用。架构设计文档成为"空头支票"。
- **建议**：在 roadmap 中标注这些模块的开发计划，或在设计文档中注明"待实现"。删除被跳过的测试文件避免误导。
- **T7/T8**：否

### P-103 — 文档缺陷：`docs/README.md` 缺少快速入门指南和开发环境配置说明
- **严重度**：S3 ｜ **分类**：文档/设计态 ｜ **状态**：Open
- **文件**：`docs/README.md`
- **现象**：文档根目录的 README 缺少必要的快速入门指南，未说明如何：
  - 安装依赖（pip install vs poetry vs conda）
  - 配置环境变量（需要哪些 API key）
  - 启动开发服务器（前端 + 后端）
  - 运行测试
  - 构建 Docker 镜像
- **影响**：新开发者加入项目后需要自行摸索环境配置和启动流程，显著增加上手时间。
- **建议**：在 docs/README.md 中添加完整的快速入门指南，包括环境要求、安装步骤、配置说明、启动命令和常见问题。
- **T7/T8**：否

### P-104 — 代码缺陷：`core/helm_ws_manager.py` 和 `core/helm_adapter.py` Helm 适配器缺少会话恢复机制
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/helm_ws_manager.py`、`core/helm_adapter.py`
- **现象**：Helm 对话适配器使用内存存储会话状态，服务重启后所有活动会话丢失。无会话持久化、无断线重连、无会话恢复机制。
- **影响**：用户在进行中的对话在服务重启后丢失，无法恢复对话上下文。用户体验差，且丢失的对话内容无法被 EchoStore 记录。
- **建议**：实现基于 SQLite 或 Redis 的会话持久化，支持断线重连和会话恢复。
- **T7/T8**：否

### P-105 — 代码缺陷：`core/plugin_manager.py` 插件管理器缺少插件依赖解析和版本冲突检测
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/plugin_manager.py`、`core/plugin_loader.py`
- **现象**：插件管理器在加载插件时未检查插件间的依赖关系和版本冲突。当两个插件依赖同一第三方库的不同版本时，会出现静默覆盖或运行时错误。
- **影响**：插件生态中依赖冲突可能导致插件功能异常、崩溃或安全漏洞，且难以排查。
- **建议**：实现插件依赖解析器，在安装/加载时检测依赖冲突，提供清晰的错误信息。
- **T7/T8**：否

### P-106 — 代码缺陷：`app/api/agents/threads.py` 线程管理 API 缺少分页和搜索功能
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/agents/threads.py`
- **现象**：线程管理 API 在返回线程列表时未实现分页、搜索和过滤功能。随着对话数量增长，前端无法有效加载和浏览历史对话。
- **影响**：用户无法搜索历史对话、无法按时间/智能体/标签过滤对话、无法在大量对话中快速定位目标。
- **建议**：为线程列表 API 添加分页参数（limit/offset）、搜索参数（q/title）、过滤参数（agent_id/status/date_range）。
- **T7/T8**：是（T8）

### P-107 — 代码缺陷：`app/api/agents/plugins.py` 和 `app/api/plugins/` 插件 API 端点未实现完整 CRUD
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/agents/plugins.py`、`app/api/plugins/plugins.py`、`app/api/plugins/plugins_v1.py`、`app/api/plugins/domain_plugins.py`
- **现象**：插件 API 端点存在多个未实现的功能：
  - 插件安装/卸载/更新未实现
  - 插件市场浏览/搜索未实现
  - 插件配置管理未实现
  - `domain_plugins.py` 中存在空函数体（`pass`）
- **影响**：用户无法通过 API 管理插件生命周期，插件市场的完整功能不可用。
- **建议**：实现插件 CRUD 的完整 API，包括安装、卸载、更新、配置管理等操作。
- **T7/T8**：是（T8）

### P-71 — CLI 命令行模式完整缺失（opencode 对比）
- **严重度**：S2 ｜ **分类**：功能缺失（opencode 对比） ｜ **状态**：Open
- **文件**：`cli/` CLI 模块不完整
- **现象**：opencode 实现了完整的 CLI 命令体系，FlowForge 仅有基础 `cli/__main__.py`：
  1. **run 命令**（opencode `cmd/run.ts`）— 交互式运行/消息执行
  2. **agent 命令**（opencode `cmd/agent.ts`）— 智能体创建/列表/管理
  3. **account 命令**（opencode `cmd/account.ts`）— 账户登录/登出/切换
  4. **session 命令**（opencode `cmd/session.ts`）— 会话列表/删除
  5. **mcp 命令**（opencode `cmd/mcp.ts`）— MCP 服务器添加/列表/认证/调试
  6. **models 命令**（opencode `cmd/models.ts`）— 模型查看/管理
  7. **plugin 命令**（opencode `cmd/plug.ts`）— 插件管理
  8. **serve 命令**（opencode `cmd/serve.ts`）— 启动服务器
  9. **tui 命令**（opencode `cmd/tui.ts`）— 启动 TUI 界面
  10. **--format json 输出**（opencode `cmd/run.ts`）— 结构化输出
- **建议**：实现完整 CLI 命令体系，覆盖 run/agent/account/session/mcp/models/plugin/serve/tui 等命令，支持结构化输出。
- **T7/T8**：否

### P-72 — TUI 终端界面完整缺失（opencode 对比）
- **严重度**：S2 ｜ **分类**：功能缺失（opencode 对比） ｜ **状态**：Open
- **文件**：`cli/` 无 TUI 模块
- **现象**：opencode 实现了完整的 TUI 终端界面，FlowForge 完全缺失：
  1. **命令调色板**（opencode `command-palette.tsx`）— 快速命令访问
  2. **历史记录提示**（opencode `history.tsx`）— 命令历史导航
  3. **会话列表对话框**（opencode `dialog-session-list.tsx`）— 会话管理
  4. **模型选择对话框**（opencode `dialog-model.tsx`）— 模型切换
  5. **提供者选择对话框**（opencode `dialog-provider.tsx`）— 提供者配置
  6. **工作区列表对话框**（opencode `dialog-workspace-list.tsx`）— 工作区管理
  7. **工作区创建对话框**（opencode `dialog-workspace-create.tsx`）— 创建工作区
  8. **主题选择对话框**（opencode `dialog-theme-list.tsx`）— 主题切换
  9. **会话重命名对话框**（opencode `dialog-session-rename.tsx`）— 会话重命名
  10. **标签对话框**（opencode `dialog-tag.tsx`）— 标签管理
  11. **暂存对话框**（opencode `dialog-stash.tsx`）— 暂存管理
  12. **技能对话框**（opencode `dialog-skill.tsx`）— 技能创建/管理
- **建议**：实现完整 TUI 终端界面，支持命令调色板、会话管理、模型/提供者配置、工作区管理、主题切换等。
- **T7/T8**：否

## 三、修复闭环（按 docs/test/README.md §测试交付规范）

---

## 四、验证记录（可复现）

```bash
# 整轮 pytest（模块级 sys.exit 触发 INTERNALERROR，2026-08-08）
cd flowlight/flowforge
python3 -m pytest tests/ -q
# => INTERNALERROR（tests/e2e/test_phase1_foundation.py 等 4 个 phase 脚本模块级 sys.exit）

# 隔离后运行（真实执行，832s）
python3 -m pytest tests/unit tests/core -q -p no:langsmith_plugin
# => 992 passed, 21 failed, 4 skipped, 2 errors

# 硬编码密钥扫描
grep -rlE "or-[0-9a-f]{40,}|or-6eb9e20d|or-2c2e4d8e|or-306e066e" --include=*.py --include=*.yaml . | grep -v "/.venv/" | wc -l
# => 9  （3 个不同密钥：or-6eb9e20d... / or-2c2e4d8e... / or-306e066e...）

# d:/software/openclaw 硬编码扫描
grep -rn "d:/software/openclaw" llm/trae/config.py llm/trae/adapter.py forgemind/autonomous.py
# => 3 处（另 config/im_council.yaml:42、config/trae_bridge.yaml:19 含默认占位；仓库根已寄生 d: 目录）

# core/errors.py 缺失异常确认
grep -nE "class (Partnership|Reliability)Error" core/errors.py
# => 无输出（缺失）

# pytest 配置冲突确认
grep -nA8 "\[tool.pytest" pyproject.toml   # 声明 minversion/addopts
cat pytest.ini                            # 同名键被静默优先采用

# T7/T8 接线扫描（引用即疑似合规，未引用=14 个未接）
ls tests/e2e/test_*.py | wc -l                                   # => 23
grep -lE "T7|T8|内容审核|DOM" tests/e2e/*.py | wc -l            # => 约 9（=> 14 个未接）

# governance 拼写错误确认
grep -n "inject_to_system_rule" harness/governance.py           # => 259
```

---

> ## 【2026-08-10 第三轮代码深度分析｜P-108…P-120】
>
> 第三轮深度分析，覆盖 forgemind/、memory/、web/、evolution/、tests/、pyproject.toml 等目录。
> 发现 13 个新缺陷，包括硬编码路径、存储接口不一致、同步异步混用、内存泄漏风险、依赖缺失等。
> 累计 111 个工单。

### P-108 — 代码缺陷：`forgemind/base.py` 硬编码项目路径 `d:\\software\\openclaw\\flowforge`
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`forgemind/base.py:151`
- **现象**：`_build_system_prompt()` 方法中第 151 行硬编码了项目路径：
  ```python
  parts.append("- 项目根: d:\\software\\openclaw\\flowforge")
  ```
  system prompt 中包含机器相关的绝对路径。在非 Windows 环境或不同路径克隆时，system prompt 中的项目路径与实际项目路径不一致，误导 LLM 对项目结构的理解。
- **影响**：LLM 根据 system prompt 中的路径生成错误的文件操作建议，Code Generation 任务时引用不存在的路径。违反红线 11（路径通过 config 注入，不硬编码）。
- **建议**：使用 `Path(__file__).resolve().parents[2]` 动态计算项目根路径，或通过 config 注入。
- **T7/T8**：否

### P-109 — 代码缺陷：`memory/manager.py` 存储接口方法签名不一致，EchoStore 接口未实现
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`memory/manager.py:29-38`、`memory/short_term.py:15`、`memory/long_term.py:16`
- **现象**：`MemoryManager` 的 `save()` 和 `retrieve()` 方法签名与各存储子类的接口不一致：
  1. **`manager.py:34`** `retrieve(memory_type, query)` → 调用 `store.search(query)` — 但 `search()` 方法在各子类中签名不一致：
     - `ShortTermMemory.search(query, limit=10)` — 返回 `list[dict]`
     - `LongTermMemory.search(query, limit=10)` — 返回 `list[dict]`
     - `SemanticMemory.search(query)` — 签名可能不同
     - `EpisodicMemory.search(query)` — 可能不存在
  2. 所有存储类未实现 `EchoStore` 接口（设计文档中定义的抽象接口），自演化循环依赖的"回声存储"功能无法生效
- **影响**：`hybrid_search()` 中尝试调用 `self.semantic.search(query)` 和 `self.episodic.search(query)` 时，若方法不存在或签名不匹配，将在运行时抛出 `AttributeError` 或 `TypeError`。
- **建议**：定义统一的 `EchoStore` 抽象基类，要求所有存储子类实现该接口。统一 `search()` 方法签名。为 `MemoryManager` 添加类型检查和错误处理。
- **T7/T8**：否

### P-110 — 代码缺陷：`memory/short_term.py` 和 `memory/long_term.py` 使用同步 sqlite3 连接但暴露 async 接口
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`memory/short_term.py:7-27`、`memory/long_term.py:8-26`
- **现象**：`ShortTermMemory` 和 `LongTermMemory` 的 `store()` 和 `search()` 方法声明为 `async`，但内部使用同步的 `sqlite3` 连接进行数据库操作。所有数据库操作都是同步阻塞的，`async` 关键字提供了虚假的异步保证。
- **影响**：在异步事件循环中调用这些方法时，同步 sqlite3 操作会阻塞整个事件循环，降低系统并发能力。在大量并发请求时可能导致明显的性能瓶颈。
- **建议**：使用 `aiosqlite` 替代 `sqlite3`，或将 `async` 声明移除并使用 `asyncio.to_thread()` 包裹同步操作。
- **T7/T8**：否

### P-111 — 代码缺陷：`memory/stores/sqlite_store.py` 使用全局 SQLAlchemy engine 可能导致连接泄漏
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`memory/stores/sqlite_store.py:43-50`
- **现象**：`sqlite_store.py` 在模块级别创建了全局 SQLAlchemy `engine` 和 `sessionmaker`：
  ```python
  engine = create_engine(system_config.db_url, connect_args={"check_same_thread": False})
  def get_session():
      Session = sessionmaker(bind=engine)
      return Session()
  ```
  `get_session()` 每次调用都创建新的 `sessionmaker` 实例，但未提供任何会话管理机制（如上下文管理器、会话池、自动关闭）。调用方若不显式关闭 session，将导致连接泄漏。
- **影响**：长期运行的服务中，未关闭的 SQLAlchemy session 会耗尽数据库连接池，导致 `sqlite3.OperationalError: database is locked` 错误，最终使依赖数据库的功能不可用。
- **建议**：实现会话上下文管理器（`async with get_session() as session`），确保 session 在使用后自动关闭。或使用 `scoped_session` 管理会话生命周期。
- **T7/T8**：否

### P-112 — 代码缺陷：`web/src/hooks/useHelmWebSocket.ts` 和 `useCouncilChat.ts` 中 useEffect 缺少清理/存在内存泄漏风险
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/hooks/useHelmWebSocket.ts:200-225`、`web/src/hooks/useCouncilChat.ts:85-160`
- **现象**：两个核心 hooks 中多个 useEffect 清理问题：
  1. **`useHelmWebSocket.ts:200-225`**：`handleEvent` 回调依赖链形成闭包，消息频繁到达时清理可能未正确执行
  2. **`useCouncilChat.ts:85-160`**：`loadRoster` 无取消机制，组件卸载后 `setRoster` 仍可能执行
  3. **`useCouncilChat.ts:127-132`**：组件卸载时 abort 请求后，`finally` 块中的 `setIsLoading(false)` 仍会执行
- **影响**：频繁切换会话、快速收发消息时，可能出现内存泄漏、React 警告（在已卸载组件上调用 setState）、偶发的状态不一致。
- **建议**：为所有 useEffect 添加完整清理函数，使用 `useRef` 跟踪组件挂载状态，使用 `AbortController` 取消进行中的 fetch 请求。
- **T7/T8**：是（T8）

### P-113 — 代码缺陷：`web/src/lib/flowforge-client.ts` 缺少请求超时和取消机制
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/lib/flowforge-client.ts:15-25`
- **现象**：`FlowForgeClient` 的 `request<T>()` 方法使用原生的 `fetch()`，但未设置超时控制和取消机制：
  1. 无请求超时 — 网络故障时请求可能挂起数分钟
  2. 无 `AbortSignal` 参数 — 调用方无法取消正在进行的请求
  3. 错误信息有限 — 仅返回 `HTTP {status}`，缺少请求路径、时间戳等调试信息
- **影响**：网络不稳定时，API 请求可能无限挂起，用户无法取消操作，页面可能因等待响应而卡死。
- **建议**：添加 `AbortSignal` 支持，实现默认超时（如 30s），改进错误信息包含请求路径和耗时。
- **T7/T8**：是（T8）

### P-114 — 代码缺陷：`pyproject.toml` 缺失 `psutil` 依赖声明但 `tools_bridge.py` 运行时依赖
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`pyproject.toml:27-40`、`forgemind/tools_bridge.py:107`
- **现象**：`forgemind/tools_bridge.py` 的 `_get_system_info()` 函数中 `import psutil`（第 107 行）作为可选依赖，但 `pyproject.toml` 的 `dependencies` 列表中完全未声明 `psutil`。
- **影响**：系统信息查询功能在不同环境中行为不一致，没有安装 `psutil` 的环境返回的信息量显著减少。
- **建议**：将 `psutil` 添加到 `pyproject.toml` 的核心依赖列表，或至少添加到 `[project.optional-dependencies]` 中的 `dev` 组。
- **T7/T8**：否

### P-115 — 代码缺陷：`evolution/engine.py` 中 `_evaluate_metacognition` 声明为 async 但内部无任何 await 调用
- **严重度**：S4 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`evolution/engine.py:334-350`
- **现象**：`_evaluate_metacognition` 方法声明为 `async`，但内部所有方法调用都是同步函数，无任何 `await` 调用，创建了不必要的协程对象。
- **影响**：虽然不是功能性错误，但 `async` 声明创建了不必要的协程开销，每次调用 `evaluate()` 都额外包装一个协程对象。
- **建议**：移除 `_evaluate_metacognition` 的 `async` 声明，改为同步方法，或在其中添加真正的异步 I/O 操作。
- **T7/T8**：否

### P-116 — 代码缺陷：`forgemind/base.py` chat 方法中 4 处过于宽泛的 `except Exception` 捕获
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`forgemind/base.py:254,280,306,340`
- **现象**：`ForgekinBase.chat()` 方法中 4 个 provider 分支（zhipu/openroute/cli/trae）全部使用 `except Exception` 捕获所有异常并返回降级响应，所有 LLM 调用异常被静默转换为降级响应。
- **影响**：上层调用方无法区分临时错误（如网络超时、API 限流）和永久错误（如配置错误、密钥无效）。前者应重试，后者应快速失败。
- **建议**：区分可重试异常（`TimeoutError`、`httpx.ConnectError`）和不可重试异常（`ValueError`、`KeyError`）。
- **T7/T8**：否

### P-117 — 代码缺陷：`web/src/hooks/useHelmWebSocket.ts` 中 `catch (e: any)` 使用 any 类型
- **严重度**：S4 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/hooks/useHelmWebSocket.ts:415,471`
- **现象**：`createTask` 和 `continueChat` 方法中的 catch 块使用 `catch (e: any)`，`e.message` 可能为 `undefined`。
- **影响**：运行时显示"undefined"错误信息，无法通过 TypeScript 编译器捕获可能的类型错误。
- **建议**：将 `catch (e: any)` 改为 `catch (e: unknown)`，添加类型守卫判断 `e instanceof Error`。
- **T7/T8**：是（T8）

### P-118 — 测试缺陷：`tests/` 目录下多个测试文件缺少 pytest-asyncio 标记
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`tests/` 目录下多个测试文件
- **现象**：`pyproject.toml` 中设置了 `asyncio_mode = "auto"`，但部分测试文件中的异步测试函数仍然缺少 `@pytest.mark.asyncio` 装饰器，在 pytest 配置变更或不同版本中测试可能被静默跳过。
- **影响**：测试可能被静默跳过（不执行）或以同步方式错误执行，导致异步代码未被测试覆盖但报告显示"通过"。
- **建议**：为所有异步测试函数显式添加 `@pytest.mark.asyncio` 装饰器，不依赖 `asyncio_mode = "auto"` 隐式行为。
- **T7/T8**：否

### P-119 — 代码缺陷：`app/api/router.py` 中缺少 websocket 路由注册
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`app/api/router.py:40-41`、`app/api/endpoints/websocket.py`
- **现象**：`router.py` 中导入了 `endpoints.dashboard` 路由，但未导入 `endpoints.websocket` 路由。`websocket.py` 中定义的 WebSocket 端点（如 `/ws/im`、`/ws/helm/{taskId}`）未在 `router.py` 中注册。
- **影响**：WebSocket 连接在运行时不可用，前端 WebSocket 连接尝试全部失败。
- **建议**：在 `router.py` 中添加 `from flowforge.app.api.endpoints import websocket` 导入，并注册 WebSocket 路由。
- **T7/T8**：是（T8）

### P-120 — 代码缺陷：`web/src/components/helm/VoiceInput.tsx` 使用 any 类型且缺少错误恢复机制
- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/helm/VoiceInput.tsx:32,37,72,92`
- **现象**：语音输入组件存在多个类型安全和错误处理问题：
  1. `recognitionRef: any`（line 32）— 使用 `any` 类型
  2. `(window as any).SpeechRecognition`（line 37）— 无类型定义
  3. `event: any`（line 72,92）— 回调参数使用 `any`
  4. 缺少错误恢复 — 临时性错误需要用户手动重试
  5. 缺少加载状态 — 用户无法感知 Web Speech API 的初始化延迟
- **影响**：语音识别在出现临时错误时无法自动恢复，类型问题可能在运行时引发未预期的错误。
- **建议**：定义 `SpeechRecognition` 接口类型替换 `any`，添加自动重试逻辑，添加状态指示器。
- **T7/T8**：是（T8）

---

## 三、修复闭环（按 docs/test/README.md §测试交付规范）

---


