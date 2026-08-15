# 阶段 10：入口切换与收尾

> 目标：默认入口切换到 TS 版，文档收尾；Python 旧版从"双栈共存"转入
> 日落前置状态（正式日落流程见 `31-stage11-sunset.md`，本阶段仅完成冻结前的入口切换）。

## 任务清单

- [ ] T10.1 默认入口切换：`start.bat` / `start.sh` / `install.bat` / README 指向
      `pnpm install && pnpm start`（TS 版，插件基座装配全部域插件）
- [ ] T10.2 Python 旧版冻结前置：保留 `flowforge/` 包代码与 `data/` 数据，启动路径打印
      DEPRECATED 提示；后续冻结/归档/删除按 `31-stage11-sunset.md` S11.1-S11.3 执行
- [ ] T10.3 文档更新：README.zh-CN / README.md / docs/spec.md / docs/arch.md 补 TS 架构章节
      （VISION 不变）
- [ ] T10.4 docs/refactor 收尾：矩阵全绿存档、复盘记录、遗留清单
- [ ] T10.5 全新机器一键启动演练（按 README 步骤从零启动 TS 版）
- [ ] T10.6 `./mgr status` 干净，双平台同步（如需）

## 验收标准

1. 全新环境按 README 一键启动 TS 版全部功能。
2. Python 旧版可随时回退（文档说明回退步骤），且已进入日落冻结前置状态。
3. 所有 docs 与代码命名合规（P1 优先、P2 双标注）。
4. 日落前置条件（`31-stage11-sunset.md` §1 P1-P5）逐项确认并勾选。

## 提交信息模板

```
docs(refactor): 阶段10入口切换与文档收尾 [wenxin]
```
