# `@flowforge/sdk-minimal`

[English](README.md) | 中文

当 SDK 客户端需要一个精简、明确的编码 agent 运行时，使用 `flowforge --profile sdk-minimal`。该 profile 公布一个按平台选择的持久 shell 与 `str_replace_editor`，把会话持久化为未压缩的 JSONL，并从 SDK 初始化请求中选择模型。它提供完整的 Cordis 树，并有意排除 [`@flowforge/base`](../base/README.md)、Web、settings、托管凭据、遥测、压缩、工作区指令、技能、jobs 与 subagent。其 danger-full-access 策略允许 shell 与编辑器修改进程可访问的任何路径，因此只应在隔离的工作区中使用。

## 使用方式

直接启动该 profile，或从 SDK 客户端选择它。提供明确的 `FF_HOME`，使用一次性工作区，并通过 `DEEPSEEK_API_KEY` 提供模型凭据。

```sh
export FF_HOME=/absolute/path/to/example-flowforge-home
flowforge --profile sdk-minimal
```

`FF_CONTEXT_WINDOW` 为适配器建议目录中不存在的模型设置回退容量。`FF_SYSTEM_PROMPT` 替换默认人设。SDK 初始化请求是唯一的模型选择依据，并覆盖环境默认值。

profile、home 以及有序的 `--patch` 文件可以在完整默认树之上替换行或插入组合包。随发行版提供的模板仅在启动时应用 patch。

该 profile 恰好挂载一个持久 shell 栈：Linux/macOS 上的 Bash，或 Windows 上的 PowerShell。两个栈都使用 300 秒超时与一个 owner 限定终端；另一平台的行保持禁用。

## 理解实现

该组合包的单个 insert 就是完整的应用树：SDK stdio 启动与 JSON-RPC 服务、一个由环境配置的 DeepSeek 适配器、明确的 agent 核心、本地 subprocess 与不受限文件系统 provider、按平台选择的持久 shell PTY、字符串替换编辑器，以及位于 `$FF_HOME/sessions` 下的未压缩 JSONL 持久化。它不继承另一个组合包，因此每一额外行都是明确的 profile 变更。

### 源映射

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 完整独立的 profile 树及其环境支持默认值 |
| [`src/index.ts`](src/index.ts) | 组合包入口 |
| — | 不发布运行时不变式 companion；该包是静态 patch 清单载体，其插入的行各自拥有运行时关系。 |
| [`tests/sdk-minimal.spec.ts`](tests/sdk-minimal.spec.ts) | 精确组合、profile 名与平台选择检查 |

## 深入探索

- [SDK 应用组合包](../sdk-app/README.md) —— 完整与精简 SDK profile 复用的 JSON-RPC 应用层。
- [Base 组合包](../base/README.md) —— 本 profile 有意省略的完整产品基础。

## 模型体验

### 精简编码 agent 组合

#### 模型所见

系统提示词为 `FF_SYSTEM_PROMPT` 或 `You are a helpful software engineer assistant.`。唯一对外公布的工具是 Linux/macOS 上的 owner 限定持久 `bash` 或 Windows 上的 `pwsh`，外加 `str_replace_editor`；运行时上下文、工作区指令、技能、jobs 控制、压缩与 Harness 身份均缺席。

#### KV Cache 影响

对固定的人设、平台、provider、模型与组合包 patch 栈保持稳定。

## 已知限制与暂缓事项

- **该组合有意省略共享产品服务** —— 当需要 settings、托管凭据、策略预设、遥测、Web 工具或完整默认工具清单时，选择 `flowforge --profile sdk`。
- **用户 patch 可能扩展树并破坏 stdout** —— profile 自定义是被信任的应用组合；向 stdout 写入普通文本的插件可能破坏 JSON-RPC 帧。