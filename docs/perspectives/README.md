# FlowForge 视角文档

> **文档编号**: perspectives/README.md（v1.0）
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构
> **参考**: `[doc:clowder-ai/docs/perspectives/]` 目录结构

---

## 1. 用途

本目录存放不同视角的文档——同一系统从不同立场看到的视图。视角文档用于：
- 帮助不同角色（operator / 架构师 / 灵智体 / 三方厂商）理解 FlowForge
- 在架构决策时纳入多方视角（避免单一视角盲点）
- 在灵议 Mind Council 中作为各灵智体立场的载体

---

## 2. 文件清单

| 文件 | 视角 | 状态 |
|------|------|:----:|
| [README.md](README.md) | 视角文档导航（本文件） | ✅ v1.0 |
| [operator-vision.md](operator-vision.md) | operator 愿景视角（万物灵智体世界） | ⏳ Phase 0 |
| [architect-capability.md](architect-capability.md) | 架构师能力画像视角 | ⏳ Phase 1 |
| [forgekin-experience.md](forgekin-experience.md) | 灵智体第一人称体验 | ⏳ Phase 2 |
| [external-agent-vendor.md](external-agent-vendor.md) | 三方 Agent 厂商视角 | ⏳ Phase 3 |

---

## 3. 视角清单

### 3.1 operator 愿景视角

operator（用户）看到的 FlowForge：
- 万物灵智体世界（猫 + 桌椅 + 灯具 + 孙悟空 + 唐僧 协作）
- 通用 AGI 路径（物理 AI + 虚拟 AI + 混合 AI）
- 自我演进闭环（FlowForge 自己开发自己）

详见 `[doc:VISION.md]`。

### 3.2 架构师能力画像视角

架构师看到的 FlowForge：
- 七层架构 + forgemind 应用层
- CapabilityProfile + 动态路由
- Harness 七层 + Eval 自代谢
- 单向依赖铁律

详见 `[doc:architecture/README.md]`。

### 3.3 灵智体第一人称体验

灵智体看到的 FlowForge：
- "我"的身份（Forgekin ID + 形态 + 谱系）
- "我"的能力画像（必杀技 + 致命弱点）
- "我"的记忆（灵忆 EchoStore + 灵典 Mind Codex）
- "我"的协作伙伴（TeamAct + 伙伴系统数学）
- "我"的进化路径（觉醒阶 E1-E6 + 灵锻 SpiritForge）

### 3.4 三方 Agent 厂商视角

三方 Agent 厂商看到的 FlowForge：
- 接入协议（ExternalAgentAdapter）
- 能力画像融合机制
- 共享状态接口
- Fallback 链位置
- Eval 信号贡献

---

## 4. 视角使用场景

| 场景 | 使用视角 |
|------|---------|
| 架构决策 | 全部 4 个视角 |
| 灵议 Mind Council | 灵智体第一人称 + 三方厂商 |
| Bug 归因 | 架构师 + 灵智体第一人称 |
| 愿景修订 | operator 愿景 |
| 三方 Agent 接入 | 三方厂商 |

---

## 5. 视角更新规则

- 视角文档由对应角色 / 灵智体维护
- 视角冲突时通过灵议 Mind Council 解决（Phase 6）
- 视角不能违反 `[doc:VISION.md#7]` operator 愿景锚点
