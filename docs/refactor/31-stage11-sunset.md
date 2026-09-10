# 阶段 11：Python 旧版日落与删除计划（Sunset）

> 状态：**S11.1 冻结期进行中** ｜ 创建：2026-08-16 ｜ 负责人：[:wenxin] + [:sherlock]
> 目标：TS 版功能齐平并稳定运行后，分三阶段冻结、归档、删除 Python 旧版，全程 git 历史可追溯。
> （更新 2026-09-10：阶段10 入口切换（`30-stage10-cutover.md` T10.1）已把默认入口切为 TS 栈并标注
> Python `DEPRECATED`；S11.1 冻结横幅已落地 `__main__.py`（`python -m flowforge`）。**S11.2 归档 /
> S11.3 删除受 P1/P2 前置门槛硬约束，不做未经收货的提前删除。** -> S11.2/S11.3 状态见 §1。）

## 1. 启动前置条件（全部满足才允许进入归档期/删除期）

功能全集矩阵核算：D/C/F 主线已全部 ✅（stretch 除外）；**D55 / C49-C51 / F44-F45 为 EP4 遗留项**
（见 task.md EP4 第 3 项），与"Python 日落"解耦——不阻塞 S11.1 冻结，但 S11.3 删除前需收口。

- [x] P1. 功能全集矩阵（`10-stage-map.md` §3）D1-D44 / C1-C42 / F1-F44（stretch 项除外）✅（EP3-1 核对达标）
      剩余 D55/C49-C51/F44-F45 归 EP4-3 遗漏项收尾，S11.2/S11.3 判据沿用 §6 验收标准
- [ ] P2. TS 版作为默认入口稳定运行 **≥ 2 周**，无 P0/P1 缺陷（阶段 10 入口切换 2026-09-10 完成，
      **稳定性观察期未满，S11.2/S11.3 暂缓**）
- [ ] P3. 数据处置方案确认（见 §4）：旧数据迁移或冻结只读，双栈不共享写库
- [ ] P4. 行为基线用例 100% 转写为 TS golden tests（`03-fusion-strategy.md` §5）
- [ ] P5. 全量 `pytest` 通过快照存档（作为删除前的基线记录）

## 2. 三阶段日落流程

### S11.1 冻结期（Freeze，1-2 个发布迭代）

- [x] Python 启动路径（`python -m flowforge` / `start.bat` 旧逻辑）打印
      `DEPRECATED: Python 版本已冻结，请使用 pnpm start（FlowForge 0.2.0 TS）`
      （2026-09-10：`start.bat` 已切 TS 栈并标注 deprecated；`__main__.py` 补冻结横幅；无 `start_py.bat`）
- [x] Python 代码只接受 P0 修复；新功能一律只在 TS 版开发（冻结期声明，2026-09-10）
- [ ] `pytest` 继续纳入 CI 回归（防数据迁移期间行为漂移），但标记 `legacy`
- [x] README / docs/spec.md 顶部标注 Python 版状态为 deprecated（阶段10 已标注，含回退章节）

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

## 7. EP4 stretch 项排期（2026-09-10 对齐 review_code §13.5 / §15）

> stretch 不阻塞主线里程碑；以下为按裁决的启用条件与承接批次。S1 拆解见 `10-stage-map.md` §3.4。

| 项 | 内容 | 启用条件 / 承接 | 排期 |
|---|---|---|---|
| S1 | IM 真实通道凭据启用（connector 框架本体已交付 C44/EP1-2） | 外部凭据接线后方启用 | P0 修复期后 |
| S2 | TTS/语音 / RSS / 邮件 / GitHub signals | 依赖外部服务 | 未排期（⬜） |
| S3 | world/community/story/leaderboard（端口+mock 已交付 batch8 chat-stretch） | 产品优先级 | 未排期（⬜） |
| S4 | 桌面端 desktop | 产品优先级 | 未排期（⬜） |
| S5 | 游戏/信号 games | 产品优先级 | 未排期（⬜） |
| S6 | Python↔TS 桥接 SDK（`python/sdk`，即 T9.6） | 外部 Python 调用方实际需求驱动 | 未排期（⬜） |
| S7 | 物理 AI 传感器 / 虚拟世界设置（F44） | 产品优先级 | 未排期（⬜） |

> 结论：S1-S7 现阶段均**不排期**（无发起动机、缺外部凭据/服务或产品优先级不足），随 operator 新指令按上表准入；
> 主线 EP4 剩余工作集中到 §6 验收标准 + P1/P2 遗漏项收尾（task.md EP4 第 3 项）。
