# FlowForge Helm 界面优化路线图

> 版本: v2.0 | 日期: 2026-06-07 | 状态: 审核通过

---

## 一、背景与目标

### 1.1 现状评估

FlowForge 后端 Agent 能力已领先（9大执行模式 / 29个通用Agent / Harness控制论 / 5种记忆策略），但 Helm 前端体验与行业标杆（Trae CN Solo）存在显著差距：

| 维度 | FlowForge 现状 | Trae CN Solo |
|------|---------------|-------------|
| Plan模式 | `/plan`命令仅切换模式，无独立Plan面板 | AI生成可编辑规划文档，确认后执行 |
| 文件上传 | 不支持 | 截图/文档/设计稿上传，多模态输入 |
| Diff视图 | 手写逐行Diff，无按文件分组 | 按文件分组的代码变更，一键接受/拒绝 |
| 命令面板 | 8个命令的简单下拉 | 可视化命令面板，分组+搜索+自定义 |

### 1.2 优化目标

**核心策略**: 发挥 Agent 后端深度优势，用前端体验补齐与 Trae 的差距。差异化定位为"AI自主执行 + 人类精准控制"。

### 1.3 审核反馈与修订

v1.0 审核识别出 6 项关键设计缺口，已在 v2.0 中全部补齐：

| 编号 | 缺口 | 说明 | v2.0 补齐位置 |
|------|------|------|--------------|
| O1 | Plan模式与Harness层交互定义缺失 | Plan步骤如何映射到Harness执行模式未定义 | §2.1 Harness集成决策表 |
| O2 | 多文件Diff数据收集机制(FileChangeTracker)缺失 | 无从Agent写入事件中收集变更数据的机制 | §2.3 FileChangeTracker架构 |
| O3 | 数据库迁移脚本(plans/attachments表)缺失 | Plan和附件持久化无DDL定义 | §2.6 数据库迁移 |
| O4 | 文件上传安全措施不足 | 无类型校验、路径穿越防护、速率限制 | §2.2 安全措施清单 |
| O5 | Plan生成Prompt模板缺失 | LLM如何生成结构化Plan未定义 | §2.1 Plan→Workflow转换 |
| O6 | 前端状态管理方案缺失 | 多组件间Plan/Attachment/Diff状态共享无方案 | §2.5 前端状态管理方案 |

---

## 二、Phase 1: P0 核心体验补齐（1-2周）

### 2.1 Plan 模式 UI

#### 2.1.1 功能描述

用户输入任务后，AI 生成结构化执行计划（Plan），用户可编辑/调整/确认后，系统按计划执行。这是 Trae CN 的核心卖点，也是 Helm 模式的关键交互。

#### 2.1.2 技术方案

**前端组件**:

```
PlanPanel.tsx          — Plan 主面板（嵌入聊天流）
  ├── PlanStepCard.tsx   — 单个步骤卡片（可拖拽排序、编辑、删除）
  ├── PlanEditor.tsx     — Plan 编辑器（Markdown/表单双模式）
  └── PlanActions.tsx    — 确认/修改/重新生成按钮组
```

**交互流程**:

1. 用户选择"Helm模式"或输入`/plan`命令
2. AI 生成 Plan（通过 LLM 调用），以结构化 JSON 返回
3. PlanPanel 在聊天流中渲染为可交互卡片
4. 用户可：拖拽调整步骤顺序、编辑步骤描述、删除/新增步骤
5. 用户点击"确认执行"→ 系统按 Plan 依次执行
6. 执行过程中每个步骤自动关联 PlanStepCard，实时更新状态

**Plan 数据模型**:

```typescript
interface Plan {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  createdAt: number;
  confirmedAt: number | null;
}

interface PlanStep {
  id: string;
  index: number;
  title: string;
  description: string;
  agent?: string;       // 指定执行的 Agent
  tool?: string;        // 指定使用的工具
  mode?: "auto" | "confirm" | "manual";  // 执行模式（O1补充）
  status: "pending" | "running" | "completed" | "error" | "skipped";
  result?: string;      // 执行结果摘要
  editable: boolean;    // 是否可编辑（确认前=true）
}
```

**后端 API**:

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/tasks/{task_id}/plan` | GET | 获取当前 Plan |
| `/api/v1/tasks/{task_id}/plan` | POST | 生成/更新 Plan |
| `/api/v1/tasks/{task_id}/plan/confirm` | POST | 确认 Plan 并开始执行 |
| `/api/v1/tasks/{task_id}/plan/steps/{step_id}` | PATCH | 更新单个步骤 |

**WebSocket 事件**:

| 事件类型 | 数据 | 说明 |
|---------|------|------|
| `plan_generated` | `{plan: Plan}` | AI 生成 Plan |
| `plan_step_update` | `{step_id, status, result}` | 步骤状态变更 |
| `plan_confirmed` | `{plan_id}` | 用户确认 Plan |

**Harness 集成决策表**（O1补充）:

| Plan 阶段 | Harness 层行为 | 说明 |
|-----------|---------------|------|
| Plan 生成 | ContextEngine 注入 | 生成 Plan 时，ContextEngine 将当前任务上下文（文件结构、已有代码、依赖关系）注入 LLM Prompt，确保 Plan 步骤可落地 |
| Plan 确认 | PermissionPipeline prepare 级别 | 用户确认 Plan 后，PermissionPipeline 以 prepare 级别预检每个步骤的权限（文件写入、命令执行等），提前发现权限问题 |
| 步骤执行 | Harness 正常模式 + lightweight FeedbackLoop | 每个 PlanStep 执行时，Harness 以正常模式运行，但使用轻量级 FeedbackLoop（仅收集关键指标，不触发完整反馈循环） |
| Plan 完成 | full FeedbackLoop | 所有步骤执行完成后，触发完整 FeedbackLoop，对整体执行结果进行质量评估和改进建议 |

**Plan → Workflow 转换**（O5补充）:

Plan 确认后，系统内部将 Plan 转换为临时 Workflow YAML，委托 WorkflowExecutor 执行：

```yaml
# Plan 确认后自动生成的临时 Workflow YAML
workflow:
  id: "plan-{plan_id}"
  name: "{plan_title}"
  steps:
    - id: "{step_id}"
      agent: "{agent}"
      tool: "{tool}"
      mode: "{mode}"
      input:
        description: "{step_description}"
      depends_on: []
```

转换规则：
1. 每个 PlanStep 映射为 Workflow 的一个 step
2. PlanStep 的 `index` 顺序转换为 `depends_on` 依赖链（前一步完成后执行下一步）
3. PlanStep 的 `mode` 映射为 Harness 执行模式（auto→自动、confirm→需确认、manual→手动）
4. Workflow 执行完成后，结果回写 Plan 的 `results_json` 字段

**依赖库**: 无新增依赖，纯 React + 现有基础设施

**实现难度**: 中等。核心挑战在于 Plan 与现有执行模式的集成（特别是 Plan-Execute 模式的 `planner` Agent 已有 Plan 生成能力，需要复用而非重写）。

---

### 2.2 文件上传/附件

#### 2.2.1 功能描述

用户可在聊天输入框上传文件（截图、文档、设计稿等），文件作为多模态输入传递给 Agent。

#### 2.2.2 技术方案

**前端组件**:

```
ChatInput.tsx（修改）  — 添加附件按钮和拖拽上传
AttachmentPreview.tsx  — 附件预览卡片（缩略图/文件名/大小/删除）
```

**交互流程**:

1. 用户点击📎按钮或拖拽文件到输入框
2. 文件上传到 `/api/v1/tasks/{task_id}/attachments`
3. AttachmentPreview 在输入框上方显示预览
4. 发送消息时，附件 ID 随消息一起提交
5. Agent 通过 `workspace_file` 工具读取附件内容

**附件数据模型**:

```typescript
interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: "image" | "document" | "code" | "other";
  mimeType: string;
  url: string;           // 下载 URL
  thumbnailUrl?: string; // 图片缩略图
  uploadedAt: number;
}
```

**后端 API**:

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/tasks/{task_id}/attachments` | POST | 上传附件（multipart/form-data） |
| `/api/v1/tasks/{task_id}/attachments` | GET | 列出附件 |
| `/api/v1/tasks/{task_id}/attachments/{id}` | GET | 下载附件 |
| `/api/v1/tasks/{task_id}/attachments/{id}` | DELETE | 删除附件 |

**存储方案**: 附件存储在工作区目录下的 `attachments/` 子目录，元数据存入 SQLite。

**安全措施清单**（O4补充）:

| 措施 | 实现方式 | 说明 |
|------|---------|------|
| 文件类型白名单 | 后端校验 `mime_type` | 仅允许图片（png/jpg/gif/webp）、文档（pdf/docx/txt/md）、代码（py/ts/js/json/yaml） |
| UUID 重命名存储 | 上传时生成 UUID 文件名 | 防止文件名冲突和路径猜测，原始文件名存入数据库 |
| 路径穿越防护 | 校验存储路径不含 `..` | 防止恶意文件名如 `../../etc/passwd` 导致的目录穿越攻击 |
| 速率限制 | 10 文件/分钟/任务 | 防止滥用上传接口，超过限制返回 429 Too Many Requests |

**附件自动注入**（O4补充）:

附件上传后自动注入 `TaskContext.state` 的 `attachments` 列表，Agent 可通过 ContextEngine 获取附件信息：

```python
# TaskContext.state 中的附件信息
state["attachments"] = [
    {
        "id": "uuid",
        "file_name": "original_name.png",
        "file_type": "image",
        "mime_type": "image/png",
        "storage_path": "attachments/uuid.png",
        "uploaded_at": 1717737600
    }
]
```

Agent 执行时通过 `workspace_file` 工具读取附件内容，无需额外传参。

**图片处理**: 使用浏览器原生 `FileReader` + `URL.createObjectURL` 生成预览，无需服务端处理。

**依赖库**: 无新增依赖

**实现难度**: 低。核心是文件上传 API + 前端拖拽/预览，均为标准 Web 开发模式。

---

### 2.3 Diff 视图升级

#### 2.3.1 当前代码分析

当前 Diff 实现（[MarkdownPanel.tsx](../web/src/components/helm/MarkdownPanel.tsx) L50-86）：

```typescript
function computeDiff(original: string, current: string) {
  // 简单逐行比较，仅向前看5行做匹配
  // 无 LCS（最长公共子序列）算法
  // 无字符级 Diff
  // 无按文件分组
}
```

**问题清单**:
1. Diff 算法简陋：仅向前看5行匹配，大量误判
2. 无字符级高亮：整行标记为 added/removed，无法定位具体变更
3. 无按文件分组：只能对比单个文件，无法展示多文件变更
4. 无一键接受/拒绝：只有"回退到原始版本"
5. DiffViewer 组件（L716-749）渲染简陋，无行号、无折叠

#### 2.3.2 技术方案

**方案选择**: 引入 `diff` 库（MIT，0依赖，周下载 4000万+）替代手写 Diff 算法

**依赖库**:

| 库 | 版本 | 大小 | 说明 |
|----|------|------|------|
| `diff` | ^7.0 | 12KB | Diff 算法核心（LCS + 字符级 Diff） |

> 不选用 `monaco-diff-editor`（过重，2MB+）或 `react-diff-viewer-continued`（依赖多，定制性差）

**前端组件重构**:

```
DiffViewer.tsx（重写）  — 新 Diff 查看器
  ├── DiffFileGroup.tsx  — 按文件分组的变更卡片
  ├── DiffHunk.tsx       — 变更块（含折叠的上下文行）
  ├── DiffLine.tsx       — 单行 Diff（含字符级高亮）
  └── DiffActions.tsx    — 接受/拒绝/回退操作
```

**DiffViewer 新接口**:

```typescript
interface DiffViewerProps {
  files: DiffFile[];           // 多文件变更
  onAcceptFile?: (filePath: string) => void;
  onRejectFile?: (filePath: string) => void;
  onRevertAll?: () => void;
}

interface DiffFile {
  filePath: string;
  original: string;
  current: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;              // @@ -1,3 +1,4 @@
  lines: DiffLine[];
}

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
  highlightRanges?: { start: number; length: number }[];  // 字符级高亮
}
```

**核心算法**:

```typescript
import * as Diff from "diff";

function computeFileDiff(original: string, current: string, filePath: string): DiffFile {
  const changes = Diff.structuredPatch(filePath, filePath, original, current, "", "", { context: 3 });
  const hunks = changes.hunks.map(h => ({
    header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    lines: h.lines.map(line => ({
      type: line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "unchanged",
      content: line.slice(1),
      // ... 行号计算
    })),
  }));
  return { filePath, original, current, hunks };
}
```

**与现有代码的集成点**:

1. `MarkdownPanel.tsx` 的 `computeDiff` 函数 → 替换为 `diff` 库
2. `DiffViewer` 组件 → 完全重写
3. `HelmLayout.tsx` 中的文件变更事件 → 收集为 `DiffFile[]` 传入 DiffViewer
4. 新增 `primaryTab = "changes"` — 全局变更视图（跨文件）

**FileChangeTracker 架构**（O2补充）:

多文件 Diff 的核心挑战是数据收集——需要从 Agent 写入事件中捕获变更前后的文件内容。FileChangeTracker 作为中间件拦截 `file_rw` 工具的写入操作：

```
file_rw 写入请求
    ↓
FileChangeTracker.capture_before(file_path)  →  读取当前文件内容作为 before
    ↓
file_rw 执行写入
    ↓
FileChangeTracker.capture_after(file_path)   →  读取写入后文件内容作为 after
    ↓
EventBus.emit("file.changed", { file_path, before, after })
    ↓
DiffViewer 订阅 file.changed 事件，更新 DiffFile[]
```

关键设计：
1. FileChangeTracker 注册为 `file_rw` 工具的前置/后置钩子（Hook）
2. `capture_before` 在文件写入前读取当前内容，若文件不存在则 before 为空字符串
3. `capture_after` 在文件写入后读取新内容
4. 通过 EventBus 发射 `file.changed` 事件，DiffViewer 订阅并增量更新
5. 同一文件多次变更时，仅保留最终的 before/after 对（中间变更自动合并）

**大文件性能优化**:

| 文件规模 | 策略 | 说明 |
|---------|------|------|
| ≤1000 行 | 正常渲染 | 主线程直接计算 Diff |
| >1000 行 | Web Worker | Diff 计算移至 Web Worker，避免阻塞 UI |
| >10000 行 | 限制展示 | 仅展示前 500 个 hunks，底部显示"还有 N 个变更未展示" |

Web Worker 实现：
```typescript
// diff.worker.ts
self.onmessage = (e: MessageEvent<{ original: string; current: string; filePath: string }>) => {
  const result = computeFileDiff(e.data.original, e.data.current, e.data.filePath);
  self.postMessage(result);
};
```

**实现难度**: 中等。算法替换简单，UI 重写工作量适中，关键在于多文件变更的数据收集和状态管理。

---

### 2.4 斜杠命令面板

#### 2.4.1 当前代码分析

当前命令系统（[ChatInput.tsx](../web/src/components/helm/ChatInput.tsx) L96-101）：

```typescript
const handleTextChange = (e) => {
  const val = e.target.value;
  if (val.startsWith("/") && val.indexOf(" ") === -1) {
    setShowCommands(true); setCommandFilter(val);
  } else { setShowCommands(false); setCommandFilter(""); }
};
```

**问题清单**:
1. 命令列表硬编码在 `helm-utils.ts` 的 `COMMANDS` 数组中，仅8个命令
2. 无分组、无图标、无快捷键提示
3. 无模糊匹配（仅 `startsWith`）
4. 无自定义命令扩展机制
5. 命令面板样式简陋（`CommandDropdown` 在 ChatPrimitives.tsx 中仅30行）

#### 2.4.2 技术方案

**方案选择**: 自建轻量命令面板（不引入 cmdk 等重依赖，保持与现有 UI 风格一致）

**依赖库**: 无新增依赖

**前端组件**:

```
CommandPalette.tsx（重写）  — 命令面板
  ├── CommandGroup.tsx      — 命令分组
  └── CommandItem.tsx       — 单个命令项
```

**命令数据模型**:

```typescript
interface Command {
  id: string;
  label: string;            // 显示名称
  description: string;      // 描述
  icon?: React.ReactNode;   // 图标
  shortcut?: string;        // 快捷键，如 "Ctrl+P"
  group: string;            // 分组：execution / mode / navigation / tool
  handler: () => void;      // 执行函数
  keywords?: string[];      // 搜索关键词（支持模糊匹配）
  disabled?: boolean;       // 是否禁用
  visible?: boolean;        // 是否可见
}
```

**命令分组**:

| 分组 | 命令 | 说明 |
|------|------|------|
| 执行控制 | `/pause` `/resume` `/skip` `/stop` | 暂停/恢复/跳过/停止 |
| 模式切换 | `/plan` `/spec` `/react` `/auto` | Plan/Spec/ReAct/全自动 |
| 导航 | `/files` `/settings` `/terminal` | 打开文件/设置/终端面板 |
| 工具 | `/search` `/scrape` `/publish` | 搜索/抓取/发布 |
| 帮助 | `/help` `/status` `/reset` | 帮助/状态/重置 |

**模糊匹配算法**:

```typescript
function fuzzyMatch(query: string, command: Command): number {
  const q = query.toLowerCase().replace(/^\//, "");
  const label = command.label.toLowerCase();
  const keywords = (command.keywords || []).map(k => k.toLowerCase());

  // 精确匹配最高分
  if (label.startsWith(q)) return 100;
  if (keywords.some(k => k.startsWith(q))) return 80;
  // 包含匹配
  if (label.includes(q)) return 60;
  if (keywords.some(k => k.includes(q))) return 40;
  // 字符序列匹配（fuzzy）
  let qi = 0;
  for (const ch of label) { if (ch === q[qi]) qi++; }
  if (qi === q.length) return 20;
  return 0; // 不匹配
}
```

**触发方式**:
1. 输入框输入 `/` 触发（现有行为）
2. `Ctrl+K` / `Cmd+K` 全局触发（新增）

**后端 API**:

命令列表支持后端动态生成，允许运行时注册/发现命令：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/commands` | GET | 获取所有可用命令（含分组、图标、快捷键、启用状态） |

响应格式：
```json
{
  "commands": [
    {
      "id": "plan",
      "label": "Plan 模式",
      "description": "生成可编辑执行计划",
      "group": "mode",
      "shortcut": null,
      "keywords": ["规划", "计划", "plan"],
      "disabled": false
    }
  ]
}
```

前端启动时调用此 API 获取命令列表，与本地硬编码命令合并（本地优先，后端补充扩展命令）。

**实现难度**: 低。核心是命令注册表 + 模糊匹配 + UI 渲染，均为标准前端模式。

---

### 2.5 前端状态管理方案（O6补充）

#### 2.5.1 方案选择

采用 **React Context + useReducer** 方案（零依赖），原因：
1. Plan/Attachment/Diff 状态仅在 Helm 模式内共享，不需要全局状态库
2. 避免引入 zustand/jotai 等额外依赖，保持项目轻量
3. useReducer 天然支持复杂状态的原子化更新

#### 2.5.2 Context 设计

**PlanContext** — Plan 状态管理：

```typescript
interface PlanState {
  plan: Plan | null;
  isGenerating: boolean;
  editingStepId: string | null;
}

type PlanAction =
  | { type: "SET_PLAN"; payload: Plan }
  | { type: "UPDATE_STEP"; payload: { stepId: string; updates: Partial<PlanStep> } }
  | { type: "CONFIRM_PLAN" }
  | { type: "SET_GENERATING"; payload: boolean };
```

**AttachmentContext** — 附件状态管理：

```typescript
interface AttachmentState {
  attachments: Attachment[];
  isUploading: boolean;
  uploadProgress: Record<string, number>;  // attachmentId → progress%
}

type AttachmentAction =
  | { type: "ADD_ATTACHMENT"; payload: Attachment }
  | { type: "REMOVE_ATTACHMENT"; payload: string }
  | { type: "SET_UPLOADING"; payload: boolean }
  | { type: "UPDATE_PROGRESS"; payload: { id: string; progress: number } };
```

**DiffContext** — Diff 状态管理：

```typescript
interface DiffState {
  files: DiffFile[];
  acceptedFiles: Set<string>;
  rejectedFiles: Set<string>;
}

type DiffAction =
  | { type: "ADD_FILE_CHANGE"; payload: DiffFile }
  | { type: "ACCEPT_FILE"; payload: string }
  | { type: "REJECT_FILE"; payload: string }
  | { type: "REVERT_ALL" };
```

#### 2.5.3 Provider 组合

```typescript
function HelmContextProvider({ children }: { children: React.ReactNode }) {
  return (
    <PlanContext.Provider value={useReducer(planReducer, initialPlanState)}>
      <AttachmentContext.Provider value={useReducer(attachmentReducer, initialAttachmentState)}>
        <DiffContext.Provider value={useReducer(diffReducer, initialDiffState)}>
          {children}
        </DiffContext.Provider>
      </AttachmentContext.Provider>
    </PlanContext.Provider>
  );
}
```

HelmContextProvider 包裹在 HelmLayout 顶层，所有 Helm 子组件通过 `useContext` 获取状态和 dispatch。

---

### 2.6 数据库迁移（O3补充）

#### 2.6.1 数据库文件

新建 `data/helm.db`（独立于主系统数据库），存储 Plan 和附件元数据。

#### 2.6.2 plans 表 DDL

```sql
CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,           -- UUID
    task_id     TEXT NOT NULL,              -- 关联的任务 ID
    title       TEXT NOT NULL,              -- Plan 标题
    description TEXT,                       -- Plan 描述
    status      TEXT NOT NULL DEFAULT 'draft',  -- draft / confirmed / executing / completed / error
    current_step INTEGER NOT NULL DEFAULT 0,    -- 当前执行步骤索引
    total_steps  INTEGER NOT NULL DEFAULT 0,    -- 总步骤数
    edited_steps TEXT DEFAULT '[]',         -- 用户编辑过的步骤 ID 列表（JSON 数组）
    results_json TEXT DEFAULT '{}',         -- 各步骤执行结果（JSON 对象）
    created_at  REAL NOT NULL,              -- 创建时间（Unix timestamp）
    confirmed_at REAL,                      -- 确认时间
    completed_at REAL,                      -- 完成时间
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_plans_task_id ON plans(task_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
```

#### 2.6.3 attachments 表 DDL

```sql
CREATE TABLE IF NOT EXISTS attachments (
    id           TEXT PRIMARY KEY,          -- UUID
    task_id      TEXT NOT NULL,             -- 关联的任务 ID
    file_name    TEXT NOT NULL,             -- 原始文件名
    file_size    INTEGER NOT NULL,          -- 文件大小（字节）
    file_type    TEXT NOT NULL,             -- image / document / code / other
    mime_type    TEXT NOT NULL,             -- MIME 类型
    extension    TEXT,                      -- 文件扩展名（不含点号）
    storage_path TEXT NOT NULL,             -- 存储路径（UUID 重命名后的路径）
    status       TEXT NOT NULL DEFAULT 'active',  -- active / deleted
    created_at   REAL NOT NULL,             -- 上传时间
    deleted_at   REAL,                      -- 删除时间
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_attachments_task_id ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status);
```

#### 2.6.4 迁移策略

1. 应用启动时检查 `data/helm.db` 是否存在，不存在则自动创建并执行 DDL
2. 使用 `PRAGMA user_version` 管理迁移版本，后续表结构变更通过版本号增量迁移
3. 不使用 ORM，直接通过 `sqlite3` 标准库操作，保持轻量

## 三、Phase 2: P1 专业体验提升（2-3周）

### 3.1 Agent 编排 UI

**功能**: 可视化配置 HELM Agent 可调用的子 Agent 和工具链。

**技术方案**:
- 基于 `@xyflow/react`（已安装）构建 Agent 编排画布
- 左侧 Agent/Tool 拖拽面板，中间画布连线，右侧属性编辑
- 编排结果导出为 YAML workflow 配置
- 复用现有 `DynamicGraph.tsx` 的渲染能力

**依赖库**: 无新增（`@xyflow/react` 已在 package.json 中）

**实现难度**: 高。画布交互复杂，需要拖拽、连线、属性编辑、YAML 导出等完整编排能力。

### 3.2 MCP 配置面板

**功能**: 在 Helm 界面管理 MCP Server 连接（添加/删除/启停/状态查看）。

**技术方案**:
- 新增 Settings 子面板 "MCP 服务器"
- 后端 API: `GET/POST/DELETE /api/v1/mcp/servers`
- 复用现有 `mcp/broker.py` 的服务器管理能力
- 支持 JSON-RPC 连接测试

**依赖库**: 无新增

**实现难度**: 低。主要是 CRUD + 连接测试 UI。

### 3.3 终端重构

**功能**: 只读命令卡片 + 后台长命令管理 + 命令历史。

**技术方案**:
- 命令执行结果以卡片形式嵌入聊天流（类似 ToolCallCard）
- 长时间运行的命令在状态栏显示进度
- 命令历史持久化到 localStorage
- 安全限制：禁止 `rm -rf` / `format` 等危险命令

**依赖库**: 无新增

**实现难度**: 中等。需要改造现有终端为卡片式 + 安全过滤。

### 3.4 对话流折叠摘要

**功能**: 已完成步骤自动折叠并生成 AI 摘要。

**技术方案**:
- `StepAccordion` 折叠时调用 LLM 生成摘要（或使用现有 `draft_summary`）
- 折叠摘要显示在 StepHeader 中
- 可配置折叠延迟（步骤完成后 N 秒自动折叠）

**依赖库**: 无新增

**实现难度**: 低。核心是 StepAccordion 的折叠逻辑 + 摘要显示。

### 3.5 设置面板可编辑

**功能**: 在线修改模型配置、API Key、工作区设置。

**技术方案**:
- Settings 面板从只读改为可编辑表单
- 后端 API: `PATCH /api/v1/settings/providers/{name}`
- API Key 输入框使用 password 类型 + 遮罩显示
- 保存后自动热重载配置

**依赖库**: 无新增

**实现难度**: 低。标准表单 + API 调用。

---

## 四、Phase 3: P2 体验优化（3-4周）

### 4.1 内置浏览器预览

**功能**: 在工具面板中嵌入浏览器，可选元素加入对话。

**技术方案**:
- 使用 `<iframe>` 嵌入网页预览
- 通过 `postMessage` 实现元素选择
- 选中元素截图后作为附件加入对话

**依赖库**: `html2canvas`（截图）

**实现难度**: 高。跨域限制、元素选择、截图处理。

### 4.2 Spec 模式

**功能**: spec.md + tasks.md + checklist.md 三件套，AI 自动生成项目规格。

**技术方案**:
- 新增 `/spec` 命令触发 Spec 生成
- Spec 三件套存储在工作区 `.specs/` 目录
- Spec 编辑器基于 MarkdownPanel 扩展
- Spec → Plan → Execute 三阶段流转

**依赖库**: 无新增

**实现难度**: 中等。核心是 Spec 模板 + LLM 生成 + 三阶段流转。

### 4.3 Worktree 隔离

**功能**: 不同任务独立 Git 环境。

**技术方案**:
- 使用 `git worktree` 创建独立工作目录
- 任务创建时自动创建 worktree
- 任务完成时合并或丢弃 worktree

**依赖库**: 无新增（调用 git CLI）

**实现难度**: 高。Git worktree 管理 + 冲突处理 + 清理逻辑。

### 4.4 Markdown 渲染升级

**功能**: 替换手写渲染器，支持表格、数学公式、脚注等。

**技术方案**:
- 替换 `renderMarkdown()` 为 `react-markdown`（已在 package.json 中）
- 添加 `remark-gfm`（表格/脚注/删除线）
- 添加 `rehype-katex` + `katex`（数学公式）
- 添加 `react-syntax-highlighter`（代码高亮）

**依赖库**:

| 库 | 版本 | 大小 | 说明 |
|----|------|------|------|
| `react-markdown` | 已安装 | — | Markdown 渲染 |
| `remark-gfm` | ^4.0 | 8KB | GFM 扩展 |
| `rehype-katex` | ^7.0 | 5KB | KaTeX 数学公式 |
| `katex` | ^0.16 | 200KB | 数学公式渲染 |
| `react-syntax-highlighter` | ^15.5 | 40KB | 代码语法高亮 |

**实现难度**: 低。替换渲染器，API 兼容。

---

## 五、Phase 4: P3 远期规划

### 5.1 语音输入

**功能**: 按住说话，语音转文字。

**技术方案**: Web Speech API（浏览器原生），零依赖。

### 5.2 三端同步

**功能**: Web / PC / 移动端实时同步。

**技术方案**: Tauri（桌面端）+ Capacitor（移动端）+ WebSocket 同步。

### 5.3 Figma 导入

**功能**: 解析 Figma 设计文件生成代码。

**技术方案**: Figma REST API + LLM 代码生成。

---

## 六、技术依赖总览

### 6.1 Phase 1 新增依赖

| 库 | 版本 | 大小 | 用途 | 引入时机 |
|----|------|------|------|---------|
| `diff` | ^7.0 | 12KB | Diff 算法（LCS + 字符级） | Phase 1.3 |

### 6.2 Phase 3 新增依赖

| 库 | 版本 | 大小 | 用途 | 引入时机 |
|----|------|------|------|---------|
| `remark-gfm` | ^4.0 | 8KB | GFM Markdown 扩展 | Phase 3.4 |
| `rehype-katex` | ^7.0 | 5KB | 数学公式渲染 | Phase 3.4 |
| `katex` | ^0.16 | 200KB | 数学公式引擎 | Phase 3.4 |
| `react-syntax-highlighter` | ^15.5 | 40KB | 代码语法高亮 | Phase 3.4 |
| `html2canvas` | ^1.4 | 50KB | 网页截图 | Phase 3.1 |

### 6.3 已有依赖（无需新增）

| 库 | 用途 |
|----|------|
| `@xyflow/react` | Agent 编排画布（Phase 2.1） |
| `react-markdown` | Markdown 渲染（Phase 3.4） |
| `lucide-react` | 图标库（全局） |

---

## 七、Diff 视图重构详细方案

### 7.1 当前代码评估

**文件**: `web/src/components/helm/MarkdownPanel.tsx`

**重构范围**:

| 代码段 | 行号 | 当前状态 | 重构动作 |
|--------|------|---------|---------|
| `computeDiff()` | L50-86 | 手写逐行Diff，仅向前看5行 | 删除，替换为 `diff` 库 |
| `DiffViewer` 组件 | L716-749 | 简单双栏渲染，无行号/折叠/字符高亮 | 完全重写 |
| `diffTabIds` 状态 | L258 | 本地状态管理单文件Diff | 扩展为多文件变更管理 |
| `handlePrimaryTabChange` | L278-290 | 切换到diff tab | 新增 "changes" 全局变更 tab |

**重构难度**: 中等

- **低风险**: `computeDiff` 替换为 `diff` 库（纯算法替换，接口不变）
- **中风险**: `DiffViewer` 重写（组件接口变化，需要调整 MarkdownPanel 的调用方式）
- **中风险**: 多文件变更数据收集（需要从 WebSocket 事件流中提取文件变更，目前无此机制）

### 7.2 重构步骤

1. 安装 `diff` 库
2. 新建 `DiffViewer.tsx` 独立组件文件
3. 实现 `computeFileDiff` 使用 `diff.structuredPatch`
4. 实现 `DiffFileGroup` / `DiffHunk` / `DiffLine` 子组件
5. 在 MarkdownPanel 中引入新 DiffViewer
6. 新增 `primaryTab = "changes"` 全局变更视图
7. 在 HelmLayout 中收集文件变更事件，传入 DiffViewer

---

## 八、实施优先级与里程碑

### Phase 1 修订时间线（24天）

| 里程碑 | 功能 | 时间 | 工作量 | 前置依赖 |
|--------|------|------|--------|---------|
| M1.0 | 补充设计（O1-O6缺口补齐） | Day 1-2 | 2天 | 无 |
| M1.1 | 斜杠命令面板 | Day 3-4 | 2天 | M1.0 |
| M1.2 | 文件上传/附件 | Day 5-8 | 4天 | M1.0（O4安全措施） |
| M1.3 | Diff 视图升级 | Day 9-13 | 5天 | M1.0（O2 FileChangeTracker） |
| M1.4 | Plan 模式 UI | Day 14-21 | 8天 | M1.0（O1 Harness集成、O5 Prompt模板） |
| M1.5 | 集成测试 | Day 22-24 | 3天 | M1.1-M1.4 |

### Phase 2+ 里程碑（保持不变）

| 里程碑 | 功能 | 预计工作量 | 前置依赖 |
|--------|------|-----------|---------|
| M2.1 | MCP 配置面板 | 2天 | 无 |
| M2.2 | 设置面板可编辑 | 2天 | 无 |
| M2.3 | 对话流折叠摘要 | 2天 | 无 |
| M2.4 | 终端重构 | 3天 | 无 |
| M2.5 | Agent 编排 UI | 5天 | `@xyflow/react` |
| M3.1 | Markdown 渲染升级 | 2天 | `remark-gfm` 等 |
| M3.2 | Spec 模式 | 5天 | Spec API 后端 |
| M3.3 | 内置浏览器预览 | 5天 | `html2canvas` |
| M3.4 | Worktree 隔离 | 5天 | Git CLI |

---

## 九、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Plan 模式与现有 Plan-Execute 模式冲突 | 中 | 高 | 复用 planner Agent，Plan UI 仅做展示层 |
| Diff 多文件变更数据收集困难 | 中 | 中 | 先实现单文件 Diff 升级，多文件作为增量 |
| 文件上传大文件性能问题 | 低 | 中 | 限制单文件 10MB，大文件分片上传 |
| Agent 编排画布交互复杂 | 高 | 中 | Phase 2 最后实现，优先保证核心功能 |
| react-markdown 替换渲染器兼容性 | 低 | 低 | 渐进替换，保留 renderMarkdown 作为 fallback |
| R6: 工作量低估导致延期 | 高 | 中 | M1.0 预留2天设计补充，每个里程碑预留0.5天缓冲；每日站会检查进度偏差 |
| R7: 附件与 workspace_file 工具集成断裂 | 中 | 中 | 附件注入 TaskContext.state 后，workspace_file 通过 ContextEngine 统一读取；集成测试覆盖附件→Agent→工具全链路 |

---

## 十、测试策略

### 10.1 单元测试

| 测试对象 | 测试内容 | 覆盖目标 |
|---------|---------|---------|
| Plan 数据模型 | Plan/PlanStep 序列化/反序列化、状态流转、mode 字段校验 | ≥90% |
| Diff 算法 | `computeFileDiff` 正确性、字符级高亮、空文件/大文件边界 | ≥90% |
| 模糊匹配 | `fuzzyMatch` 精确匹配/包含匹配/字符序列匹配/不匹配 | ≥90% |
| FileChangeTracker | capture_before/capture_after、事件发射、同文件多次变更合并 | ≥85% |

### 10.2 集成测试

| 测试对象 | 测试内容 | 覆盖目标 |
|---------|---------|---------|
| Plan API | POST 生成 Plan → GET 获取 → PATCH 更新步骤 → POST 确认 → WebSocket 事件推送 | 全链路 |
| Attachment API | POST 上传 → GET 列表 → GET 下载 → DELETE 删除 → 安全校验（类型白名单、路径穿越、速率限制） | 全链路 |
| WebSocket 事件 | plan_generated / plan_step_update / plan_confirmed / file.changed 事件正确推送 | 事件完整性 |
| Plan → Workflow 转换 | Plan 确认后生成 Workflow YAML → WorkflowExecutor 执行 → 结果回写 Plan | 转换正确性 |

### 10.3 E2E 测试

| 测试场景 | 步骤 | 验证点 |
|---------|------|--------|
| Plan 完整流程 | 用户输入任务 → AI 生成 Plan → 用户编辑步骤 → 确认执行 → 步骤逐个完成 → 最终结果 | Plan 状态流转、步骤执行顺序、结果回写 |
| 附件上传与使用 | 上传图片 → 发送消息 → Agent 读取附件 → 生成包含附件内容的回复 | 附件持久化、ContextEngine 注入、workspace_file 读取 |
| Diff 查看与操作 | Agent 修改多文件 → FileChangeTracker 捕获 → DiffViewer 展示 → 接受/拒绝文件变更 | 多文件变更收集、Diff 渲染、接受/拒绝状态管理 |

### 10.4 前端组件测试

| 组件 | 测试内容 | 工具 |
|------|---------|------|
| PlanPanel | Plan 渲染、步骤拖拽排序、编辑/删除、确认按钮 | Vitest + Testing Library |
| DiffViewer | 多文件分组、hunk 折叠、字符级高亮、接受/拒绝 | Vitest + Testing Library |
| CommandPalette | 命令列表渲染、模糊匹配、键盘导航、分组展示 | Vitest + Testing Library |
| AttachmentPreview | 文件预览、上传进度、删除操作 | Vitest + Testing Library |

---

> **本文档 v2.0 已审核通过，按 Phase 1 修订时间线（24天）开始编码实施。**
