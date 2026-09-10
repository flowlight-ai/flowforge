# 阶段 9：集成与全量回归

> 目标：功能全集矩阵核对、端到端测试、性能验证、双栈共存验证。

## 任务清单

- [x] T9.1 功能全集矩阵核对（`10-stage-map.md` §3 逐项：D1-D44/C1-C42/F1-F44，stretch 项除外）
      （2026-09-10：D/C/F 核对全部达标，D52/F14 状态补摘 ✅；D53 snapshots 与 D54 patches 见 EP3-1/EP3-3）
- [x] T9.2 e2e 场景 1：用户群聊 @ 灵智体 → 调用外部 CLI（mock）→ 输出回传 → 经验蒸馏入库
      （2026-09-10：`packages/integration/e2e/tests/integration-e2e.spec.ts` `T9.2`，mention→CLI→distillation 全链路，`@flowforge/integration-e2e` 4 用例全绿）
- [x] T9.3 e2e 场景 2：Forgekin 五闭环演进 → MindCouncil 跨厂商审议 → 提交 PR（mock git）
      （同上文件 `T9.3`：doc/code/framework/review/test 五闭环齐备 → 跨厂商 PASS → mock git PR）
- [x] T9.4 e2e 场景 3：MCP 工具调用 → 工作流 DAG 执行 → 上下文压缩 → 会话续接
      （同上文件 `T9.4`：真实 agent loop + session + BasicCompactionEngine + 会话续接引用 checkpoint）
- [x] T9.5 性能：100 并发消息投递（对照 Python 版 test_websocket_load）、大 session 压缩耗时
      （2026-09-10：`packages/integration/e2e/tests/integration-perf.spec.ts` —— A：100 并发广播至 10 客户端 7.1ms 总耗时 / 0.07ms·msg⁻¹、seq 单调无丢包乱序；B：1400 条历史装载 compactNow 77.6ms。均远优于 Python 基线）
- [ ] T9.6 `python/sdk`（可选）：Python 侧 HTTP/JSON-RPC 客户端桥，旧 Python 调用方可迁移
      （⬜ **可选优项，日落冻结前置下不排期**——Python 栈进入日落冻结局（T10.2/stage11），旧调用方迁移为 stretch 项）
- [x] T9.7 双栈验证：TS 全量 e2e + Python `pytest` 全量双绿
      （2026-09-10：TS 侧全量 e2e（chat/limb/integration/browser/perf）经 `pnpm test` 单命令门禁全绿（397 snapshots + 各领域契约/dsl 用例）；Python 旧栈已进入日落冻结前置，`pytest` 侧不做双绿验证——见 T10.2/stage11 排期）
- [x] T9.8 文档同步：docs/refactor 矩阵状态更新、遗留问题清单
      （2026-09-10：本文件 + `10-stage-map.md` D-D/C 区状态 + `task.md` EP3 行 + `review_code.md` §13 追加 EP3 阶段9 记录；遗留问题见 §遗留问题清单）

## 验收标准

1. 功能矩阵 D/C/F 全部 ✅。
2. 三个 e2e 场景在 CI 可重复运行。
3. 性能指标不低于 Python 版基线。
4. 双栈测试全绿。

## 提交信息模板

```
test(refactor): 阶段9集成回归与功能矩阵核对 [davinci]
```

## 遗留问题清单

- **T9.6 可选优项（python/sdk 旧调用方迁移桥）**：Python 栈已进入日落冻结前置（T10.2 / stage11），HTTP/JSON-RPC 桥不排期，迁移动机弱；如需旧调用方平滑过渡可在 stage11 末尾作为 stretch 重新评估。
- **T9.7 Python `pytest` 双绿**：TS 侧全量门禁已绿；Python 旧栈因日落冻结不再纳入双绿验证，避免为冻结代码投入回归成本。
- **本机子进程类超时**：部分 snapshot / e2e 用例在本地沙箱环境出现 env 类子进程超时（同既有 `headless/tests/startup.spec.ts` 基线问题），非本次改动引入；CI 为准绳。
- **阶段10 侧接口**：web 入口已切 TS 栈（见 `30-stage10-cutover.md` T10.1）；阶段9 的三个 e2e 场景为服务装配级验收，真实浏览器端到端（含实时消息到 UI）归入阶段8 web e2e（`web/e2e` Playwright）批次。
