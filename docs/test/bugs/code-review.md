# 代码检视 / 测试脚手架附录（bugs/code-review.md）

> **定位（BUG_PROTOCOL §零.3）**：本文件收录**代码检视 / 静态分析 / 测试脚手架类**发现。
> 此类发现**未经功能复现，不计入功能验证覆盖率**，仅作辅助参考，与主索引 `bugs.md` 区分。
> 若后续为其补出"真实业务场景复现"，应升级为主索引工单。

---

## B4（附录）｜ S3（参考）｜ 测试脚本缺陷 ｜ 无 conftest_e2e.py，集成/E2E 沿用含 mock 的 conftest.py（违反 T1）

- **文件:行号**：`tests/conftest.py`（含 mock/fake）；缺失 `tests/conftest_e2e.py`
- **现象**：
  ```
  $ grep -rinc "mock\|fake" tests/conftest.py
  6
  $ ls tests/conftest_e2e.py
  （不存在）
  ```
  T002 §1 已将 B4 列为"测试前必须先修复"前置项：集成/E2E 应在 `conftest_e2e.py` 中用真实 LLM 基础设施，而非在 `conftest.py` 中 Mock LLM。
- **影响**：真实 LLM 的集成/E2E 测试基础设施未隔离，易误用 Mock 通过，违反 T1 真实 LLM 铁律。
- **建议修复**：拆分 `conftest_e2e.py`（真实 LLM fixture：`use_real_llm` / `real_llm_context`），`conftest.py` 仅服务单元测试。
- **计入 DI**：否（附录，未功能复现）
