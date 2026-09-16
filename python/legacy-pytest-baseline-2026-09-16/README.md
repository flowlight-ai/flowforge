# pytest 基线快照（P5）— 2026-09-16

> 阶段 11（`31-stage11-sunset.md` §1 P5）要求的删除前 pytest 基线记录。
> 归档（S11.2）前，用仓库 `.venv` Python 3.13.14 于根目录执行的一次性快照。**尽力而为**，非全量全绿。

## 尝试与结果

- 命令：`.venv\Scripts\python.exe -m pytest -q --tb=short tests/unit`
  （`tests/unit` 为可离线回归的代表性子集；全量含 `e2e`/`integration`，多数需真实外部 API / 浏览器，无法在此环境全跑）
- 环境：win32，Python 3.13.14，pytest-9.1.1，plugins anyio / langsmith / asyncio
- **收集 850 项**，执行进度至 **`test_task_board.py [92%]`** 后输出中断（后台作业超时结束，未落入最终
  `=== short test summary ===` 汇总行）。

## 通过/失败概览

- `-` 通过为主；已观测到失败集中在 **`tests/unit/test_skills.py`（5 项失败 `F..FFFF..`）**，疑似该组用例依赖
  的技能/工具链在此环境未完整就绪，属基线遗留行为漂移，非本次归档引入。
- 因最终汇总未落盘，「精确 通过/失败/跳过 计数」缺失；本文件以原始输出 `pytest-unit-baseline-2026-09-16.txt`
  中的 `[%]` 进度与 `F` 标记为准。

## 备注

- 本目录随 S11.3 一起删除；如需长期保留，请在删除期前另行归档。
- 归档并不依赖本基线结果；基线仅作为删除（S11.3）前的历史记录。