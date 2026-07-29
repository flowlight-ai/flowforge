/**
 * HubStrategyTypes — 路由策略共享类型定义
 *
 * 仅包含类型定义，不包含运行时逻辑，便于在 HubRoutingPolicyTab、
 * HubConnectorConfigTab 等多个 Hub 组件间复用。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

/** 路由策略匹配条件运算符 */
export type StrategyOperator =
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "in"
  | "contains";

/** 路由匹配维度（能力/负载/成本/标签） */
export type StrategyDimension =
  | "capability"
  | "load"
  | "cost"
  | "latency"
  | "tag"
  | "model";

/** 路由匹配条件 */
export interface StrategyCondition {
  dimension: StrategyDimension;
  operator: StrategyOperator;
  value: string | number | string[];
}

/** 路由目标 Provider */
export interface StrategyTarget {
  provider: string;
  model: string;
  weight: number;
  fallback?: boolean;
}

/** 路由策略定义 */
export interface RoutingPolicy {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: StrategyCondition[];
  targets: StrategyTarget[];
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 路由策略列表响应 */
export interface RoutingPolicyListResponse {
  policies: RoutingPolicy[];
  total: number;
}

/** 连接器配置 */
export interface ConnectorConfig {
  id: string;
  label: string;
  type: string;
  enabled: boolean;
  baseUrl?: string;
  authType?: string;
  capabilities?: string[];
}

/** 路由策略表单提交载荷 */
export interface RoutingPolicyPayload {
  name: string;
  enabled: boolean;
  priority: number;
  conditions: StrategyCondition[];
  targets: StrategyTarget[];
  description?: string;
}

/** 默认空策略 */
export const EMPTY_POLICY: RoutingPolicyPayload = {
  name: "",
  enabled: true,
  priority: 50,
  conditions: [],
  targets: [],
  description: "",
};
