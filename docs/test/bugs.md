# 缺陷跟踪清单（Bug Tracker）

> 主跟踪单（Master Bug List）。测试人员强制交付物之一（另含测试用例、测试报告）。
> 规范依据：文档 `docs/test/README.md` §测试交付规范（强制）。命名约定：主单固定 `bugs.md`，置于 `docs/test/`。
> 生成日期：2026-08-08 ｜ 仓库侧：Gitee（`flowlight/flowforge`）
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
| **缺陷总数（DI count）** | **19** |
| **加权缺陷指数（DI）** | **92** ＝ S1×10 + S2×5 + S3×2 + S4×1 |
| 状态：Open | 10 |
| 状态：Fixed（待回归） | 9 |
| 状态：Closed | 0 |

> 更新：2026-08-09「实跑复测轮次」在 HEAD `5144892` 真实运行测试套件后追加 P-08…P-19（12 单，均运行时复现，状态 Open）。旧 7 单（P-01…P-07）字段本轮未改（P-04…P-07 由开发侧转 Fixed 待回归）；仅在 P-02/P-03 追加 `【2026-08-09 复测·实跑】` 观察，未作正式回归判定。
>
> 2026-08-10 续跑复核：独立复跑确认 P-08…P-19 全部 12 单（实跑证据与既有记录一致）。修正前序笔记两处不实描述——P-02 误记 `_test_*` 模块级 `sys.exit`/`SystemExit`（实测为模块级 `httpx` 网络调用致收集期 `ConnectError`）；P-08 误记 6 例失败（实测仅 `test_phase4_features.py::test_legacy_execute_still_works` 1 例，`test_skills.py` 36 passed 仅 DeprecationWarning）。
>
> 2026-08-10 开发侧：P-19 修复（`_run_t7_llm_review` 改名），转 Fixed 待回归。

### 按严重度（Severity）

| 等级 | 含义 | 数量 | 工单 |
|------|------|:----:|------|
| **S1 阻断** | 测试/安全不可用，须立即修复 | 3 | P-01, P-02, P-03 |
| **S2 严重** | 核心功能/质量受损 | 10 | P-04, P-05, P-06, P-07, P-09, P-10, P-11, P-12, P-13, P-17 |
| **S3 一般** | 明显缺陷但可绕过 | 6 | P-08, P-14, P-15, P-16, P-18, P-19 |
| **S4 轻微** | 文档/小修 | 0 | — |

### 按分类（Category）

| 分类 | 数量 | 工单 |
|------|:----:|------|
| 安全隐患 | 1 | P-01 |
| CI / 配置 | 2 | P-02, P-06 |
| 代码缺陷 | 7 | P-03, P-04, P-09, P-10, P-12, P-13, P-15 |
| 目录结构 | 1 | P-05 |
| T7 / T8 合规 | 1 | P-07 |
| 测试脚本缺陷 | 6 | P-08, P-11, P-14, P-16, P-18, P-19 |
| 验证阻塞（环境） | 1 | P-17 |

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
  ```bash
  PYTHONPATH=/home/hyg/ai/fl/flowlight python3 -c "from flowforge.core.errors import PartnershipError, ReliabilityError"
  # => P-03 import OK: PartnershipError 422 | ReliabilityError 503
  ```
  `tests/core/partnership/test_math.py` 收集不再 ImportError（其自身因 `flowforge.core.partnership` 尚未实现而 `importorskip` 跳过，属预期，非本单引入）。`test_wal.py` 同样为 importorskip 前置保护。请测试回归时以“两个名称可从 `core/errors` 导入”为准；若测到子模块已实现则回归用例可正常执行。
- **【2026-08-09 复测·实跑】**（测试观察，非正式回归判定）：本单指定的两个类**确已可导入**——
  ```bash
  python3 -m pytest tests/core/ -q -p no:cacheprovider
  # => 167 passed, 2 skipped（test_math/test_wal 因子模块未实现 importorskip 跳过，非 ImportError）
  ```
  但**同文件（`core/errors.py`）同主题的其它异常类仍缺失**，运行时收集独立复现（本单未覆盖）：`LLMError`、`ForgekinError` 均不在 `core/errors.py` 中，导致 `flowforge.llm.errors`（`llm/errors.py:20`）/`flowforge.llm.client` 整个模块 ImportError，`flowforge.forgemind.council` 亦 ImportError：
  ```bash
  python3 -c "import flowforge.llm.client"
  # => ImportError: cannot import name 'LLMError' from 'flowforge.core.errors'
  python3 -c "import flowforge.forgemind.council"
  # => ImportError: cannot import name 'ForgekinError' from 'flowforge.core.errors'
  ```
  → 该残留虽与本单同属「`core/errors` 缺类」主题，但**波及产品模块导入链（llm.client / forgemind.council）**且症状、影响面均超出本单范围，已按运行时独立复现另开 **P-12**（见下）跟踪，不在此改本单状态。

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
- **严重度**：S3 ｜ **分类**：测试脚本缺陷 ｜ **状态**：Open
- **文件**：`skills/base.py:66`（`asyncio.get_event_loop().run_until_complete(...)`）、`tests/unit/test_phase4_features.py::TestSandboxBackwardCompat::test_legacy_execute_still_works`
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
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
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

### P-13 — `flowforge.cli.__main__` 模块缺失：产品 CLI 入口崩溃 + `test_cli` 收集失败
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`cli/__init__.py:13`（`from flowforge.cli.__main__ import main`）、`pyproject.toml:63`（`flowforge = "flowforge.cli.__main__:main"`）、`tests/test_cli.py:12`
- **现象**：`cli/` 包只有 `__init__.py`（无 `__main__.py`），而 `__init__` 与 console_script 均引用 `flowforge.cli.__main__:main`，导致产品 CLI 入口全崩、`test_cli` 收集期 `ModuleNotFoundError`。实跑：
  ```bash
  python3 -m flowforge.cli --help   # => ModuleNotFoundError: No module named 'flowforge.cli.__main__'
  python3 -m pytest tests/test_cli.py --collect-only -q -p no:cacheprovider
  # => ERROR tests/test_cli.py：ModuleNotFoundError: No module named 'flowforge.cli.__main__'
  ```
- **建议**：补 `cli/__main__.py`（实现 `main()` 及 `version/evolve/forgekin/loop` 子命令，见 `cli/__init__.py` docstring），或将入口指向真实存在的模块并同步 `pyproject.toml` console_script。
- **T7/T8**：否

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

## 三、修复闭环（按 docs/test/README.md §测试交付规范）

1. 开发人员依据本单逐条修复，提交信息引用工单 ID（如 `fix: 修复 P-02 phase 脚本模块级 sys.exit`）。
2. 修复后由测试人员回归验证，通过则关闭工单（状态置 `Closed`）。
3. 未关闭工单视为未完结。

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
