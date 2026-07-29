# setup 设置文档

> **目录作用**: 存放 FlowForge 安装配置指南，包括环境准备、依赖安装、Provider 配置、成员绑定、首次启动等部署相关文档
> **维护规则**: 新增设置文档时按 `{场景}-{slug}.md` 命名；截图与配置示例须脱敏，禁止泄露真实密钥/Token

---

## 文档清单

### 安装配置指南（待创建）

| 文档 | 名称 | 状态 |
|------|------|------|
| `quickstart.md` | 快速开始（5 分钟本地启动） | ⏳ |
| `environment.md` | 环境准备（Python 3.11+ / Node 18+ / SQLite） | ⏳ |
| `install-dependencies.md` | 依赖安装指南（pip + npm） | ⏳ |
| `provider-config.md` | Provider 配置（OpenRoute / Bailian / 自建模型） | ⏳ |
| `member-binding.md` | 成员绑定指南（账号 / 可进化智能体 / 群组） | ⏳ |
| `first-run.md` | 首次启动检查清单 | ⏳ |
| `troubleshooting.md` | 常见问题排查 | ⏳ |

### 截图资源（待补充）

| 资源 | 名称 | 状态 |
|------|------|------|
| `setup-member-binding.png` | 成员绑定截图 | ⏳ |
| `setup-provider-bailian.png` | Provider 配置截图 | ⏳ |

---

## 配置文件位置

| 配置 | 路径 | 说明 |
|------|------|------|
| 系统配置 | `flowforge/config/system.yaml` | 端口 / 路径 / 数据库 |
| 模型路由 | `flowforge/config/models.yaml` | LLM Provider 路由 |
| LLM 路由 | `flowforge/config/llm_route.yaml` | 模型选择策略 |
| 环境变量 | `.env` | 密钥 / Token（不提交到 Git） |

---

## 维护规则

- 设置文档须面向新手，提供完整可复制的命令与配置片段
- 截图统一存放于本目录，禁止外链外部图床
- 截图与配置示例必须脱敏，禁止出现真实 API Key / Token / 用户 ID（铁律 5：禁止硬编码密钥）
- 命令须同时支持 Linux / macOS（bash）与 Windows（PowerShell）两种环境
- 路径示例使用相对路径或占位符（如 `<repo-root>`），禁止硬编码绝对路径
- Provider 配置变更须同步更新 `flowforge/config/models.yaml` 与 `flowforge/config/llm_route.yaml` 注释
- 跨文档引用统一使用 `[doc:setup/xxx.md]` 格式

---

## 延伸阅读

- `[doc:SOP.md]` — 可进化智能体（Forgekin）协作标准操作规程
- `[doc:TIPS.md]` — 经验提示与陷阱清单
- `flowforge/config/system.yaml` — 系统配置文件
