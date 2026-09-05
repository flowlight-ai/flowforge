/**
 * .cat-cafe 运行态 JSON 文档模型（C38，data/ + ~/.flowforge 文件契约移植）。
 *
 * clowder `.cat-cafe/` 运行态文件（accounts.json / capabilities.json /
 * cat-catalog.json / user-preferences.json / mcp-resolved.json）的类型化
 * 读改写存储：
 *   - zod 严格校验每个文档
 *   - 写入经 tmp+rename 原子替换
 *   - 全部 fs 注入式（测试确定性，不落盘）
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

// ── 文档 schema ─────────────────────────────────────────────

export const runtimeAccountSchema = z
  .object({
    id: z.string().min(1),
    catId: z.string().min(1),
    clientId: z.string().min(1),
    provider: z.string().min(1).optional(),
    /** 凭据仅存引用指针，绝不落盘密钥。 */
    credentialRef: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const runtimeUserPreferencesSchema = z
  .object({
    preferredCats: z.array(z.string().min(1)).optional(),
    timeZone: z.string().min(1).optional(),
    theme: z.string().min(1).optional(),
    notifyDisabled: z.boolean().optional(),
  })
  .strict()
  .passthrough();

export const runtimeCapabilitySchema = z
  .object({
    catId: z.string().min(1),
    capabilities: z.record(z.string(), z.boolean()),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const runtimeProxyUpstreamsSchema = z.record(
  z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'upstream slug must be a lowercase url-path segment'),
  z
    .object({
      /** 上游目标（如第三方 Anthropic 兼容网关地址）。 */
      baseUrl: z.string().min(1),
      /** 凭据仅存引用指针，绝不落盘密钥（红线 11；clowder 原文件存 apiKey 的部分走凭据插件）。 */
      credentialRef: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      updatedAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
);

export const runtimeProviderProfileSchema = z
  .object({
    id: z.string().min(1),
    authType: z.enum(['oauth', 'api_key']),
    client: z.string().min(1).optional(),
    protocol: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    models: z.array(z.string().min(1)).optional(),
    modelAliases: z.record(z.string(), z.string().min(1)).optional(),
    /** F171: agent 子进程注入的用户自定义 env（非密钥语义由调用方保证）。 */
    envVars: z.record(z.string(), z.string()).optional(),
    /** 凭据仅存引用指针（clowder provider-profiles.secrets.local.json → 凭据插件，R17）。 */
    credentialRef: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const runtimeMcpResolvedSchema = z
  .object({
    catId: z.string().min(1),
    serverCommand: z.string().min(1).optional(),
    serverArgs: z.array(z.string()).optional(),
    envPrefix: z.string().min(1).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type RuntimeAccount = z.infer<typeof runtimeAccountSchema>;
export type RuntimeUserPreferences = z.infer<typeof runtimeUserPreferencesSchema>;
export type RuntimeCapability = z.infer<typeof runtimeCapabilitySchema>;
export type RuntimeMcpResolved = z.infer<typeof runtimeMcpResolvedSchema>;
export type RuntimeProxyUpstreams = z.infer<typeof runtimeProxyUpstreamsSchema>;
export type RuntimeProviderProfile = z.infer<typeof runtimeProviderProfileSchema>;

export type RuntimeFileKind =
  | 'accounts'
  | 'user-preferences'
  | 'capabilities'
  | 'cat-catalog'
  | 'mcp-resolved'
  | 'proxy-upstreams'
  | 'provider-profiles';

export type RuntimeTypedKind = Exclude<RuntimeFileKind, 'cat-catalog'>;

export interface RuntimeJsonStoreDeps {
  /** 读文件；缺失返回 null。 */
  readFile?: (filePath: string) => string | null;
  writeFile?: (filePath: string, content: string) => Promise<void> | void;
}

const defaultReadFile = (filePath: string): string | null => {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
};

const defaultWriteFile = async (filePath: string, content: string): Promise<void> => {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.${join(filePath).split('/').pop()}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
};

const parseByKind: Record<RuntimeTypedKind, (value: unknown) => unknown> = {
  accounts: (value) => z.array(runtimeAccountSchema).parse(value),
  'user-preferences': (value) => runtimeUserPreferencesSchema.parse(value),
  capabilities: (value) => z.array(runtimeCapabilitySchema).parse(value),
  'mcp-resolved': (value) => z.array(runtimeMcpResolvedSchema).parse(value),
  'proxy-upstreams': (value) => runtimeProxyUpstreamsSchema.parse(value),
  'provider-profiles': (value) => z.array(runtimeProviderProfileSchema).parse(value),
};

export function runtimeFileName(kind: RuntimeFileKind): string {
  return `${kind}.json`;
}

/** .cat-cafe 运行态 JSON 存储（注入式 fs）。 */
export class RuntimeJsonStore {
  private readonly baseDir: string;
  private readonly deps: RuntimeJsonStoreDeps;

  constructor(baseDir: string, deps: RuntimeJsonStoreDeps = {}) {
    this.baseDir = baseDir;
    this.deps = deps;
  }

  private pathOf(kind: RuntimeTypedKind): string {
    return join(this.baseDir, runtimeFileName(kind));
  }

  /** 读取并校验（非 cat-catalog 文档）。缺失返回 null。 */
  read<T>(kind: RuntimeTypedKind, parse: (value: unknown) => T): T | null {
    const raw = (this.deps.readFile ?? defaultReadFile)(this.pathOf(kind));
    if (raw === null || raw === undefined) return null;
    return parse(JSON.parse(raw));
  }

  /** 读取并校验内置 kind 文档。 */
  readTyped(kind: RuntimeTypedKind): unknown {
    return this.read(kind, parseByKind[kind]);
  }

  /** 原子写（tmp+rename）。返回完整目标路径。 */
  async write(kind: RuntimeTypedKind, value: unknown): Promise<string> {
    const target = this.pathOf(kind);
    await (this.deps.writeFile ?? defaultWriteFile)(target, JSON.stringify(value, null, 2));
    return target;
  }
}
