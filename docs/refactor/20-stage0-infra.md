# 阶段 0：计划文档 + TS 基础设施 + 插件基座

> 目标：为整个重构建立 TS 工程底座（pnpm workspace + vendor cordis），并**最先搭好
> “一切皆插件”框架**：插件宿主装配器 + 插件生命周期冒烟；产出全部计划文档，验证双栈共存可行。
> 完成后按 `10-stage-map.md` §4 的 DoD 验收。

## 任务清单

- [x] T0.1 编写 `docs/refactor/00-overview.md`（总览）
- [x] T0.2 编写 `docs/refactor/01-stack-decision.md`（技术栈决策 R01-R19，含插件契约 R13/配置体系 R17/技术栈对齐 R19）
- [x] T0.3 编写 `docs/refactor/03-fusion-strategy.md`（三项目融合策略：分层/冲突消解/概念映射/行为基线）
- [x] T0.4 编写 `docs/refactor/10-stage-map.md`（阶段地图 + 功能全集矩阵）
- [x] T0.5 编写 `docs/refactor/31-stage11-sunset.md`（Python 日落计划）
- [x] T0.6 编写本文件 `docs/refactor/20-stage0-infra.md`
- [ ] T0.7 根目录新增 `package.json`（name=flowforge、packageManager=pnpm、engines node>=22.19）
- [ ] T0.8 根目录新增 `pnpm-workspace.yaml`（workspaces: vendor/*, packages/*/*, apps/*）
- [ ] T0.9 根目录新增 `tsconfig.base.json`（strict 基线，对齐 dsh）
- [ ] T0.10 根目录新增 `vitest.config.ts`（workspace 项目扫描）
- [ ] T0.11 根目录新增 `.oxlintrc.json`（对齐 dsh lint 基线）
- [ ] T0.12 `.gitignore` 增补：`**/dist/`、`**/*.tsbuildinfo`、`**/.vitest/`、`coverage/`、`.pnpm-store/`
- [ ] T0.13 vendor cordis 全家桶：从 `ex/deepseek-harness/vendor/` 复制
      cordis / cosmokit / group / hmr / include / loader / logger-console / schemastery / timer，
      保留各包 LICENSE 与根 `THIRD_PARTY_NOTICES.md` 增补声明
- [ ] T0.14 **插件基座**：`packages/harness/boot` 最小插件宿主——加载插件清单（manifest）→
      按依赖顺序 `ctx.plugin()` 安装 → start/stop；冒烟测试覆盖插件生命周期
      （created/ready/dispose）与跨插件服务注入
- [ ] T0.15 根目录新增冒烟测试 `tests/refactor/smoke.test.ts`：
      ① cordis Context 可用；② 自定义插件加载后 `ctx.*` 服务可用；③ 卸载后不可用
- [ ] T0.16 验证：`pnpm install` 成功；`pnpm test` 冒烟通过
- [ ] T0.17 验证：Python 旧版 `pytest -m "not slow and not integration"` 全绿（双栈共存）
- [ ] T0.18 `./mgr` 提交
- [ ] T0.19 **配置体系基座**（R17/R19 落地第一步）：
      ① 根级 `FF_*` 环境变量注册表骨架（`packages/harness/env-registry`，对齐 clowder env-registry.ts）；
      ② schemastery schema 校验链路冒烟（插件声明 `schema` → boot 合并 → 校验，覆盖 T0.14 基座）；
      ③ vendor dsh `packages/settings/settings` + `settings-file`（设置抽象）；
      ④ `config/` 现有 YAML 全量清单登记（名称→归属插件→迁移状态，纳入 `02-source-crosswalk.md` §3）

## 验收标准

1. `pnpm install && pnpm test` 在仓库根目录零报错。
2. `import { Context } from '@deepseek-ai/cordis'` 可用（vendor 包可解析）。
3. **插件基座可用**：`packages/harness/boot` 能按 manifest 加载插件并完成
   生命周期（加载→启动→服务注入→停止），冒烟测试全绿。
4. Python `pytest` 回归全绿，证明新增 TS 目录不影响旧版。
5. `docs/refactor/` 下 8 份核心文档齐全（00/01/02/10/20/21/30/31 + 各阶段任务文档），
   功能全集矩阵可勾选。
6. 配置体系基座可用：env-registry 可登记/读取 `FF_*`；插件 schema 校验冒烟通过；
   YAML 配置清单登记完成。

## 提交信息模板

```
chore(refactor): 阶段0 TS基础设施/插件基座与重构计划文档 [luban]
```

## 风险备注

- pnpm 本机为 10.30.3（dsh 声明 11.7.0）：lockfile 版本差异一般兼容；若 `pnpm install`
  报 lockfile 版本错误，先 `pnpm install --lockfile-only` 生成 v9 格式再装。
- vendor 包 peerDependencies 指向 `@deepseek-ai/cordis-plugin-*`：一并 vendor 后
  在根 `pnpm-workspace.yaml` 中注册，确保解析。
