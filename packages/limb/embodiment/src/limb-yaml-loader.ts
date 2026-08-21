/**
 * limb-yaml-loader — 插件四肢声明 YAML 加载器（T6.4）
 *
 * 本地化自 clowder-ai `src/domains/limb/limb-yaml-loader.ts`（F126）：
 * 将插件 manifest 中的 `limbs/*.yml` 声明解析为 `LimbDeclaration`，
 * 供 PluginLimbAdapter 驱动命令路由（REST/invoke）。
 *
 * @module @flowforge/limb-embodiment/limb-yaml-loader
 */

import { readFileSync } from 'node:fs';
import type { LimbCapability, LimbCommandParamSchema } from '@flowforge/limb-core';
import { parse as parseYaml } from 'yaml';

// ─── YAML Schema Types ─────────────────────────────────────

export interface LimbAuthConfig {
  type: 'client_credentials' | 'api_key' | 'bearer';
  tokenEndpoint: string;
  tokenParams: Record<string, string>;
  tokenResponsePath: string;
  tokenPlacement: 'query' | 'header';
  tokenParamName: string;
  tokenExpiredCodes: number[];
  ttlSeconds: number;
}

export interface LimbErrorConfig {
  codePath: string;
  messagePath: string;
}

/** 命令参数定义（与 limb-core `LimbCommandParamSchema` 同构） */
export type LimbCommandParam = LimbCommandParamSchema;

export interface LimbCommandDef {
  type: 'rest' | 'invoke';
  description: string;
  params: Record<string, LimbCommandParam>;
  // REST-specific
  endpoint?: string;
  method?: string;
  body?: unknown;
  contentType?: string;
  // invoke-specific
  handler?: string;
}

export interface LimbDeclaration {
  nodeId: string;
  displayName: string;
  platform: string;
  baseUrl?: string;
  auth?: LimbAuthConfig;
  error?: LimbErrorConfig;
  capabilities: LimbCapability[];
  commands: Record<string, LimbCommandDef>;
}

// ─── Loader ─────────────────────────────────────────────────

function parseAuth(raw: Record<string, unknown>): LimbAuthConfig {
  return {
    type: (raw['type'] as LimbAuthConfig['type']) ?? 'client_credentials',
    tokenEndpoint: raw['tokenEndpoint'] as string,
    tokenParams: (raw['tokenParams'] as Record<string, string>) ?? {},
    tokenResponsePath: (raw['tokenResponsePath'] as string) ?? 'access_token',
    tokenPlacement: (raw['tokenPlacement'] as 'query' | 'header') ?? 'query',
    tokenParamName: (raw['tokenParamName'] as string) ?? 'access_token',
    tokenExpiredCodes: (raw['tokenExpiredCodes'] as number[]) ?? [],
    ttlSeconds: (raw['ttlSeconds'] as number) ?? 7200,
  };
}

function parseCommand(raw: Record<string, unknown>): LimbCommandDef {
  const def: LimbCommandDef = {
    type: (raw['type'] as 'rest' | 'invoke') ?? 'rest',
    description: (raw['description'] as string) ?? '',
    params: (raw['params'] as Record<string, LimbCommandParam>) ?? {},
  };
  if (raw['endpoint'] !== undefined) def.endpoint = raw['endpoint'] as string;
  if (raw['method'] !== undefined) def.method = raw['method'] as string;
  if (raw['body'] !== undefined) def.body = raw['body'];
  if (raw['contentType'] !== undefined) def.contentType = raw['contentType'] as string;
  if (raw['handler'] !== undefined) def.handler = raw['handler'] as string;
  return def;
}

/** 从 YAML 文件加载四肢声明；缺必填字段抛 Error */
export function loadLimbDeclaration(yamlPath: string): LimbDeclaration {
  const raw = readFileSync(yamlPath, 'utf-8');
  const doc = parseYaml(raw) as Record<string, unknown>;

  const nodeId = doc['nodeId'] as string;
  const displayName = doc['displayName'] as string;
  const platform = doc['platform'] as string;
  const capabilities = doc['capabilities'] as LimbCapability[];

  if (!nodeId || !displayName || !platform || !Array.isArray(capabilities)) {
    throw new Error(`Invalid limb declaration in ${yamlPath}: missing required fields`);
  }

  const rawCommands = (doc['commands'] ?? {}) as Record<string, Record<string, unknown>>;
  const commands: Record<string, LimbCommandDef> = {};
  for (const [name, cmdRaw] of Object.entries(rawCommands)) {
    commands[name] = parseCommand(cmdRaw);
  }

  const declaration: LimbDeclaration = {
    nodeId,
    displayName,
    platform,
    capabilities,
    commands,
  };
  if (doc['baseUrl'] !== undefined) declaration.baseUrl = doc['baseUrl'] as string;
  if (doc['auth']) declaration.auth = parseAuth(doc['auth'] as Record<string, unknown>);
  if (doc['error'] !== undefined) declaration.error = doc['error'] as LimbErrorConfig;
  return declaration;
}
