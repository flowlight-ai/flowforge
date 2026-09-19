# S-S1 真实飞书 IM 通道（stretch 批次记录）

> 类型：EP4 stretch 批次｜设计：`docs/refactor/35-stage-stretch-batch.md` §4-2｜单一事实来源：`review_code.md` §13.5（S-S1 行）｜状态：✅ 已交付

## 决策落点
- S1 首发通道 = 飞书（feishu）；凭据三键 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CHAT_ID`
  （对齐 `config/im_channels.yaml` `feishu_group` 槽位）。
- 配置探测 → 未配置回退 mock + 健康检查降级：`FeishuImChannelAdapter` 凭据不全时自身降级
  （send 仅本地记录返回 delivered:false、handleInbound 'ignored'、health ok:false + 缺键诊断），
  不破坏既有 lark mock 装配。
- 接入 connector gateway：`FeishuConnectorOutboundAdapter` 结构兼容 `IOutboundAdapter` 必需子集
  （connectorId='feishu' + sendReply），刻意不 import `@flowforge/infrastructure-connectors`，避免
  stretch-ports 构建图耦合。

## 交付物（packages/chat/stretch-ports）
- `src/feishu/feishu-config.ts`：配置探测 + `isFeishuConfigured` / `feishuConfigGap` 缺键诊断。
- `src/feishu/feishu-im-channel.ts`：`FeishuImChannelAdapter`（真实飞书 OpenAPI v2：
  `tenant_access_token` → `im/v1/messages` text/interactive_card；HTTP 传输注入式缺省 `fetch`）。
- `src/feishu/feishu-connector-outbound.ts`：connector gateway 出站桥。
- `src/index.ts`：`ChatStretchService` 新增 `feishu` 选项 + `feishuChannel` getter 覆盖缺省 lark mock + 导出全集。

## 验证
- 包级 vitest：2 文件 26/26 全绿（新增 17 张：配置探测/真实适配器/降级/桥/装配）。
- tsc --build（tsconfig + tsconfig.host）exit 0；oxlint 0。
- 无 `@deepseek-ai` / `@cat-cafe` 依赖。

## 提交
- 随 mgr PR 提交（B21 PR #202 之后）。