# S-A13 code-runtime-python 内联移植（stretch 批次记录）

> 类型：EP4 stretch 批次｜设计：`docs/refactor/35-stage-stretch-batch.md` §4-1｜单一事实来源：`review_code.md` §13.5（S-A13 行）｜状态：✅ 已交付

## 决策落点
- 共享契约范围：按 §4-1 裁决，**内联最小必需子集**（identifier/error/protocol/binding 契约均已在既有
  `@flowforge/code-runtime` / `session` / `timeout` / `schemastery` / `cordis` / `invariants`，A13 复用，不重造
  公有契约包）。
- 运行时形态：`PythonCodeRuntime extends CodeRuntime`，`language='python'` / `isolation='process'`，对齐
  `code-runtime-worker-thread` 蓝本（可移植标识符 `IDENTIFIER`、schemastery `static Config` 默认填充、
  `OutputLedger` 输出字节扣账、wall-clock 预算、dispose 到 quiescence）。
- 关键偏差——**stdio JSON-lines 双管道**：Python 子进程经 fd3（host→child 读）/ fd4（child→host 写）分隔
  管道桥接 binding，规避 dsh 单一 fd3 双向管道在 Windows 上的永久死锁（线程 A readable / 线程 B writable
  同时操作单根 fd3 阻塞整根 fd）。
- 进程纪律：`spawn` 清空 env；wall-clock + 汇总 output-bytes 预算；terminate-on-abort/timeout，SIGTERM→SIGKILL
  升级窗口 `KILL_GRACE_MS=2000`；dispose 标记服务不可用并 AWAIT 每个 child 退出。

## 交付物（packages/code-runtime/code-runtime-python，新包 @flowforge/code-runtime-python v0.1.0-rc.5）
- `src/index.ts`：`PythonCodeRuntime` 主后端（fd3/fd4 双管道协议、预算、拆装、teardown）。
- `src/protocol.ts`：versionless 逐字段重建的入站帧校验（host 视 child 为敌意，同 worker-thread 约定）。
- `src/output-json.ts`：JSON 值/字符串字节预算 + 安全截断。
- `src/bootstrap.ts`：`resolvePythonCommand` / `buildPythonArgs`。
- `src/invariant.ts`：包级不变式导出。
- `py/bootstrap.py` + `py/protocol.py`：CPython 侧换置/绑定桥接资产，随包分发（package.json files）。
- tests/：`protocol` / `output-json` / `runtime` 3 文件 36 张测试（含真实 python 3.13 集成）。

## 验证
- 包级 vitest：36/36 全绿（含真实 CPython 3.13 子进程集成）。
- tsc exit 0；oxlint 0；无 `@deepseek-ai` / `@cat-cafe` 依赖（forbidden 扫描干净）。
- lib/ 已 gitignore（构建产物不入库）。

## 提交
- 随 mgr PR 提交（累加至 PR #202 同批次；pnpm-lock.yaml 已注册新 workspace 包）。