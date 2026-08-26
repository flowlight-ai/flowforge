/**
 * types — 插件市场类型（T7.11/F11，对齐 `core/marketplace.py` PluginManifest）。
 *
 * - PluginManifest：插件清单（发现/版本/依赖/权限/入口点/校验和）
 * - PluginCategory：五类插件分类
 * - MarketplaceResult / RegistryRefreshResult：操作结果契约
 * - BUILTIN_REGISTRY_PLUGINS：内置注册表（对齐 `config/marketplace/registry.yaml`）
 *
 * @module @flowforge/forgekin-plugins
 */

/** 插件分类（对齐 Python `Literal["tool", "agent", "mode", "integration", "theme"]`）。 */
export type PluginCategory = 'tool' | 'agent' | 'mode' | 'integration' | 'theme';

/** 插件清单——注册表发现/安装/验证的单一事实来源。 */
export interface PluginManifest {
  /** 插件标识（如 "flowforge-web-search"）。 */
  name: string;
  /** 展示名。 */
  display_name?: string;
  /** 描述。 */
  description?: string;
  /** 版本号（默认 "1.0.0"）。 */
  version?: string;
  /** 作者。 */
  author?: string;
  /** 分类（默认 "tool"）。 */
  category?: PluginCategory;
  /** 标签（参与搜索匹配）。 */
  tags?: string[];
  /** 主页。 */
  homepage?: string | null;
  /** 仓库地址。 */
  repository?: string | null;
  /** 许可证（默认 "MIT"）。 */
  license?: string;
  /** 最低 FlowForge 版本要求。 */
  min_flowforge_version?: string | null;
  /** 依赖的插件名列表（安装时递归解析）。 */
  dependencies?: string[];
  /** 权限声明（如 network_access / process_spawn）。 */
  permissions?: string[];
  /** 入口点（"module:Class" 形式）。 */
  entry_point?: string;
  /** 校验和（SHA-256，安装/验证时校验）。 */
  checksum?: string | null;
  /** 前端入口（前端插件扩展，对齐 `core/plugin_frontend.py`）。 */
  frontend_entry?: string;
  /** 前端挂载点（sidebar/toolbar/settings/dashboard/task_panel/review_panel）。 */
  mount_points?: string[];
}

/** 市场操作结果（install/uninstall/update/verify 统一契约）。 */
export interface MarketplaceResult {
  /** 结果状态。 */
  status:
    | 'installed'
    | 'already_installed'
    | 'uninstalled'
    | 'updated'
    | 'up_to_date'
    | 'verified'
    | 'failed'
    | 'error';
  /** 插件名。 */
  name?: string;
  /** 版本号。 */
  version?: string;
  /** 更新前版本。 */
  previous_version?: string;
  /** 更新后版本。 */
  new_version?: string;
  /** 错误信息（status=error/failed 时）。 */
  error?: string;
  /** verify() 的逐项检查结果。 */
  checks?: Record<string, boolean | string>;
}

/** 注册表刷新结果。 */
export interface RegistryRefreshResult {
  /** 刷新状态。 */
  status: 'refreshed' | 'skipped' | 'error';
  /** 跳过/失败原因。 */
  reason?: string;
  /** 新增插件数。 */
  added?: number;
  /** 更新插件数。 */
  updated?: number;
  /** 注册表插件总数。 */
  total_plugins?: number;
}

/** 前端插件注册项（对齐 `core/plugin_frontend.py` FrontendPluginRegistry 存储结构）。 */
export interface FrontendPluginEntry {
  name: string;
  entry: string;
  mount_points: string[];
  version: string;
}

/** 内置注册表插件（对齐 `config/marketplace/registry.yaml`，全量内嵌）。 */
export const BUILTIN_REGISTRY_PLUGINS: readonly PluginManifest[] = [
  {
    name: 'flowforge-web-search',
    display_name: 'Web Search Aggregator',
    description:
      'Aggregated web search tool with fallback chain: HelixRAG → DuckDuckGo → LLM-powered search. Supports multi-query, deduplication, and relevance scoring.',
    version: '1.2.0',
    author: 'FlowForge Team',
    category: 'tool',
    tags: ['search', 'web', 'retrieval', 'aggregation'],
    homepage: 'https://github.com/flowforge/plugins/tree/main/web-search',
    repository: 'https://github.com/flowforge/plugins.git',
    license: 'MIT',
    min_flowforge_version: '0.5.0',
    dependencies: [],
    permissions: ['network_access'],
    entry_point: 'flowforge.tools.web_search:WebSearchTool',
    checksum: null,
  },
  {
    name: 'flowforge-mcp-bridge',
    display_name: 'MCP Bridge Integration',
    description:
      'Bridge plugin that connects FlowForge to external MCP (Model Context Protocol) servers. Auto-discovers and registers MCP tools as FlowForge-compatible tools with full lifecycle management.',
    version: '1.0.0',
    author: 'FlowForge Team',
    category: 'integration',
    tags: ['mcp', 'integration', 'bridge', 'protocol'],
    homepage: 'https://github.com/flowforge/plugins/tree/main/mcp-bridge',
    repository: 'https://github.com/flowforge/plugins.git',
    license: 'Apache-2.0',
    min_flowforge_version: '0.6.0',
    dependencies: [],
    permissions: ['process_spawn', 'network_access'],
    entry_point: 'flowforge.mcp.gateway:MCPGateway',
    checksum: null,
  },
];
