## 第一部分：9大项目架构总览

### 1.1 项目生态架构

OpenClaw 生态采用**分层解耦架构**，分为三层：基础设施层、平台层、应用层。

```
┌─────────────────────────────────────────────────────────────────┐
│                    应用层 (Application Layer)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ ContentForge│  │  NovelForge  │  │  DevForge    │           │
│  │ (内容创作)   │  │  (小说创作)  │  │  (软件开发)   │           │
│  │ :8001/5175  │  │  :8003/5177  │  │  :8002/5176  │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  MallForge  │  │ StockForge   │  │   OpenClaw   │           │
│  │ (电商运营)   │  │ (股票分析)   │  │ (内容实例)   │           │
│  │ :8004/5178  │  │ :8005/5179   │  │  :800        │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 注册 Agent/Tool/Loop
┌──────────────────────────▼──────────────────────────────────────┐
│                    平台层 (Platform Layer)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  FlowForge (Agent 驾驭层 Harness Layer)                  │   │
│  │  • 9大执行模式 • Harness四根护栏 • Loop Engine           │   │
│  │  • ToolRegistry • AgentRegistry • MemoryManager         │   │
│  │  • EventBus • Helm交互 • Skill系统 • MCP集成            │   │
│  │  端口: 8000(后端) / 5174(前端)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  OpenSieve (超级RAG智能体平台)                           │   │
│  │  • 所有数据检索统一入口(结构化+非结构化)                  │   │
│  │  • DataSource协议(结构化) • SearchSource协议(非结构化)    │   │
│  │  • 爬虫框架 • 多源融合(RRF) • Native Agent              │   │
│  │  端口: 8100                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  OpenRoute (多模型LLM代理服务)                           │   │
│  │  • OpenAI API兼容 • 工具调用修正 • 上下文管理            │   │
│  │  • 7平台WebChat • 流式响应 • 模型路由                    │   │
│  │  端口: 13001                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    基础设施层 (Infrastructure)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   HiClaw    │  │  数据库集群   │  │  向量数据库   │           │
│  │ (主控框架)   │  │ (PostgreSQL) │  │ (Milvus等)   │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 9大项目职责与端口

| # | 项目 | 层级 | 职责 | 后端端口 | 前端端口 |
|---|------|------|------|:--------:|:--------:|
| 1 | **FlowForge** | 平台层 | Agent驾驭层平台，提供9大执行模式、Harness四根护栏、Loop引擎(Planner/Worker/Verifier/Reflector/Memory)、Plugin V2协议、SDK、DI容器、EventBus、Memory(5层)、Helm交互 | 8000 | 5174 |
| 2 | **OpenSieve** | 平台层 | 超级RAG智能体平台，**所有数据检索(结构化+非结构化)的统一入口**，DataSource协议管理结构化数据源，SearchSource协议处理非结构化检索，爬虫框架(Playwright反检测)，多源融合(RRF排序)，Native Agent | 8100 | - |
| 3 | **OpenRoute** | 平台层 | 多模型LLM代理服务，OpenAI API兼容接口，7平台WebChat浏览器自动化(豆包/Kimi/DeepSeek/通义/元宝/GLM/MiniMax)，工具调用修正(ToolParser)，上下文管理(向量库+去重)，流式响应 | 13001 | - |
| 4 | **ContentForge** | 应用层 | AI内容创作工厂，基于FlowForge，11个专家Agent，支持4平台发布(头条/公众号/百家号/知乎)，通过persona配置支持多种创作风格 | 8001 | 5175 |
| 5 | **DevForge** | 应用层 | AI软件开发工厂，基于FlowForge，14个业务Agent，IPD门禁系统，GoT架构设计，Multi-Agent辩论代码审查，金丝雀发布 | 8002 | 5176 |
| 6 | **NovelForge** | 应用层 | AI小说创作工厂，基于FlowForge，8大创作阶段，5层上下文管理(解决100万字超窗口)，SOUL风格参数，7道质量门，盲评+仲裁 | 8003 | 5177 |
| 7 | **MallForge** | 应用层 | AI电商运营工厂，基于FlowForge，6大核心Agent，多平台(TikTok/Amazon/Shopee)，纯YAML配置驱动，10个MCP Server规划 | 8004 | 5178 |
| 8 | **StockForge** | 应用层 | AI股票分析工厂，基于FlowForge，6大Agent(技术指标/预测/选股/多空辩论/风控/报告)，所有数据走OpenSieve，三源容错(Tushare/AkShare/BaoStock)，质量分阈值0.85 | 8005 | 5179 |
| 9 | **HiClaw** | 基础设施 | 主控框架，任务调度、测试脚本、实例安装模板、OpenRoute集成 | - | - |

### 1.3 openclaw_pkg 当前状态

> **重要变更 (2026-06-28)**：openclaw_pkg 中 education/life/student/novel/dev 实例已合并到 content 实例，**content 为唯一活跃的内容创作实例**。openclaw_pkg 定位为 OpenClaw 内容创作 AI 工具的工作空间，端口 800。

```
openclaw_pkg/
└── workspace/
    └── content/     # 综合内容创作（唯一活跃实例）
        ├── agents/main/
        │   ├── SOUL.md / MEMORY.md
        │   └── skills/article-orchestrator/
        │       ├── scripts/ (generation/workflow/platforms/prompts)
        │       └── data/    # 运行时数据（铁律T9）
        └── tmp/
```

### 1.4 目录结构约定

#### *Forge 项目标准目录（P8A铁律）

所有 *Forge 项目（ContentForge/DevForge/NovelForge/MallForge/StockForge）**只允许**以下6类目录：

```
*forge/
├── config/          # persona配置、loop模板、workflow YAML、prompts.yaml、agents.yaml、tools.yaml、plugins.yaml
├── web/             # 自定义业务UI（Next.js）
├── app/             # 适配Web的API端点（FastAPI）
├── plugins.py       # 插件注册入口（继承FlowForgePlugin）
├── docs/            # 文档（spec.md/arch.md/design.md/test.md/task.md）
└── tests/           # 测试代码（单元测试/集成测试/E2E测试）
```

**禁止出现**：
- ❌ 独立 Orchestrator 编排逻辑
- ❌ 独立 DI 容器组装
- ❌ 独立 Memory/Repository 层
- ❌ 独立 LLM 服务
- ❌ 独立数据库层
- ❌ 独立事件系统
- ❌ 独立状态管理
- ❌ 独立配置系统
- ❌ Agent 基类封装（如 ContentForgeAgent/BaseNovelAgent）
- ❌ 独立 SDK 封装（如 ContentForgeSDK）

> **tools/ 目录说明**：当前各 *Forge 项目仍保留 tools/ 目录（Python 工具实现），标注为"待迁移到 FlowForge 工具库"。后续迭代中应将 tools/ 内实现迁移到 config/tools/*.yaml 声明式配置，由 FlowForge 工具库统一提供能力。
>
> **mcp_server/ 目录说明**：NovelForge 的 mcp_server/ 是项目特有功能，保留。
>
> **agents/ 目录说明**：Agent 应通过 config/agents/*.yaml 声明，不允许保留 Python Agent 类实现目录。当前 MallForge 仍保留 agents/（Python 类继承 GenericAgent），因 config/agents/ 尚未建立 YAML 声明，暂标注为"待迁移"，后续迭代中应删除 agents/ 并改由 config/agents/*.yaml 声明。

#### HiClaw 目录

```
hiclaw/
├── tool/openroute/          # OpenRoute LLM代理服务
│   ├── app.py               # FastAPI主应用
│   ├── tool_parser.py       # 工具调用解析与修正
│   ├── context_manager.py   # 上下文管理
│   ├── command_handler.py   # 内置命令处理器
│   ├── web/                 # Next.js前端
│   └── docs/                # API_SPEC.md / task.md
├── tool/model_manager/      # 模型管理器
├── test/                    # 全流程测试脚本
├── install/agents_defaults/ # 新实例默认SOUL/MEMORY
├── rules.md                 # 本文档
├── prompts.md               # AI助手Prompt模板（最高优先级）
└── README.md
```

---

