/**
 * @flowforge/external-agent manifest — AgentProviderManifest 声明模型（F241 CL-014）。
 *
 * TS 重写自 flowforge/core/external_agent/manifest.py：
 *   - AgentProtocol: CLI / API / SDK / IDE / MCP
 *   - AgentTransport: STDIO / SSE / WEBSOCKET / HTTP
 *   - SafetyLevel: READONLY / NORMAL / DANGEROUS
 *   - AgentProviderManifest: provider_name（含 "." 校验）/ display_name / version /
 *     protocol / transport / capabilities / blind_spots / timeout_seconds /
 *     retry_policy / cost_per_token / cost_per_call / safety_level /
 *     required_env_vars / required_permissions
 *   - loadManifestFromYaml / loadManifestsFromDir（config/manifests/*.yaml）
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** Agent 协议（manifest.py AgentProtocol）。 */
export type AgentProtocol = 'cli' | 'api' | 'sdk' | 'ide' | 'mcp';

/** Agent 传输方式（manifest.py AgentTransport）。 */
export type AgentTransport = 'stdio' | 'sse' | 'websocket' | 'http';

/** 安全级别（manifest.py SafetyLevel）。 */
export type SafetyLevel = 'readonly' | 'normal' | 'dangerous';

/** 重试策略。 */
export interface RetryPolicy {
  /** 最大重试次数。 */
  readonly max_attempts: number;
  /** 重试退避间隔（秒）。 */
  readonly backoff_seconds: number;
}

/** 三方 Agent Provider 声明（manifest.py AgentProviderManifest）。 */
export interface AgentProviderManifest {
  /** Provider 名称（必须包含 "."，如 anthropic.claude_code）。 */
  readonly provider_name: string;
  /** 展示名称（如 Claude Code）。 */
  readonly display_name: string;
  /** Manifest 版本。 */
  readonly version: string;
  /** 协议。 */
  readonly protocol: AgentProtocol;
  /** 传输方式。 */
  readonly transport: AgentTransport;
  /** 能力列表（EX-002）。 */
  readonly capabilities: readonly string[];
  /** 盲点列表（EX-002 必填）。 */
  readonly blind_spots: readonly string[];
  /** 超时（秒，缺省 300）。 */
  readonly timeout_seconds?: number;
  /** 重试策略。 */
  readonly retry_policy?: RetryPolicy;
  /** 每 token 成本（美元）。 */
  readonly cost_per_token?: number;
  /** 每次调用固定成本（美元）。 */
  readonly cost_per_call?: number;
  /** 安全级别。 */
  readonly safety_level?: SafetyLevel;
  /** 必需的环境变量列表（host-owned 注入）。 */
  readonly required_env_vars?: readonly string[];
  /** 必需权限列表（L3 tool_allowlist 最小权限原则）。 */
  readonly required_permissions?: readonly string[];
}

/** Manifest 校验错误。 */
export class ManifestValidationError extends Error {}

const VALID_PROTOCOLS: readonly string[] = ['cli', 'api', 'sdk', 'ide', 'mcp'];
const VALID_TRANSPORTS: readonly string[] = ['stdio', 'sse', 'websocket', 'http'];

/** 规范化 Manifest 输入（宽松接受字符串枚举并做校验）。 */
export function normalizeManifest(
  raw: Record<string, unknown>,
): AgentProviderManifest {
  const providerName = raw.provider_name;
  if (typeof providerName !== 'string' || !providerName.includes('.')) {
    throw new ManifestValidationError(
      `provider_name must contain '.', got: ${String(providerName)}`,
    );
  }
  const displayName = raw.display_name;
  if (typeof displayName !== 'string' || displayName.length === 0) {
    throw new ManifestValidationError(
      `display_name must be a non-empty string, got: ${String(displayName)}`,
    );
  }
  const protocol = String(raw.protocol ?? 'cli');
  if (!VALID_PROTOCOLS.includes(protocol)) {
    throw new ManifestValidationError(
      `invalid protocol: ${protocol} (valid: ${VALID_PROTOCOLS.join(', ')})`,
    );
  }
  const transport = String(raw.transport ?? 'stdio');
  if (!VALID_TRANSPORTS.includes(transport)) {
    throw new ManifestValidationError(
      `invalid transport: ${transport} (valid: ${VALID_TRANSPORTS.join(', ')})`,
    );
  }
  const retryPolicy = raw.retry_policy;
  const manifest: AgentProviderManifest = {
    provider_name: providerName,
    display_name: displayName,
    version: String(raw.version ?? '1.0.0'),
    protocol: protocol as AgentProtocol,
    transport: transport as AgentTransport,
    capabilities: toStrArray(raw.capabilities),
    blind_spots: toStrArray(raw.blind_spots),
    safety_level:
      raw.safety_level !== undefined
        ? (String(raw.safety_level) as SafetyLevel)
        : 'normal',
    ...(raw.timeout_seconds !== undefined
      ? { timeout_seconds: Number(raw.timeout_seconds) }
      : {}),
    ...(retryPolicy !== undefined && typeof retryPolicy === 'object'
      ? {
          retry_policy: {
            max_attempts: Number(
              (retryPolicy as Record<string, unknown>).max_attempts ?? 3,
            ),
            backoff_seconds: Number(
              (retryPolicy as Record<string, unknown>).backoff_seconds ?? 5,
            ),
          },
        }
      : {}),
    ...(raw.cost_per_token !== undefined ? { cost_per_token: Number(raw.cost_per_token) } : {}),
    ...(raw.cost_per_call !== undefined ? { cost_per_call: Number(raw.cost_per_call) } : {}),
    ...(raw.required_env_vars !== undefined
      ? { required_env_vars: toStrArray(raw.required_env_vars) }
      : {}),
    ...(raw.required_permissions !== undefined
      ? {
          required_permissions: toStrArray(raw.required_permissions),
        }
      : {}),
  };
  return manifest;
}

function toStrArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

/** 从 YAML 文本加载 Manifest（失败抛 ManifestValidationError）。 */
export function parseManifestYaml(text: string): AgentProviderManifest {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new ManifestValidationError(`yaml parse failed: ${String(error)}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ManifestValidationError('manifest yaml must be an object (mapping)');
  }
  return normalizeManifest(data as Record<string, unknown>);
}

/** 从 YAML 文件加载 Manifest。 */
export function loadManifestFromYaml(filePath: string): AgentProviderManifest {
  const text = readFileSync(filePath, 'utf-8');
  return parseManifestYaml(text);
}

/**
 * 从目录加载所有 *.yaml Manifest（registry.py load_from_dir 语义）：
 * 文件不存在时抛错；已存在的 Provider 会被覆盖（返回覆盖列表）。
 */
export function loadManifestsFromDir(
  dirPath: string,
): { manifests: AgentProviderManifest[]; overridden: string[] } {
  const manifests: AgentProviderManifest[] = [];
  const overridden: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    const manifest = loadManifestFromYaml(join(dirPath, file.name));
    if (manifests.some((m) => m.provider_name === manifest.provider_name)) {
      overridden.push(manifest.provider_name);
      const idx = manifests.findIndex((m) => m.provider_name === manifest.provider_name);
      manifests[idx] = manifest;
    } else {
      manifests.push(manifest);
    }
  }
  return { manifests, overridden };
}
