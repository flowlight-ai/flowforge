# 阶段 6：外部 CLI 控制 limb（对齐 Clowder AI）

> 目标：移植 clowder-ai limb/terminal 域，实现对外部 Agent CLI（Claude Code/Codex/Gemini/
> Antigravity/opencode）的具身控制：配对、租约、观察路由、输出回传群聊。
> 范围控制：TTS/语音/邮件/GitHub 等信号通道 → **stretch**（`10-stage-map.md` §3.4 S2，仅留 ports）。

## 任务清单

- [ ] T6.1 `packages/limb/core`：LimbRegistry / LimbPairingStore / LimbLeaseManager /
      LimbAccessPolicy / LimbActionLog / LimbPresenceManager
- [ ] T6.2 `packages/limb/node`：RemoteLimbNode（远端节点通信）+ PluginLimbAdapter +
      PluginRestExecutor + PluginTokenManager
- [ ] T6.3 `packages/limb/observation`：LimbObservationRouter + LimbOutboundDeliveryHook +
      LimbTranscriptCatDelivery（输出回传群聊）
- [ ] T6.4 `packages/limb/embodiment`：LimbEmbodimentBindingStore + limb-yaml-loader +
      ApprovedLimbPairingPersistence（具身绑定与配对持久化）
- [ ] T6.5 `packages/terminal`：tmux-gateway / tmux-agent-spawner / agent-sessions-reader /
      session-store / agent-pane-registry（Windows 回退：node-pty 实现同接口）
- [ ] T6.6 `packages/limb/adapters`：Claude Code（stream-json）、Codex（json）、Gemini CLI
      （stream-json/ACP）、Antigravity agy（plain text）、opencode（ndjson）
- [ ] T6.7 测试：mock CLI（输出固定 stream-json）完成配对→租约→执行→转录→回传；
      租约冲突拒绝；Windows pty 路径冒烟

## 验收标准

1. 可注册/配对/停用一个外部 CLI 实例，租约互斥生效。
2. mock CLI 会话输出实时进入群聊线程。
3. 适配器解析正确（stream-json/json/ndjson/plain text 四种格式各一例）。
4. 路由统一挂 `/api/v2/*`（R18），与 Python 旧版 `/api/v1/*` 物理隔离。
5. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(limb): 具身控制外部CLI(tmux/租约/适配器) [sherlock]
```
