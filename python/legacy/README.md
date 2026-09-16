# python/legacy — Python 旧版（Sunset 归档，S11.2）

> 归档时间：2026-09-16 ｜ 阶段 11（`docs/refactor/31-stage11-sunset.md`）S11.2 归档期
> 由根目录 `git mv` 迁入，**git 历史完整保留**，可随时回退。

## 这是什么

FlowForge 的 **Python 3.11+ 旧版单体内核**（legacy）。仓库主栈已切 TypeScript
（`packages/`、`apps/`、`web/` 等），本目录内容仅供归档/回退/行为基线参考，**不再作为活跃开发入口**
（`python -m flowforge` 已打印 `DEPRECATED` 冻结横幅）。

## 归档结构

按实际仓库（非 sunset 初稿设想）迁移，保持根原结构：

```
python/legacy/
├── __init__.py  __main__.py  sdk.py            # 根 Python 入口/桥接
├── pyproject.toml  requirements.txt  ruff.toml  py.typed
├── agents/  brain/  core/  llm/  loop/  forgemind/  evolution/
├── harness/  sop/  scheduler/  session/  memory/  events/  executor/
├── services/  observability/  compiler/  middleware/  modes/
├── mcp/  a2a/  review/  security/  app/  cli/  evaluators/
├── workflows/  skills/  tools/  vcs/
├── tests/                 # pytest 用例（vitest 的 tests/refactor/smoke.test.ts 保留在根）
└── scripts/               # 仅 Python .py 脚本
```

## 状态

- 最后状态：**Python 0.1.0 / TS 0.2.0**（阶段 10 入口切换后 Python 冻结）。
- **S11.3 删除尚未执行**——须待归档后 **≥2 个发布迭代**，届时 `git rm -r python/legacy/`，历史仍在 git。

## 回退方式（任一可逆）

归档后如需恢复 Python 至根目录：

```bash
git checkout <S11.2前的commit/tag> -- \
  agents brain core llm loop forgemind evolution harness sop scheduler \
  session memory events executor services observability compiler middleware \
  modes mcp a2a review security app cli evaluators workflows skills tools vcs \
  tests scripts sdk.py __init__.py __main__.py \
  pyproject.toml requirements.txt ruff.toml py.typed
pip install -e .
python -m flowforge
```

> 完整回退预案见 `31-stage11-sunset.md` §5。

## 数据位置

- **用户数据不移不删**，保留在根 `data/`（sqlite/json）。双栈冻结期只读，见 §4 数据处置。
- 共享配置数据保留在根 `config/`（TS 侧读取的 `config/forgekins`、`config/workflows` 等仍引用）。

## pytest 基线快照（P5）

归档前基线记录：`python/legacy-pytest-baseline-2026-09-16/`
（`.venv` Python 3.13.14 跑 `tests/unit`，收集 850 项执行至 ~92%，`test_skills.py` 5 项失败为既有遗留漂移；
该基线随 S11.3 一起删除）。

## 提交

本次归档（含 operator P2 提前放行裁决登记）：
`refactor(python): EP4 S11.2 Python旧版归档至python/legacy (含P2提前放行裁决)`。