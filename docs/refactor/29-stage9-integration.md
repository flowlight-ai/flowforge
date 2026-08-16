# 阶段 9：集成与全量回归

> 目标：功能全集矩阵核对、端到端测试、性能验证、双栈共存验证。

## 任务清单

- [ ] T9.1 功能全集矩阵核对（`10-stage-map.md` §3 逐项：D1-D44/C1-C42/F1-F44，stretch 项除外）
- [ ] T9.2 e2e 场景 1：用户群聊 @ 灵智体 → 调用外部 CLI（mock）→ 输出回传 → 经验蒸馏入库
- [ ] T9.3 e2e 场景 2：Forgekin 五闭环演进 → MindCouncil 跨厂商审议 → 提交 PR（mock git）
- [ ] T9.4 e2e 场景 3：MCP 工具调用 → 工作流 DAG 执行 → 上下文压缩 → 会话续接
- [ ] T9.5 性能：100 并发消息投递（对照 Python 版 test_websocket_load）、大 session 压缩耗时
- [ ] T9.6 `python/sdk`（可选）：Python 侧 HTTP/JSON-RPC 客户端桥，旧 Python 调用方可迁移
- [ ] T9.7 双栈验证：TS 全量 e2e + Python `pytest` 全量双绿
- [ ] T9.8 文档同步：docs/refactor 矩阵状态更新、遗留问题清单

## 验收标准

1. 功能矩阵 D/C/F 全部 ✅。
2. 三个 e2e 场景在 CI 可重复运行。
3. 性能指标不低于 Python 版基线。
4. 双栈测试全绿。

## 提交信息模板

```
test(refactor): 阶段9集成回归与功能矩阵核对 [davinci]
```
