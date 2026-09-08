import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { derivedProfileSet } from './canonical-tool-registry.js';
import { jsonSchemaToZod } from './json-schema-to-zod.js';
import type { FamilyToolDefinition } from './tool-governance-snapshot.js';

export { derivedProfileSet } from './canonical-tool-registry.js';

type ToolDef = FamilyToolDefinition;

const KNOWN_DESKTOP_MODES = new Set(['fable-phase0', 'cloud-pro-phase0']);

const DESKTOP_PROFILE: Record<string, ToolDef['policy']['runtimeProfiles'][number]> = {
  'fable-phase0': 'desktop:fable-phase0',
  'cloud-pro-phase0': 'desktop:cloud-pro-phase0',
};

export interface ToolsetEnv {
  readonly?: boolean;
  hasAgentKey?: boolean;
  desktopMode?: string;
}

/**
 * Parse env vars into a structured ToolsetEnv. Defaults to process.env;
 * tests may pass a fixture env to avoid module-cache games.
 */
export function parseToolsetEnv(env: NodeJS.ProcessEnv = process.env): ToolsetEnv {
  const desktopMode = env.CAT_CAFE_DESKTOP_MODE?.trim();
  const result: ToolsetEnv = {
    readonly: env.CAT_CAFE_READONLY === 'true',
    hasAgentKey: !!(env.CAT_CAFE_AGENT_KEY_SECRET || env.CAT_CAFE_AGENT_KEY_FILE || env.CAT_CAFE_AGENT_KEY_FILES),
  };
  if (desktopMode) result.desktopMode = desktopMode;
  return result;
}

/**
 * Filter an injected tool registry by the current ToolsetEnv.
 *
 * Whitelists are derived from the registry itself (they are projections, never
 * independent allowlists). Precedence (V3):
 *   1. desktopMode highest — NOT union with READONLY/AGENT_KEY whitelists.
 *      Unknown value → throw (fail-fast on server startup).
 *   2. !readonly → return all tools unchanged.
 *   3. readonly → readonly-set ∪ (hasAgentKey ? agent-key-set : ∅).
 */
export function applyReadonlyFilter(
  registry: readonly FamilyToolDefinition[],
  env: ToolsetEnv = parseToolsetEnv(),
): readonly FamilyToolDefinition[] {
  if (env.desktopMode) {
    if (!KNOWN_DESKTOP_MODES.has(env.desktopMode)) {
      throw new Error(
        `Unknown CAT_CAFE_DESKTOP_MODE: "${env.desktopMode}". Valid modes: ${[...KNOWN_DESKTOP_MODES].join(', ')}`,
      );
    }
    const profile = DESKTOP_PROFILE[env.desktopMode];
    if (!profile) {
      throw new Error(`No projection profile registered for CAT_CAFE_DESKTOP_MODE: "${env.desktopMode}"`);
    }
    const allowed = derivedProfileSet(registry, profile);
    return registry.filter((t) => allowed.has(t.name));
  }
  if (!env.readonly) return registry;
  const readonlyAllowed = derivedProfileSet(registry, 'readonly');
  const agentKeyAllowed = derivedProfileSet(registry, 'agent-key');
  return registry.filter(
    (t) => readonlyAllowed.has(t.name) || (!!env.hasAgentKey && agentKeyAllowed.has(t.name)),
  );
}

/**
 * Schema-delivery meta injected into a tool's `_meta` at registration. A tool
 * exposed as `always-visible` is preloaded by compatible clients.
 */
export function projectSchemaDeliveryMeta(definition: Pick<ToolDef, 'policy'>): Record<string, unknown> | undefined {
  return definition.policy.schemaDelivery.policy === 'always-visible' ? { 'anthropic/alwaysLoad': true } : undefined;
}

type RegisteredToolHandler = (args: never) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}>;

/**
 * Register tools with the SDK using the explicit config-object API
 * (registerTool(name, config, cb)). This bypasses the overload parser, which
 * would mis-parse plain JSON Schema objects as annotations. The tool's plain
 * JSON Schema input is converted to a Zod schema (zod v4) at registration time.
 */
export function registerTools(server: McpServer, tools: readonly ToolDef[]): void {
  const registerExplicit = server.registerTool.bind(server) as unknown as (
    name: string,
    config: {
      description: string;
      inputSchema: z.ZodObject<z.ZodRawShape>;
      annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        openWorldHint: boolean;
      };
      _meta?: Record<string, unknown>;
    },
    cb: RegisteredToolHandler,
  ) => void;
  for (const tool of tools) {
    const annotations = tool.annotations;
    const deliveryMeta = projectSchemaDeliveryMeta(tool);
    const schema = tool.inputSchema;
    const zodSchema =
      typeof schema.type === 'string' && typeof schema.properties === 'object' && schema.properties !== null
        ? jsonSchemaToZod(schema)
        : z.object(schema as z.ZodRawShape);
    registerExplicit(
      tool.name,
      {
        description: tool.description,
        inputSchema: zodSchema,
        annotations,
        ...(deliveryMeta ? { _meta: deliveryMeta } : {}),
      },
      async (args: never) => {
        const result = await tool.handler(args);
        return {
          ...(result as Record<string, unknown>),
        } as {
          content: Array<{ type: 'text'; text: string }>;
          isError?: boolean;
          [key: string]: unknown;
        };
      },
    );
  }
}

/**
 * Assemble a toolset onto an MCP server: project the injected registry through
 * the env filters, then register the surviving tools.
 */
export function registerToolset(
  server: McpServer,
  registry: readonly FamilyToolDefinition[],
  env: ToolsetEnv = parseToolsetEnv(),
): void {
  registerTools(server, applyReadonlyFilter(registry, env));
}