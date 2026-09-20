# S4-1 desktop 桌面壳契约层（stretch 批次记录）

> 类型：EP4 stretch 后续（operator 准入推进 S2/S4/S5/S6）｜设计：`docs/refactor/36-stage-stretch-remaining.md` §1｜单一事实来源：`review_code.md` §13.5（S4-1 行）｜状态：✅ 已交付

## 决策落点
- 批次排序：S4 因**唯一零外部凭据、可即时动工**列为首启（设计 §5）；S5/S6/S2 依各自门禁后续。
- 契约-only 剥离：port clowder `desktop/` 的**契约层**（service-orchestrator + browser-shell 的可测表面），
  **Electron 集成（S4-2）后置**——不引 Electron/electron-builder，避免"零运行时原生依赖"策略被工具链污染（R3 待 operator 裁决）。
- 可测性：spawn/HTTP 探测/持久化一律**注入式**（`BackendSpawner`/`ReadinessProbe`/`BridgeContractPersistence`），
  无 Electron 运行时亦可单测，对齐 clowder 理念与既有 seam 风格。

## 交付物（packages/apps/desktop，新包 @flowforge/desktop v0.1.0-rc.5）
- `src/config.ts`：`resolveDesktopConfig`（**env 注入式**：host/端口/命令/根路径规范化；默认对齐 clowder
  `FRONTEND_PORT=3003`/`API_PORT=3004`）+ `DESKTOP_CONFIG_ENV_KEYS` + `normalizeDesktopRoot`。
- `src/bridge/contract.ts`：`DesktopBridgeContract`（对齐 clowder `preload.js` `desktopBridge`：
  splash-status / update prompt / update progress / update settings / update action 六词汇）+ `BRIDGE_CHANNEL` +
  `BridgeContractPersistence` 持久化面。
- `src/bridge/invariant.ts`：包内 `DesktopInvariantViolation` + 三不变式（update-action / version / boolean；
  host 视 renderer 消息为敌意，forge 帧 校验）。
- `src/bridge.ts`：`InMemoryDesktopBridge`（transport-agnostic 总线，注入式持久化）。
- `src/shell.ts`：`DesktopShellOrchestrator`（spawn→API 健康探测→URL；degraded **不抛错** 返回 `healthy:false`）+ 接口
  `BackendSpawner`/`ReadinessProbe`/`DesktopLaunchResult`。
- `src/index.ts`：导出全集。
- tests/：`config` / `bridge` / `shell` 3 文件 21 张测试（env 解析/URL 规范化；订阅/动作校验/持久化；编排/健康/超时/失败）。

## 验证
- 包级 vitest：21/21 全绿。
- tsc exit 0；oxlint 0；零运行时依赖（无 runtime dependency，仅打印 pkg）。
- ff_doctor all 合规 ✅；pnpm-lock 已注册 workspace（importers `packages/apps/desktop`）。

## 提交
- 随 mgr PR 提交（含 36-stage 设计文档 + review_code/task.md/10-stage-map 登记 + pnpm-lock）。
- S4-2 Electron 集成依 R3 工具链裁决后置。