# 阶段 11：Python 旧版日落与删除计划（Sunset）

> 状态：未开始（前置依赖阶段 9/10 验收） ｜ 创建：2026-08-16 ｜ 负责人：[wenxin] + [sherlock]
> 目标：TS 版功能齐平并稳定运行后，分三阶段冻结、归档、删除 Python 旧版，全程 git 历史可追溯。

## 1. 启动前置条件（全部满足才允许进入冻结期）

- [ ] P1. 功能全集矩阵（`10-stage-map.md` §3）D1-D44 / C1-C42 / F1-F44（stretch 项除外）全部 ✅
- [ ] P2. TS 版作为默认入口稳定运行 ≥ 2 周，无 P0/P1 缺陷（阶段 10 入口切换完成）
- [ ] P3. 数据处置方案确认（见 §4）：旧数据迁移或冻结只读，双栈不共享写库
- [ ] P4. 行为基线用例 100% 转写为 TS golden tests（`03-fusion-strategy.md` §5）
- [ ] P5. 全量 `pytest` 通过快照存档（作为删除前的基线记录）

## 2. 三阶段日落流程

### S11.1 冻结期（Freeze，1-2 个发布迭代）

- [ ] Python 启动路径（`python -m flowforge` / `start_py.bat`）打印
      `DEPRECATED: Python 版本已冻结，请使用 pnpm start（FlowForge 0.2.0 TS）`
- [ ] Python 代码只接受 P0 修复；新功能一律只在 TS 版开发
- [ ] `pytest` 继续纳入 CI 回归（防数据迁移期间行为漂移），但标记 `legacy`
- [ ] README / docs/spec.md 顶部标注 Python 版状态为 deprecated

### S11.2 归档期（Archive，1 个发布迭代）

- [ ] 目录迁移：
      - `flowforge/`（Python 包源码）→ `python/legacy/flowforge/`
      - `web/`（Python 版 Next.js 前端，若有独立于 TS 前端的页面）→ `python/legacy/web/`
      - `tests/`（pytest 用例）→ `python/legacy/tests/`
      - `scripts/`、`start_py.*`、`requirements*.txt`、`pyproject.toml` → `python/legacy/`
- [ ] 根 `pyproject.toml` 删除或改为指向 `python/legacy`（`pip install -e python/legacy` 可选）
- [ ] `python/legacy/README.md` 写明：归档时间、最后版本、回退方式、数据位置
- [ ] 保留 `python/sdk`（HTTP/JSON-RPC 桥接 SDK，供旧 Python 调用方访问 TS 服务，可选）
- [ ] mgr 提交：`refactor(python): Python旧版归档至python/legacy [wenxin]`

### S11.3 删除期（Removal，归档后 ≥ 2 个发布迭代）

- [ ] `git rm -r python/legacy/`（git 历史永久保留，可随时从历史恢复）
- [ ] 删除 `pytest` 相关配置与 CI 任务（legacy 标记的测试项）
- [ ] 更新 `10-stage-map.md` 矩阵：Python 旧版状态列改为 `🗑️ sunset`
- [ ] mgr 提交：`chore(refactor): 阶段11删除Python旧版(历史保留在git) [wenxin]`

## 3. 保留清单（永不删除）

| 项 | 位置 | 原因 |
|---|---|---|
| Python 数据目录 | `data/`（按 §4 处置） | 用户数据不可丢 |
| git 历史 | 全仓库 | 行为基线可追溯、随时可回退 |
| `docs/design/`、`docs/spec.md` 行为描述 | docs/ | 产品行为契约（语言中立） |
| `python/sdk`（可选） | python/sdk | 外部 Python 调用方桥接 |
| 行为基线转写的 TS golden tests | packages/*/tests | 保证行为等价 |

## 4. 数据处置决策（P3 必须明确）

| 数据 | Python 位置 | TS 落点 | 策略 |
|---|---|---|---|
| Forgekin 档案/印记 | `data/`（sqlite/json） | `packages/cats` + `packages/forgekin` 库 | 提供迁移脚本 `python/sdk/migrate`（阶段 10-11 开发），双栈冻结期只读 |
| 群聊/消息 | `data/` | `packages/chat` 库 | 同上 |
| 记忆库（EchoStore/MindCodex） | `data/` | `packages/forgekin/stores` | 同上 |
| 会话/任务日志 | `data/` | `packages/core/session` + `packages/cats` | 同上 |
| 配置文件 | `config/` | `schemastery schema`（TS） | 提供配置转换器，冻结期人工确认 |

默认策略：**迁移优先**；无法自动迁移的数据（如旧格式 blob）在冻结期以只读模式挂载，
删除期前与用户确认后再处置。

## 5. 回退预案（任何阶段可触发）

```bash
# 入口已切 TS 后如需回退 Python：
git checkout <阶段10之前的tag> -- flowforge web tests pyproject.toml
pip install -e .
python -m flowforge
```

- 回退仅支持到 S11.2 归档前；删除期后回退 = 从 git 历史恢复（文档给出恢复步骤）。
- 每次 S11 子阶段提交前，`./mgr pull` + `pytest` 绿 + `pnpm test` 绿双验证。

## 6. 验收标准

1. S11.1 后：TS 为唯一新功能开发入口，Python 只修 P0。
2. S11.2 后：仓库根无 `flowforge/*.py` 活动代码，`python/legacy/` 结构完整可运行。
3. S11.3 后：仓库无 Python 运行时代码与测试配置，`pnpm start` 全功能可用。
4. 全程 git 历史保留；`./mgr status` 干净。

## 提交信息模板

```
refactor(python): Python旧版归档至python/legacy [wenxin]        # S11.2
chore(refactor): 阶段11删除Python旧版(历史保留在git) [wenxin]    # S11.3
```
