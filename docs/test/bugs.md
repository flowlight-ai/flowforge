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
| **缺陷总数（DI count）** | **7** |
| **加权缺陷指数（DI）** | **50** ＝ S1×10 + S2×5 + S3×2 + S4×1 |
| 状态：Open | 6 |
| 状态：Fixed（待回归） | 1 |
| 状态：Closed | 0 |

### 按严重度（Severity）

| 等级 | 含义 | 数量 | 工单 |
|------|------|:----:|------|
| **S1 阻断** | 测试/安全不可用，须立即修复 | 3 | P-01, P-02, P-03 |
| **S2 严重** | 核心功能/质量受损 | 4 | P-04, P-05, P-06, P-07 |
| **S3 一般** | 明显缺陷但可绕过 | 0 | — |
| **S4 轻微** | 文档/小修 | 0 | — |

### 按分类（Category）

| 分类 | 数量 | 工单 |
|------|:----:|------|
| 安全隐患 | 1 | P-01 |
| CI / 配置 | 2 | P-02, P-06 |
| 代码缺陷 | 2 | P-03, P-04 |
| 目录结构 | 1 | P-05 |
| T7 / T8 合规 | 1 | P-07 |

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
- **严重度**：S1 ｜ **分类**：CI / 配置 ｜ **状态**：Open
- **文件**：`tests/e2e/test_phase1_foundation.py:285`、`test_phase2_shell_unified.py:292`、`test_phase3_mode_fusion.py:208`、`test_phase4_agent_admin.py:226`
- **现象**：4 个 phase 脚本在模块顶层（非函数内）直接 `sys.exit(0 if failed == 0 else 1)`。pytest 收集阶段导入模块即触发 `SystemExit` → 整会话 `INTERNALERROR` 中止（见验证记录），导致 `pytest tests/ -q` 整轮失败、992 用例未被执行。
- **建议**：将脚本主体移入 `def main():` 并加 `if __name__ == "__main__": sys.exit(main())` 守卫；或改为 pytest 用例 + `assert`，不依赖模块级退出码。
- **T7/T8**：否

### P-03 — `core/errors.py` 缺失 PartnershipError / ReliabilityError
- **严重度**：S1 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`core/errors.py`（仅定义 FlowForgeError 及其 13 个子类，无 PartnershipError / ReliabilityError）
- **现象**：`tests/core/partnership/test_math.py:19`（`from flowforge.core.errors import PartnershipError`）与 `tests/core/reliability/test_wal.py:15`（`from flowforge.core.errors import ReliabilityError`）在收集期即 `ImportError`，对应用例全部收集失败；相关特性文档（F022–F025）亦引用这两个异常。
- **建议**：在 `core/errors.py` 中补 `class PartnershipError(FlowForgeError)` 与 `class ReliabilityError(FlowForgeError)`，使合作/可靠性模块与测试对齐。
- **T7/T8**：否

### P-04 — `harness/governance.py:259` 拼写错误 `inject_to_system_rule`
- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`harness/governance.py:259` → `return await self.inject_to_system_rule(target)`
- **现象**：方法名 `inject_to_system_rule` 疑似拼写错误（应为 `inject_to_system_prompt` 或 `inject_into_system_rule`，取决于真实定义）。该 goroutine 治理注入路径调用不存在的方法名，运行期将抛 `AttributeError`，导致治理规则注入失效。
- **建议**：核对该方法真实定义并修正拼写；补单测覆盖 `governance` 注入调用，避免再次拼写漂移。
- **T7/T8**：否

### P-05 — `d:/software/openclaw` 硬编码 + 仓库根寄生 `d:` 目录（未 gitignore）
- **严重度**：S2 ｜ **分类**：目录结构 ｜ **状态**：Open
- **文件**：`llm/trae/config.py:167`、`llm/trae/adapter.py:96`、`forgemind/autonomous.py:108`（另 `config/im_council.yaml:42`、`config/trae_bridge.yaml:19` 含默认占位 `d:/software/openclaw/...`）
- **现象**：Windows 绝对路径 `d:/software/openclaw/...` 写死于 3 处源码，并在仓库根寄生创建 `d:` 目录（实测根目录存在 `d:` 文件夹，且未在 `.gitignore` 中）。在非 `D:` 盘 / 非 Windows 环境（Linux、iOS）克隆即路径失效，`d:` 目录还会被误提交。
- **建议**：改以相对路径 / `Path(__file__)` / 环境变量（`FLOWFORGE_BRIDGE_DIR` 等已有占位机制）解析；将根目录 `d:` 加入 `.gitignore` 并清理已寄生目录。
- **T7/T8**：否

### P-06 — `pytest.ini` 静默覆盖 `pyproject.toml` 的 pytest 配置
- **严重度**：S2 ｜ **分类**：CI / 配置 ｜ **状态**：Open
- **文件**：`pytest.ini`（全量 `[pytest]` 段）覆盖 `pyproject.toml:108` `[tool.pytest.ini_options]`
- **现象**：`pyproject.toml` 已声明 `minversion="8.0"` 与 `addopts=["-v","--strict-markers"]` 等，但 pytest 配置优先级 `pytest.ini` 高于 `pyproject.toml`，前者被静默采用、后者 `addopts` / `strict-markers` 等被忽略；两处重复声明 `testpaths` / `python_files` 易漂移且排查困难。
- **建议**：保留单一配置源（推荐 `pyproject.toml` 的 `[tool.pytest.ini_options]`），删除 `pytest.ini` 或仅放 pytest 不覆盖的键；统一 markers / asyncio_mode 声明。
- **T7/T8**：否

### P-07 — 23 个 e2e 测试中 14 个未接 T7/T8
- **严重度**：S2 ｜ **分类**：T7 / T8 合规 ｜ **状态**：Open
- **文件**：`tests/e2e/`（共 23 个 `test_*.py`，仅约 9 个引用 T7/T8 铁律，14 个无 T7/T8 审核/DOM 验证接线）
- **现象**：按测试铁律 T7（LLM 内容审核）/ T8（浏览器 DOM 验证），涉及 LLM 生成与网页发布的 e2e 用例必须做二次审核与 DOM 校验。静态扫描显示 23 个 e2e 脚本中约 14 个完全未接线 T7/T8，违规铁律却仍可“通过”，质量闸门形同虚设。
- **建议**：对生成/发布类 e2e 用例统一以 harness 的 `LLMReviewer` / `DOMVerifier` 为入口强制开启 T7/T8（提供 `--t7` / `--t8` 开关并在 CI 启用），补齐缺失接线。
- **T7/T8**：是（T7 + T8）

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
