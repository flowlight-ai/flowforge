/**
 * SettingsShell 导航配置 — 14 个 section
 *
 * 依据 WEB-FUSION-DESIGN.md §7.2 移植清单：
 *   - 命名遵循 FlowForge 规范（禁止 cat/clowder/cat-cafe 字样）
 *   - 使用 "Forgekin" 替代 "Cat"，"可进化智能体" 替代 "灵智体"
 *   - icon 对应 lucide-react 图标名（在 SettingsNav 中映射）
 */

export interface SettingsSection {
  /** Section 唯一标识 */
  id: string;
  /** 导航显示标签 */
  label: string;
  /** lucide-react 图标名（在 SettingsNav 中映射为组件） */
  icon: string;
  /** 主题色（CSS 变量） */
  color: string;
  /** Section 描述（显示在内容区页头） */
  description: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'members',
    label: '成员管理',
    icon: 'users',
    color: 'var(--accent)',
    description: '可进化智能体名册、协作对象与编排顺序。',
  },
  {
    id: 'profiles',
    label: '能力画像',
    icon: 'file-text',
    color: 'var(--accent)',
    description: '按模型分组的能力画像、路由信号与来源追溯。',
  },
  {
    id: 'accounts',
    label: '账户与密钥',
    icon: 'key',
    color: 'var(--accent)',
    description: '模型 Provider、API Key、凭据和执行身份的归属关系。',
  },
  {
    id: 'im',
    label: 'IM 对接',
    icon: 'plug',
    color: 'var(--accent-2)',
    description: '飞书、钉钉、企微和外部消息入口。',
  },
  {
    id: 'skills',
    label: 'Skill 管理',
    icon: 'zap',
    color: 'var(--accent-2)',
    description: '技能市场、安装计划和本地能力预览。',
  },
  {
    id: 'mcp',
    label: 'MCP 管理',
    icon: 'box',
    color: 'var(--accent-2)',
    description: 'MCP 服务、工具目录和浏览器自动化依赖。',
  },
  {
    id: 'plugins',
    label: '插件集成',
    icon: 'puzzle',
    color: 'var(--accent-2)',
    description: '插件状态、外部集成以及安装结果。',
  },
  {
    id: 'marketplace',
    label: '能力市场',
    icon: 'search',
    color: 'var(--accent-2)',
    description: '搜索和安装 MCP、Skill、插件等能力包。',
  },
  {
    id: 'concierge',
    label: '管家配置',
    icon: 'bell',
    color: 'var(--accent-2)',
    description: '管家形象、人设、值班策略和主动性配置。',
  },
  {
    id: 'voice',
    label: '语音管理',
    icon: 'mic',
    color: 'var(--info)',
    description: '语音输入输出、术语表和 TTS 服务状态。',
  },
  {
    id: 'system',
    label: '系统配置',
    icon: 'settings',
    color: 'var(--info)',
    description: '工作流、Agent、执行模式、工具与运行时总开关。',
  },
  {
    id: 'appearance',
    label: '外观与主题',
    icon: 'palette',
    color: 'var(--info)',
    description: '主题模式（亮色/暗色/跟随系统）、界面密度与视觉偏好。',
  },
  {
    id: 'rules',
    label: '协作与规则',
    icon: 'scroll-text',
    color: 'var(--info)',
    description: '提示词模板、会话生命周期、协作规则与模型指南。',
  },
  {
    id: 'notify',
    label: '通知',
    icon: 'bell',
    color: 'var(--info)',
    description: '推送订阅、提醒策略与设备联动。',
  },
  {
    id: 'ops',
    label: '运维监控',
    icon: 'activity',
    color: 'var(--info)',
    description: '服务健康、可观测性和运行态观测。',
  },
];

export const DEFAULT_SECTION = 'members';

/** 导航关键词索引（用于搜索过滤） */
export const SECTION_KEYWORDS: Record<string, string> = {
  members: '成员 智能体 Forgekin 名册 roster evolvable',
  profiles: '画像 能力 capability profile 路由',
  accounts: '密钥 API key 账号 credentials provider 模型',
  im: '飞书 钉钉 企微 telegram 微信 connector',
  skills: 'skill 技能 能力',
  mcp: 'MCP tool 工具',
  plugins: '插件 集成 plugin',
  marketplace: '市场 安装 marketplace',
  concierge: '管家 值班 主动性 proactive persona',
  voice: '语音 TTS STT whisper',
  rules: '规则 提示词 prompt SOP 协作 governance',
  system: '配置 环境 workflow agent mode tool',
  appearance: '主题 外观 颜色 暗色 亮色 跟随系统 theme dark light',
  notify: '推送 通知 push',
  ops: '运维 监控 observability 健康 usage',
};
