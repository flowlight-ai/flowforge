# OpenClaw 智能内容创作平台

> 基于 OpenClaw 多智能体框架的全自动内容创作、发布与互动平台，集成 OpenSieve 知识检索、OpenRoute 零成本 LLM 代理、7 场景多平台内容编排能力。

## 目录

- [项目总览](#项目总览)
- [快速开始](#快速开始)
- [三大核心项目](#三大核心项目)
  - [1. OpenSieve - 知识检索引擎](#1-opensieve---知识检索引擎)
  - [2. HiClaw - 主控框架](#2-hiclaw---主控框架)
  - [3. Content 实例 - 内容创作引擎](#3-content-实例---内容创作引擎)
- [系统服务管理](#系统服务管理)
- [模型管理](#模型管理)
- [OpenRoute 代理服务](#openroute-代理服务)
- [测试脚本](#测试脚本)
- [QQ/微信机器人配置](#qq微信机器人配置)
- [浏览器与平台发布](#浏览器与平台发布)
- [常见问题](#常见问题)

---

## 项目总览

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    用户交互层                                 │
│   QQ机器人 / 微信机器人 / Web界面 / 定时任务                    │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│              Content 实例 (OpenClaw)                         │
│   Main Agent(内容总监) → exec → article-orchestrator 脚本     │
│                                       │                      │
│           ┌───────────────────────────┼──────────────────┐   │
│           │                           │                  │   │
│  ┌────────▼────────┐  ┌──────────────▼──────┐  ┌───────▼────┐│
│  │ 7场景创作引擎    │  │ 多平台发布/互动      │  │ 系列文章    ││
│  │ education/life/ │  │ 头条/微信/知乎/     │  │ 大纲→审核   ││
│  │ novel/dev/      │  │ 小红书/B站/百家号   │  │ →逐集创作   ││
│  │ student/content │  │ /抖音/快手          │  │ →补发/重写  ││
│  │ /general        │  │                     │  │             ││
│  └────────┬────────┘  └─────────────────────┘  └─────────────┘│
│           │                                                  │
└───────────┼──────────────────────────────────────────────────┘
            │
   ┌────────▼────────────────────────────────────────┐
   │            LLM 调用层                            │
   │  OpenRoute 代理 (13001) ← 7个网页版聊天平台      │
   │  OpenRouter API ← 海外免费模型                    │
   │  Ollama 本地 (11434) ← qwen2.5:7b               │
   │  火山引擎/阿里云/腾讯云 ← 付费 API                │
   └────────┬────────────────────────────────────────┘
            │
   ┌────────▼────────────────────────────────────────┐
   │          OpenSieve 知识检索 (8100)                │
   │  9+搜索引擎并发 → 四库混合检索 → 智能排序         │
   │  Milvus向量 + ES全文 + Neo4j图谱 + PG关系        │
   └─────────────────────────────────────────────────┘
```

### 核心能力

| 能力 | 说明 |
|------|------|
| **零成本 LLM** | 通过浏览器自动化操控豆包/Kimi/DeepSeek/千问/元宝/GLM/MiniMax 7个网页版聊天，完全免费 |
| **7场景创作** | education/life/novel/dev/student/content/general，每个场景有独立的提示词、写法、爆款类型 |
| **多平台发布** | 今日头条、微信公众号（已启用）；知乎/百家号/小红书/B站/抖音/快手/微信视频号（待扩展） |
| **多平台互动** | 自动浏览推荐、点赞、评论、回复评论（头条/知乎/小红书/B站/百家号） |
| **系列连载** | 大纲规划→审核→逐集创作→补发/重写，支持最多20集 |
| **每日47篇** | 6个场景定时任务错峰执行，每日自动创作约47篇文章 |
| **知识检索** | OpenSieve 9+搜索引擎并发、四库混合检索、智能排序管线 |
| **模型管理** | 10个供应商自动获取、能力评分排序、差异化分配、自动修复 |

### 目录结构

```
/home/hyg/ai/openclaw/
├── opensieve/                    # OpenSieve 知识检索引擎
│   ├── api/                     # FastAPI 后端
│   ├── frontend/                # Next.js 前端
│   ├── monitoring/              # Prometheus + Grafana 监控
│   ├── scripts/                 # 工具脚本
│   ├── searxng/                 # SearXNG 元搜索配置
│   ├── docker-compose.yml       # Docker Compose 编排
│   ├── quickstart.sh            # 一键启动脚本
│   └── opensieve.service         # systemd 服务文件
├── hiclaw/                      # 平台工具集
│   ├── install/                 # 安装部署模块
│   ├── tool/
│   │   ├── model_manager/       # 模型管理工具
│   │   └── openroute/           # OpenRoute LLM 代理服务
│   ├── test/                    # 测试脚本
│   └── docs/                    # 项目文档
└── openclaw_pkg/
    └── workspace/
        └── content/             # Content 实例（核心创作引擎）
            ├── .openclaw/       # OpenClaw 配置
            │   └── cron/jobs.json  # 定时任务
            └── agents/main/
                ├── agent.json   # Agent 配置
                ├── MEMORY.md    # 核心记忆
                ├── TOOLS.md     # 工具文档
                └── skills/
                    └── article-orchestrator/  # 文章创作编排技能
                        ├── tools.json         # 技能工具定义
                        └── scripts/
                            ├── main.py        # 主入口
                            ├── config/
                            │   ├── scenarios/ # 7个场景配置
                            │   └── browser_config.json
                            └── prompts/       # 提示词模板
```

---

## 快速开始

### 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | OpenClaw 运行时 |
| Python | 3.10+ | 脚本和工具 |
| Docker | 24+ | OpenSieve 服务编排 |
| Chromium | 最新 | 浏览器自动化（发布/互动） |
| Playwright | 最新 | 浏览器自动化框架 |

### 一键安装

```bash
cd /home/hyg/ai/openclaw/hiclaw/install

# 1. 配置 API 密钥
cp key_template.json key.json
# 编辑 key.json 填入各平台 API Key

# 2. 运行安装脚本
chmod +x install_openclaw.sh
./install_openclaw.sh

# 3. 启动 content 实例
cd /home/hyg/ai/openclaw/openclaw_pkg
./run_content.sh
```

### 启动所有服务

```bash
# 1. 启动 OpenSieve（知识检索）
cd /home/hyg/ai/openclaw/opensieve
./quickstart.sh start

# 2. 启动 OpenRoute（LLM 代理）
systemctl --user start hiclaw-openroute.service

# 3. 启动 Content 实例（创作引擎）
cd /home/hyg/ai/openclaw/openclaw_pkg
./run_content.sh
```

### 验证服务

```bash
# OpenSieve 健康检查
curl http://localhost:8100/health | jq

# OpenRoute 模型列表
curl http://localhost:13001/v1/models

# Content 实例网关
curl http://localhost:19701/health
```

---

## 三大核心项目

### 1. OpenSieve - 知识检索引擎

OpenSieve 是企业级检索增强生成系统，核心能力是从海量互联网信息中精准筛选高价值内容。

#### 服务组成

| 服务 | 端口 | 功能 |
|------|------|------|
| API 后端 | 8100 | FastAPI 检索/索引/抓取接口 |
| Web 前端 | 3000 | Next.js 检索界面 |
| Milvus | 19530 | 向量数据库 |
| Elasticsearch | 9200 | 全文检索 |
| Neo4j | 7474/7687 | 知识图谱 |
| PostgreSQL | 5433 | 关系数据库（含 pgvector） |
| Redis | 6379 | 缓存 + 队列 |
| SearXNG | 8888 | 元搜索引擎 |
| MinIO | 9000/9001 | 对象存储 |
| Prometheus | 9090 | 监控指标采集 |
| Grafana | 3001 | 监控面板 |

#### 核心 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/retrieve` | POST | 混合检索主接口 |
| `/api/scrape` | POST | 素材下载（抓取URL全文+图片） |
| `/api/v1/index` | POST | 文档索引（ES+PG双写） |
| `/api/v1/graph/build` | POST | 知识图谱构建 |
| `/health` | GET | 健康检查 |
| `/api/v1/stats` | GET | 检索统计 |

检索请求示例：
```bash
curl -X POST http://localhost:8100/api/v1/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "武汉樱花", "max_results": 5}' | jq
```

#### 启动与管理

```bash
cd /home/hyg/ai/openclaw/opensieve

# 一键启动
./quickstart.sh start

# 其他命令
./quickstart.sh status     # 查看状态
./quickstart.sh logs       # 查看日志
./quickstart.sh stop       # 停止服务
./quickstart.sh restart    # 重启服务
./quickstart.sh clean      # 清理容器和卷
./quickstart.sh build      # 重新构建API镜像
./quickstart.sh ensure     # 一键确保全部组件就绪
```

也可使用 Make 命令：`make up/down/build/test/logs/shell/ps/restart/clean/purge`

#### 检索管线

```
用户查询
  ├── 第1轮: Bing中国 + Bing API + 搜狗/360
  ├── 第2轮: 头条 + 微博 + 微信
  ├── 第3轮: 知乎 + SearXNG + Wikipedia
  │   (自适应终止: 已有>=10条结果则跳过后续)
  ├── ES 已索引文档检索 (jieba分词 + BM25)
  ├── Milvus 向量检索 (BGE-M3)
  ├── 评分排序: 内容质量 + 时间衰减 + 关键词匹配 + Cross-Encoder精排
  ├── URL + SimHash 去重
  └── MMR 多样性重排 → 自动索引写入ES(正向循环)
```

#### 访问地址

| 服务 | 地址 | 凭据 |
|------|------|------|
| API 文档 | http://localhost:8100/docs | - |
| Web 前端 | http://localhost:3000 | - |
| Neo4j Browser | http://localhost:7474 | neo4j / opensieve2026 |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| Grafana | http://localhost:3001 | admin / opensieve2026 |

---

### 2. HiClaw - 主控框架

HiClaw 是整个平台的基础设施层，包含安装部署、模型管理、LLM代理（OpenRoute）等核心模块。作为 9 大项目生态的主控框架，负责任务调度、测试脚本、实例安装模板、OpenRoute 集成。

#### 目录结构

```
hiclaw/
├── install/                     # 安装部署模块
│   ├── install.js               # Node.js 跨平台核心安装器
│   ├── install_openclaw.sh      # Linux 安装脚本
│   ├── install_openclaw.bat     # Windows 安装脚本
│   ├── openclaw.json            # OpenClaw 配置模板
│   ├── agents.json              # 实例与子智能体定义
│   ├── key.json                 # API 密钥配置
│   └── extensions/              # 插件扩展
│       ├── openclaw-qqbot/      # QQ 机器人插件
│       └── openclaw-weixin/     # 微信机器人插件
├── tool/
│   ├── model_manager/           # 模型管理工具
│   │   ├── fetch_models.py      # 从10个供应商获取模型
│   │   ├── merge_to_openclaw.py # 合并模型配置到OpenClaw
│   │   ├── model_assignment.json# 差异化模型分配
│   │   ├── auto_fix_models.py   # 自动修复不可用模型
│   │   └── ...
│   └── openroute/               # OpenRoute LLM 代理服务
│       ├── app.py               # FastAPI 主程序
│       ├── router/              # 三层路由
│       ├── channel/             # WebChat + API 通道
│       ├── pipeline/            # 3种调用管线
│       ├── config/              # 路由和供应商配置
│       └── web/                 # Next.js 管理界面
├── test/                        # 测试脚本（见测试章节）
└── docs/                        # 项目文档
```

#### 安装部署

**实例定义**（当前仅 content 实例活跃，其他实例已合并到 content 中）：

| 实例名 | 端口 | 子智能体 | 用途 |
|--------|------|----------|------|
| content | 19701 | main, trend, creator, polisher, fact-check, publisher | 内容创作（唯一活跃实例） |

> **重要（2026-06-28）**：education/life/student/novel/dev 实例已合并到 content 实例，content 为唯一活跃的内容创作实例。不再使用 6 实例架构。

**安装步骤**：

```bash
# 1. 配置密钥
cd /home/hyg/ai/openclaw/hiclaw/install
cp key_template.json key.json
# 编辑 key.json 填入各平台 API Key

# 2. 运行安装脚本
# Linux:
chmod +x install_openclaw.sh
./install_openclaw.sh
# Windows:
install_openclaw.bat

# 3. 安装器自动完成：
# - 创建 openclaw_pkg/ 目录
# - 为每个实例生成独立配置、启动器、启动脚本
# - 注入 API 密钥
# - 创建子智能体工作区
# - 生成 run_all.sh 一键启动脚本
# - 生成 update_model.py 模型更新脚本

# 4. 启动实例
cd /home/hyg/ai/openclaw/openclaw_pkg
./run_content.sh              # 单独启动 content
./run_all.sh                  # 一键启动所有实例
./run_content.sh --no-browser # 不打开浏览器
```

**OpenClaw 本地安装**（当 npm install 失败时）：

```bash
# 卸载旧版本
npm uninstall -g openclaw

# 源码编译安装
cd openclaw_pkg/app
npm install --production
npm run build

# 验证
openclaw --version

# 启动网关
openclaw gateway
```

**常用 OpenClaw 命令**：

```bash
openclaw gateway start       # 以服务方式启动
openclaw gateway stop        # 停止网关
openclaw gateway restart     # 重启网关
openclaw channels list       # 查看通道列表
openclaw models status       # 查看模型状态
openclaw doctor              # 诊断问题
openclaw sessions cleanup --enforce  # 清理会话
```

---

### 3. Content 实例 - 内容创作引擎

Content 实例是整个平台的核心，通过 article-orchestrator 技能实现全流程自动化内容创作。

#### Agent 配置

| Agent | 角色 | 模型 | 说明 |
|-------|------|------|------|
| **main** | 内容总监小创 | openroute/Kimi-K2.6 | 主控Agent，通过exec调用脚本 |
| trend | 趋势分析 | openroute/DeepSeek-V4-Pro | 已被脚本替代，禁止调用 |
| creator | 内容创作 | openroute/Kimi-K2.6 | 已被脚本替代，禁止调用 |
| polisher | 文章润色 | openroute/DeepSeek-V4-Pro | 已被脚本替代，禁止调用 |
| fact-check | 事实核查 | openroute/DeepSeek-V4-Pro | 已被脚本替代，禁止调用 |
| publisher | 内容发布 | openroute/Doubao-Seed2.0 | 已被脚本替代，禁止调用 |

> **核心规则**：Main Agent 的唯一动作是通过 `exec` 执行 article-orchestrator 脚本，禁止自行搜索/写文章/发布，禁止使用子Agent。

#### 场景体系

Content 实例支持 7 种创作场景，每种场景有独立的提示词、写法体系、爆款类型和领域关键词：

| 场景 | 参数 | 身份定位 | 字数范围 | 领域关键词数 |
|------|------|----------|----------|-------------|
| 教育 | `--scenario education` | 教育政策观察者 | 1500-5000 | 50词(3大类) |
| 生活 | `--scenario life` | 生活观察者 | 500-1500 | 97词(8大类) |
| 小说 | `--scenario novel` | 小说故事讲述者 | 300-500 | 64词(4大类) |
| AI科技 | `--scenario dev` | 科技前沿观察者 | 300-500 | 75词(5大类) |
| 学习 | `--scenario student` | 学习方法研究者 | 1000-2000 | 63词(4大类) |
| 内容 | `--scenario content` | 热点内容创作者 | 800-3000 | 64词(6大类) |
| 乡村田园 | `--scenario countryside` | 乡村田园生活创作者 | 500-2000 | 三农/田园/乡村美食 |
| 通用 | `--scenario general` | 专业内容创作者 | 800-3000 | 通用 |

**场景选择规则**（Main Agent 自动匹配）：

| 关键词 | 场景 |
|--------|------|
| 教育/升学/中考/高考/学区/补课/双减 | education |
| 健康/美食/旅行/家居/养生/减肥 | life |
| 小说/故事/连载/章节 | novel |
| 编程/代码/AI技术/开发/程序员 | dev |
| 考试/校园/学生/成长/考研 | student |
| 乡村/田园/三农/农村/种地/养殖/农家/返乡 | countryside |
| 热点/评论/社会/观点 | content |
| 无法判断 | general |

#### 创作命令

```bash
SKILL_ROOT=/home/hyg/ai/openclaw/openclaw_pkg/workspace/content/agents/main/skills/article-orchestrator
PYTHON=$SKILL_ROOT/venv/bin/python3
SCRIPT=$SKILL_ROOT/scripts/main.py

# 单篇创作（指定选题）
$PYTHON $SCRIPT --topic '{"title":"AI医疗","angle":"技术突破"}' --platforms toutiao --scenario education

# 批量创作（自动选题）
$PYTHON $SCRIPT --count 5 --batch morning --platforms toutiao --scenario education

# 多平台发布
$PYTHON $SCRIPT --count 3 --platforms toutiao,wechat --scenario life

# 正式发布（默认仅草稿）
$PYTHON $SCRIPT --count 1 --platforms toutiao --scenario content --publish

# 强制刷新热榜缓存
$PYTHON $SCRIPT --count 5 --force-refresh --scenario education

# 查看可用场景
$PYTHON $SCRIPT --list-scenarios
```

#### 完整创作流程

```
1. 场景检测/匹配 → 根据关键词自动匹配或手动指定
2. 加载场景配置 → 提示词、视角、结构、字数等
3. 热榜采集 → 6大平台热榜聚合（微博/百度/头条/知乎/抖音/小红书）
4. 选题生成 → LLM生成搜索关键字 + 热榜选题
5. 素材搜索 → Tavily API 搜索相关素材（自动去重）
6. 文章生成 → Creator模型 + 场景特定提示词
7. 文章润色 → Polisher模型润色
8. 引用核查 → 检查引用链接有效性
9. 去重检查 → 与历史发布内容比对（阈值0.8）
10. 封面图片 → 自动搜索下载封面图
11. 平台发布 → 调用对应平台发布器
```

#### 系列文章创作

系列功能支持大纲规划→审核→逐集创作的完整工作流：

```
plan(生成大纲) → revise(修改大纲，可多次) → start(审核通过，开始创作)
→ continue(逐集创作) → completed(全部完成)
```

```bash
# 生成大纲
$PYTHON $SCRIPT --series --action plan --topic 'AI改变教育' --episodes 5 --scenario novel

# 修改大纲
$PYTHON $SCRIPT --series --action revise --series-id 1 --revision '第3集改为家长视角' --scenario novel

# 审核通过，开始创作
$PYTHON $SCRIPT --series --action start --series-id 1 --platforms toutiao --scenario novel

# 继续创作下一集
$PYTHON $SCRIPT --series --action continue --series-id 1 --scenario novel

# 重新创作某集
$PYTHON $SCRIPT --series --action recreate --series-id 1 --episode 3 --scenario novel

# 补发某集
$PYTHON $SCRIPT --series --action republish --series-id 1 --episode 5 --platforms toutiao --scenario novel

# 查看大纲/状态
$PYTHON $SCRIPT --series --action show --series-id 1 --scenario novel
$PYTHON $SCRIPT --series --action status --series-id 1 --scenario novel
```

在 OpenClaw 中对 Agent 说：
- "帮我规划一个系列，话题是XXX" → 触发 plan
- "第3集的角度改一下" → 触发 revise
- "大纲没问题，开始创作吧" → 触发 start
- "继续写下一集" → 触发 continue
- "第5集写得不好，重写" → 触发 recreate
- "第3集没发出去，补发" → 触发 republish

#### 平台互动

支持自动浏览推荐、点赞、评论和回复评论：

```bash
# 头条批量评论（评论3篇，评论阈值<10）
$PYTHON $SCRIPT --interact --interact-platform toutiao --interact-count 3 --interact-threshold 10 --scenario content

# 头条评论回复（回复我的文章收到的评论）
$PYTHON $SCRIPT --reply --interact-platform toutiao --reply-count 10 --scenario content

# 其他平台互动
$PYTHON $SCRIPT --interact --interact-platform zhihu --interact-count 3 --scenario content
$PYTHON $SCRIPT --interact --interact-platform xiaohongshu --interact-count 3 --scenario content
$PYTHON $SCRIPT --interact --interact-platform bilibili --interact-count 3 --scenario content
$PYTHON $SCRIPT --interact --interact-platform baijiahao --interact-count 3 --scenario content
```

#### 定时任务

Content 实例配置了 21 个定时任务，每日自动创作约 47 篇文章+互动：

| 场景 | 文章 | 微头条 | 系列 | 互动 |
|------|------|--------|------|------|
| education | 5篇(00:30) | 5条(01:00) | 20集(周一20:00) | - |
| student | 5篇(01:30) | 5条(02:00) | 20集(周二20:00) | - |
| life | 5篇(02:30) | 5条(03:00) | 20集(周三20:00) | - |
| novel | 3篇(03:30) | 3条(04:00) | 20集(周四20:00) | - |
| dev | 5篇(04:30) | 5条(05:00) | 20集(周五20:00) | - |
| content | 5篇(05:30) | 5条(06:00) | 20集(周六20:00) | - |
| 互动 | - | - | - | 评论3条(12:30)+回复3条(13:00) |
| **总计** | **28篇** | **28条** | **6×20集** | **评论+回复遍历所有账户** |

每个定时任务执行流程：触发→QQ通知→执行脚本→QQ汇报结果→出错也QQ通知

定时任务配置文件：`/home/hyg/ai/openclaw/openclaw_pkg/workspace/content/.openclaw/cron/jobs.json`

#### 平台支持

**已启用平台**：

| 平台 | 参数 | 编辑器类型 | 账号配置 |
|------|------|-----------|----------|
| 今日头条 | toutiao | ProseMirror | 账号1 + 账号2 |
| 微信公众号 | wechat | UEditor | 账号2 |

**互动平台**：

| 平台 | 参数 | 状态 |
|------|------|------|
| 今日头条 | toutiao | 已支持 |
| 知乎 | zhihu | 已支持 |
| 小红书 | xiaohongshu | 已支持 |
| B站 | bilibili | 已支持 |
| 百家号 | baijiahao | 已支持 |

**待扩展平台**：百家号(baijiahao)、知乎(zhihu)、小红书(xiaohongshu)、B站(bilibili)、抖音(douyin)、快手(kuaishou)、微信视频号(wechat_video) — 配置已占位

#### 合规红线

- 账号定位为"个人观点分享"，不是新闻媒体
- 不得以"报道""新闻""快讯"方式呈现
- 不得抢发时政类突发新闻
- 禁用词：报道/快讯/突发/最新消息/中央/国务院/权威发布等
- 安全选题：社会民生/文化评论/科技+社会交叉/热点复盘/观点分享
- 危险选题（必须回避）：政治/军事/外交/突发事件/涉密

#### 去AI味核心法则

- 禁止模板化开头（"近年来""随着社会的发展"）
- 禁止套话和废话（"不可否认""综上所述"）
- 文章必须包含至少2个具体人物
- 用故事代替说教，口语化表达
- 段落不超过3-4行
- 禁止幻觉和编造
- 禁止出现2026年以前的时间内容

---

## 系统服务管理

所有服务均配置为 systemd 用户级服务，存放在 `~/.config/systemd/user/` 目录下。

### 服务列表

| 服务名 | 说明 | 端口 |
|--------|------|------|
| hiclaw-openroute | OpenRoute LLM 代理 | 13001 |
| opensieve | OpenSieve 知识检索 | 8100 |
| chromium-debug | Chromium 远程调试模式 | 9222/9223/9225 |
| mitmweb | 抓包代理 | 8081 |

### 常用命令

```bash
# 重新加载配置
systemctl --user daemon-reload

# 启用开机自启
systemctl --user enable <服务名>

# 启动/停止/重启
systemctl --user start <服务名>
systemctl --user stop <服务名>
systemctl --user restart <服务名>

# 查看状态
systemctl --user status <服务名>

# 查看实时日志
journalctl --user -u <服务名> -f

# 检查是否开机自启
systemctl --user is-enabled <服务名>

# 禁用开机自启
systemctl --user disable <服务名>
```

### OpenRoute 服务

```bash
# 启动
systemctl --user start hiclaw-openroute.service

# 查看状态
systemctl --user status hiclaw-openroute.service

# 查看日志
journalctl --user -u hiclaw-openroute.service -f

# 验证
curl http://127.0.0.1:13001/v1/models
```

### OpenSieve 服务

```bash
# 启动
systemctl --user start opensieve.service

# 或使用 quickstart.sh
cd /home/hyg/ai/openclaw/opensieve
./quickstart.sh start
./quickstart.sh status
./quickstart.sh logs
./quickstart.sh stop
```

### Chromium 远程调试（Ubuntu下发布必需）

```bash
# 手动启动（账号1）
chromium --remote-debugging-port=9222 \
  --user-data-dir=/home/hyg/snap/chromium/common/chromium/Default

# 或使用 systemd 服务
systemctl --user start chromium-debug.service
```

> **注意**：Ubuntu 下头条发布必须复用真实用户浏览器（CDP连接模式），Win11 下可直接使用自动化浏览器。

### Ollama 本地模型

```bash
# 启动 Ollama 服务
sudo systemctl start ollama

# 运行模型
ollama run qwen2.5:7b-instruct-q4_K_M

# 验证
curl http://127.0.0.1:11434/api/tags

# 关闭思考模式
ollama run qwen3.5:2b --think=false
```

---

## 模型管理

### 供应商覆盖

系统支持 10 个 LLM 供应商：

| 供应商 | 类型 | 说明 |
|--------|------|------|
| openroute | 自建代理 | OpenRoute 网页版代理（7个平台） |
| openrouter | 第三方 | OpenRouter API（聚合多模型） |
| ollama | 本地 | 本地 Ollama 运行的模型 |
| aliyuncs | 第三方 | 阿里云通义千问 |
| ark | 第三方 | 火山引擎豆包 |
| arkcode | 第三方 | 火山引擎豆包代码版 |
| siliconflow | 第三方 | SiliconFlow |
| kimi | 第三方 | 月之暗面 Kimi |
| zhipu | 第三方 | 智谱 AI |
| tencent | 第三方 | 腾讯混元 |

### 模型获取与更新

```bash
cd /home/hyg/ai/openclaw/hiclaw/tool/model_manager

# 获取模型列表（从10个供应商）
python3 fetch_models.py

# 快速模式（每个供应商只取前3个最强模型）
python3 fetch_models.py --quick

# 合并模型配置到 OpenClaw 实例
python3 merge_to_openclaw.py

# 查看不可用模型
python3 model_health_checker.py --list-unstable

# 强制刷新健康状态
python3 model_health_checker.py --force
```

### 差异化模型分配

`model_assignment.json` 支持每个实例和每个子智能体独立配置模型：

| 实例 | 主模型 | 创作模型 | 润色模型 |
|------|--------|----------|----------|
| content | Kimi-K2.6 | Kimi-K2.6 | DeepSeek-V4-Pro |

支持两种模式：
- **auto**：系统自动选择最优模型（推荐）
- **fixed**：用户指定 primary + fallbacks，系统校验可用性并智能降级

### 自动修复机制

```bash
# 手动修复指定实例
python3 auto_fix_models.py --project-root /home/hyg/ai/openclaw --instance content

# 修复所有实例
python3 auto_fix_models.py --project-root /home/hyg/ai/openclaw --all

# 定时任务（crontab -e）
*/5 * * * * cd /home/hyg/ai/openclaw/hiclaw/tool/model_manager && /usr/bin/python3 auto_fix_models.py --project-root /home/hyg/ai/openclaw --all >> /home/hyg/ai/openclaw/logs/auto_fixer_cron.log 2>&1
```

### 实例管理

```bash
cd /home/hyg/ai/openclaw/hiclaw/tool/model_manager

# 查询运行中的实例
python3 check_instances.py

# 停止单个实例
python3 stop_instances.py --instance content

# 停止所有实例
python3 stop_instances.py --all

# 清理子智能体缓存
python3 clean_agent_cache.py
```

### 模型评分维度

merge_to_openclaw.py 实现了多维度评分系统：

| 维度 | 说明 | 权重示例 |
|------|------|----------|
| 供应商等级 | anthropic/openai=100, deepseek=95, tencent=60 | 高 |
| 模型系列 | claude=95, gpt-5=95, deepseek-r2=90, qwen-3=75 | 高 |
| 模型家族 | opus=100, pro=85, flash=55, lite=35 | 中 |
| 参数规模 | 1000B=60, 70B=30, 7B=5 | 中 |
| 上下文长度 | 1M+=30, 200K+=20, 128K+=15 | 低 |
| 新鲜度 | 30天内+20, 90天内+15 | 低 |
| 免费模型 | -15（降权） | 惩罚 |
| Web模型 | doubao-web=80, kimi-web=75, deepseek-web=70 | 加权 |

---

## OpenRoute 代理服务

OpenRoute 是自建的 LLM 代理网关，通过浏览器自动化操控7个网页版聊天平台，实现零成本使用大模型。

### 架构

```
请求 → 消息拦截层 → 模型路由层(v3) → 场景路由层 → LLM调用管线 → 响应
                                                    │
                                              ┌─────┴─────┐
                                              │           │
                                         Web Chat    API Forward
                                         (网页版)    (三方API)
```

### 两层模型路由

**第一层**（用户可见）：12个简洁模型名 + auto

| 模型名 | 类别 | 后端数 |
|--------|------|--------|
| Doubao-Seed2.0 | domestic | 1 |
| DeepSeek-V4-Pro | domestic | 1 |
| Kimi-K2.6 | domestic | 2 |
| Qwen3.6-Plus | domestic | 3 |
| HunYuan3 | domestic | 1 |
| GLM-5.1 | domestic | 2 |
| MiniMax-M3 | domestic | 2 |
| GPT-5.5 | international | 2 |
| Claude-4.8-Sonnet | international | 1 |
| Gemini-3.3-Pro | international | 2 |
| free | free | 7 |
| proxy | proxy | 7 |

**第二层**（内部后端）：每个外部模型对应多个内部模型，按能力排序，WebChat 优先、API 兜底。

### 三种场景

| 场景 | Prompt组合方 | LLM通道 | 适用条件 |
|------|-------------|---------|----------|
| 场景1 | Proxy组合 | WebChat或API | OpenClaw等需完整上下文管理 |
| 场景2 | 业务调用方组合 | WebChat或API | Claude Code/curl等已组合Prompt |
| 场景3 | 三方LLM透传 | API Forward | 标准 API 调用 |

### 7个网页版平台

| 平台 | WebChat策略 | Web API策略 |
|------|-------------|-------------|
| 豆包 | DOM轮询等待回复 | 页面内fetch API调用 |
| Kimi | DOM轮询 | 发送+拦截，gRPC帧解析 |
| DeepSeek | DOM轮询 | PoW挑战 + fetch API |
| 千问 | DOM轮询 | 发送+拦截SSE |
| 元宝 | DOM轮询 | fetch API + SSE |
| GLM | DOM轮询 | fetch API |
| MiniMax | DOM轮询 | fetch API |

### 降级策略

| 触发条件 | 降级动作 |
|----------|----------|
| API超时(>30s) | 场景1(API)→场景1(WebChat)；场景3→场景2 |
| API 401/403 | 熔断器标记不可用，降级到WebChat |
| API 429 | 等待retry-after重试，仍失败→降级WebChat |
| WebChat审核拦截 | 加强脱敏重试→纯文本降级 |
| 浏览器不可用 | 降级到API-only模式 |

### 部署

```bash
cd /home/hyg/ai/openclaw/hiclaw/tool/openroute

# 安装依赖
pip install -r requirements.txt
playwright install chromium

# 首次登录（持久化会话）
./run.sh

# 配置为 systemd 服务
systemctl --user enable hiclaw-openroute.service
systemctl --user restart hiclaw-openroute.service
systemctl --user status hiclaw-openroute.service

systemctl --user restart contentforge.service
systemctl --user enable contentforge.service
systemctl --user status contentforge.service

systemctl --user enable opensieve.service
systemctl --user restart opensieve.service
```

---

## 测试脚本

所有测试脚本位于 `/home/hyg/ai/openclaw/hiclaw/test/`，统一使用 content 实例，通过 `--scenario` 参数切换场景。

### 测试脚本清单

| 脚本 | 功能 | 用法示例 |
|------|------|----------|
| test_full_pipeline.py | 全流程发布测试 | `--scenario education --platform toutiao --count 1` |
| test_article_e2e.py | LLM端到端测试 | `--scenario content` |
| test_material_fetcher.py | 检索/选题/素材测试 | `--scenario education --test all` |
| test_series_e2e.py | 系列文章编排测试 | `--scenario novel --action plan --episodes 5` |
| test_interact.py | 多平台互动测试 | `--scenario all --platform toutiao --count 3`（`--cleanup`清理收藏+关注） |
| test_publish.py | 发布功能测试 | `--scenario education --platform toutiao` |
| test_weitoutiao.py | 微头条/头条视频测试 | `--scenario content`（默认图文）`--mode video`（视频） |
| test_video_e2e.py | 视频生成端到端测试 | `--scenario content` |
| test_cron_jobs.py | 定时任务验证脚本 | `--dry-run`（验证命令语法+导入链） |
| test_doubao_proxy.py | 豆包代理服务测试 | `--mode direct` |
| test_openroute_quick.py | OpenRoute快速验证 | `--model Doubao-Seed2.0` |
| test_cf_api_quick.py | ContentForge API测试 | `--intent short` |
| test_multi_llm.py | 多LLM并发测试 | `--count 5` |
| test_opensieve.py | OpenSieve知识检索测试 | `--base-url http://localhost:8100` |
| test_ha.py | 高可用/删除对话测试 | `api 5 Doubao-Seed2.0` |
| test_clear_cache.py | 清空数据库缓存 | `--scenario education --tables all` |
| test_file_cleanup.py | 文件清理 | `--scenario all --days 7` |

### 常用测试命令

```bash
cd /home/hyg/ai/openclaw/hiclaw/test

# === 文章创作（按场景自动选题） ===
# 头条1篇（自动选题+素材+创作+润色+图片+发布到所有账户）
python3 test_full_pipeline.py --scenario countryside --platform toutiao --count 1

# 微信2篇
python3 test_full_pipeline.py --scenario life --platform wechat --count 2

# === 定时任务验证 ===
# 验证所有定时任务的命令语法+导入链（不实际执行创作）
python3 test_cron_jobs.py --dry-run

# 快速验证（只检查文件和参数）
python3 test_cron_jobs.py --quick

# 列出所有任务
python3 test_cron_jobs.py --list

# 验证并执行指定任务
python3 test_cron_jobs.py --job education_article

# === 微头条（默认图文模式，按场景自动选题） ===
# 微头条图文（默认模式）
python3 test_weitoutiao.py --scenario content

# 微头条纯文字
python3 test_weitoutiao.py --scenario content --mode text

# 微头条视频
python3 test_weitoutiao.py --scenario content --mode video

# 头条视频发布
python3 test_weitoutiao.py --scenario content --mode toutiao-video

# 指定选题（跳过自动选题）
python3 test_weitoutiao.py --scenario content --topic 'AI改变教育'

# === 视频创作（按场景自动选题+素材+创作+润色+视频生成+发布） ===
python3 test_video_e2e.py --scenario content

# 指定选题
python3 test_video_e2e.py --scenario content --topic 'AI改变教育'

# === 系列文章 ===
# 生成大纲（不指定topic则按场景自动选题）
python3 test_series_e2e.py --scenario novel --action plan --episodes 5
python3 test_series_e2e.py --scenario novel --action plan --topic 'AI改变教育' --episodes 5

# 审核通过，开始创作
python3 test_series_e2e.py --scenario novel --action start --latest

# === 评论/回复（不指定账户则遍历所有账户） ===
# 遍历所有场景的所有账户
python3 test_interact.py --scenario all --platform toutiao --count 3

# 遍历content场景的所有账户
python3 test_interact.py --scenario content --platform toutiao --count 3

# 指定单个账户
python3 test_interact.py --scenario content --platform toutiao --count 3 --account 问题不大

# 评论回复（不指定账户则遍历所有账户）
python3 test_interact.py --scenario content --platform toutiao --reply --max-replies 10

# 指定账户回复
python3 test_interact.py --scenario content --platform toutiao --reply --max-replies 10 --account 小布头来啦

# 用"小布头来啦"账户，给配置中其他账户（问题不大、旅食手记、AI硬核指南）的文章点赞+评论
python3 test_interact.py --scenario content --platform toutiao --fans --account 小布头来啦

# 自定义参数：每人最多3篇，总共最多10篇
python3 test_interact.py --scenario content --platform toutiao --fans --account 小布头来啦 --max-fans-per 3 --max-fans-total 10

# 用"问题不大"账户
python3 test_interact.py --scenario content --platform toutiao --fans --account 问题不大 --cleanup

# 遍历所有配置的头条账户（小布头来啦、问题不大、...）
python3 test_interact.py --scenario content --platform toutiao --fans

# === 清理模式（取消收藏+取消关注） ===
# 指定账户清理：取消所有文章收藏 + 取消关注（粉丝<30万的非活跃账户保留关注）
python3 test_interact.py --scenario content --platform toutiao --cleanup --account 问题不大

python3 test_interact.py --platform toutiao --count 3 --cleanup --account 问题不大

# 遍历所有账户清理
python3 test_interact.py --scenario content --platform toutiao --cleanup

# === 检索/选题/素材测试 ===
python3 test_material_fetcher.py --scenario education --test all
python3 test_material_fetcher.py --scenario education --test topic --count 30

# === 发布测试 ===
python3 test_publish.py --scenario education --platform toutiao

# === 清空缓存 ===
python3 test_clear_cache.py --scenario education
python3 test_clear_cache.py --scenario all --tables all

# === 文件清理 ===
python3 test_file_cleanup.py --scenario all --days 7
python3 test_file_cleanup.py --scenario all --covers-only
python3 test_file_cleanup.py --scenario all --dry-run

python3 delete_conversations.py doubao 5          # 删除豆包最近5个对话
python3 delete_conversations.py doubao 0           # 删除豆包所有对话
python3 delete_conversations.py all 3              # 每个平台删除3个
python3 delete_conversations.py doubao 5 --dry-run # 只看不删
python3 delete_conversations.py doubao 5 --force   # 不确认直接删

# 重启服务
cd ~/ai/openclaw/hiclaw/tool/openroute && python3 app.py

# 测试1：老脚本删除deepseek会话
python3 ~/ai/openclaw/hiclaw/test/delete_conversations.py deepseek 5 --list

# 测试2：新脚本删除deepseek会话（应该操作deepseek而非豆包）
python3 ~/ai/openclaw/hiclaw/test/test_ha.py delete deepseek 5

# 测试3：API并发（使用正确的模型名）
python3 ~/ai/openclaw/hiclaw/test/test_ha.py api 5 Doubao-Seed2.0
python3 ~/ai/openclaw/hiclaw/test/test_ha.py api 5 DeepSeek-V4-Pro

# 测试4：WebChat并发
python3 ~/ai/openclaw/hiclaw/test/test_ha.py webchat 2 proxy

# 分析账户风格
# 分析账户风格
python3 analyze_creator_style.py --platform toutiao --account 半夏花园 --scenario countryside --within-years 1

# 抖音视频发布
python3 test_video_e2e.py --scenario countryside --platform douyin

# 仅爬取不分析
python3 analyze_creator_style.py --platform douyin --account 半夏花园（何正华） --no-llm
```

---

## QQ/微信机器人配置

### QQ 机器人

1. **注册 QQ 开放平台**：https://q.qq.com/#/apps ，扫码登录，完成实名认证

2. **创建机器人**：填写名称和头像，提交审核，获取 AppID 和 AppSecret

3. **安装插件**：
```bash
openclaw plugins install @tencent-connect/openclaw-qqbot@latest
```

4. **配置绑定**：
```bash
# content 实例
openclaw channels add --channel qqbot --token "1903628560:pMtRzY7hHsT5hKycHwcIzgO6pYI2nYK6"
```

5. **重启**：`openclaw gateway restart`，确认 qqbot 通道已 enabled

> **常见问题**：如果报 "Cannot find module 'silk-wasm'"，进入插件目录执行 `npm install`

### 微信机器人

1. **安装插件**：
```bash
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

2. **扫码授权**：
```bash
openclaw channels login --channel openclaw-weixin
```

3. **更换工作目录后**：手动复制 `~/.openclaw/extensions/openclaw-weixin` 和 `~/.openclaw/openclaw-weixin` 到新工作目录

---

## 浏览器与平台发布

### Win11 配置（自动化浏览器直接工作）

```powershell
# 安装依赖
cd D:\software\openclaw\openclaw_pkg\workspace\content\agents\main\skills\toutiao-publisher
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install patchright markdown
python -m patchright install chromium

# 首次登录（弹出浏览器扫码）
python scripts/publisher.py --title "测试" --content "Hello" --no-cover

# 日常使用（仅草稿）
python scripts/publisher.py --title "标题" --content "文章.md" --no-cover

# 正式发布
python scripts/publisher.py --title "标题" --content "文章.md" --no-cover --publish
```

### Ubuntu 配置（复用真实用户浏览器）

Ubuntu 下头条检测严格，必须复用真实用户浏览器（CDP连接模式）：

```bash
# 1. 手动启动 Chromium 远程调试模式（必须先关闭所有Chromium窗口）
chromium --remote-debugging-port=9222 \
  --user-data-dir=/home/hyg/snap/chromium/common/chromium/Default

# 2. 在浏览器中手动登录今日头条，保持窗口运行

# 3. 运行发布脚本（会连接手动浏览器新建标签页）
python3 scripts/publisher.py --title "测试" --content "Hello头条" --no-cover

# 4. 脚本完成后只关闭新建的标签页，不关闭浏览器
```

也可配置为 systemd 服务实现开机自启：

```ini
# ~/.config/systemd/user/chromium-debug.service
[Unit]
Description=Chromium Remote Debugging
After=network.target

[Service]
ExecStart=/snap/bin/chromium --remote-debugging-port=9222 \
  --user-data-dir=/home/hyg/snap/chromium/common/chromium/Default
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now chromium-debug.service
```

### 浏览器账号配置

| 账号 | CDP端口 | 用户数据目录 |
|------|---------|-------------|
| 账号1 | 9223 | /home/hyg/snap/chromium/common/chromium/Default |
| 账号2 | 9225 | article-orchestrator/data/browser |

各场景与账号的映射关系（在 browser_config.json 中配置）：

| 场景 | 头条账号 | 微信账号 |
|------|----------|----------|
| education | 账号1+2 | 账号1 |
| life | 账号1+2 | - |
| novel | 账号1+2 | - |
| dev | 账号1 | - |
| student | 账号1+2 | 账号1 |
| content | 账号1+2 | 账号2 |
| general | 账号1+2 | - |

### 抓包调试

```bash
# 启动 mitmweb 抓包代理
mitmweb --web-port 8081 --no-web-open-browser \
  --ignore-hosts 'bots.qq.com|weixin.qq.com'

# 或使用 systemd 服务
systemctl --user start mitmweb.service

# 访问 http://localhost:8081 查看抓包界面

# 为 OpenClaw 配置代理
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080
export NODE_USE_ENV_PROXY=1
export NO_PROXY=localhost,127.0.0.1
```

---

## 常见问题

| 问题 | 解决方法 |
|------|----------|
| 启动提示"gateway already running" | `pkill -f "openclaw gateway"` 杀残留进程，确保每个实例的 OPENCLAW_HOME 独立 |
| QQ Bot 报 "Cannot find module 'silk-wasm'" | 进入插件目录执行 `npm install` |
| Ubuntu 一键启动窗口一闪而过 | 确认已安装 `gnome-terminal` 或 `xterm` |
| 如何查看实例 token | 启动时控制台打印，或查看 openclaw.json 中 gateway.auth.token |
| Ubuntu 下头条连接失败 | 检查手动浏览器是否以 --remote-debugging-port 启动，端口是否被占用 |
| 手动浏览器登录过期 | 在手动浏览器中重新扫码登录，无需重启服务 |
| Win11 下"保存失败" | 升级 patchright 和浏览器驱动，清除 data/browser_state 重新登录 |
| LLM调用失败不重试 | 已修复，系统会自动尝试调用链中下一个模型 |
| 免费模型排在调用链第一 | 已修复，免费模型降权-200分，openroute供应商优先 |
| 创作内容与素材雷同 | 已优化提示词，添加差异化创作铁律和随机创作指令 |
| 内容过时（出现旧年份） | 已添加时效性限制，禁止出现2026年以前的内容 |
| OpenRoute 服务开机不自启 | 已修复，添加 xvfb + 等待 X Server + systemd 配置 |
| OpenSieve 服务开机不自启 | 已修复，启用 systemd 自启 |
| 端口冲突 | 确保所有实例端口不与其他服务冲突 |
| 防火墙 | 远程访问网关需开放对应端口 |

### 日志查看

```bash
# OpenClaw 实例日志
tail -f /home/hyg/ai/openclaw/openclaw_pkg/workspace/content/.openclaw/logs/openclaw.log

# OpenSieve 日志
journalctl --user -u opensieve.service -f

# OpenRoute 日志
journalctl --user -u hiclaw-openroute.service -f

# 自动修复日志
tail -f /home/hyg/ai/openclaw/logs/auto_fixer_cron.log
```

### 数据库操作

```bash
# 查看选题状态
sqlite3 data/cache/workflow_state.db "SELECT id, title, heat, status FROM topic_status LIMIT 5;"

# 清理整个选题表
sqlite3 data/cache/workflow_state.db "DELETE FROM topic_status"

# 按平台清理
sqlite3 data/cache/workflow_state.db "DELETE FROM topic_status WHERE platform='opensieve'"

# 按领域清理
sqlite3 data/cache/workflow_state.db "DELETE FROM topic_status WHERE domain='综合'"
```

### 进程管理

```bash
# 查看监听端口
ss -tlnp | grep -E "1970[0-9]|13001|8100"

# 查看进程
ps aux | grep -E "run_.*\.sh|openclaw gateway" | grep -v grep

# 停止所有 OpenClaw 网关
pkill -f "openclaw gateway"

# 停止指定端口
fuser -k 19701/tcp

# 停止所有 Chromium
pkill -f chromium
```
