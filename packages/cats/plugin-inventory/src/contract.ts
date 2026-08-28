/**
 * @flowforge/cats-plugin-inventory — C30 最小 plugin 契约（P15）
 *
 * TS 移植：`@clowder-ai/plugin-contract`（0.1.0-beta.7）的宿主消费面。
 * 上游契约包体量过大（含 conformance runner / codegen / wire），此处只
 * 内嵌 host-inventory 需要的四件：Capability 17 值枚举、PluginManifest
 * 结构、fail-closed `validateManifest`（手写校验，语义对齐
 * `schemas/manifest.schema.json` + Ajv allErrors 策略）、
 * `validateEffectiveGrants`（MAX_GRANT_ITEMS=17 封闭枚举）。
 *
 * 注意：契约版本号（PLUGIN_CONTRACT_VERSION）与上游同步 —— 升级上游
 * 契约时须同步本文件并跑 conformance 对齐。
 */

// ─── Capability 表（@signed(G-0 2026-07-15)，17 值） ────────────────

export const L0_CAPABILITIES = ['plugin.config.read', 'plugin.state.get', 'plugin.state.set'] as const;
export const L1_CAPABILITIES = [
  'messaging.send',
  'schedule.register',
  'events.publish',
  'messaging.appendElements',
] as const;
export const L2_CAPABILITIES = [
  'onMessage',
  'message.event.subscribe',
  'secret.read',
  'thread.listMetadata',
  'thread.readContent',
  'memory.query',
  'memory.append',
  'memory.retrieve',
  'windows.create',
  'whisper.extend',
] as const;

export type Capability = (typeof L0_CAPABILITIES)[number] | (typeof L1_CAPABILITIES)[number] | (typeof L2_CAPABILITIES)[number];

export const VALID_CAPABILITIES = new Set<Capability>([...L0_CAPABILITIES, ...L1_CAPABILITIES, ...L2_CAPABILITIES]);

/** Maximum number of items in effectiveGrants — derived from the 17-value enum. */
export const MAX_GRANT_ITEMS = 17;

// ─── Manifest 结构 ───────────────────────────────────────────────────

export type DataClass = 'cache' | 'ephemeral' | 'user-authored' | 'derived-user-visible' | 'relationship' | 'interaction-history';
export type DataStrategy = 'lifecycle' | 'retained' | 'ask-on-uninstall';

/** User-visible/relationship data MUST be retained or ask-on-uninstall (铁律 #5). */
const USER_VISIBLE_DATA_CLASSES: ReadonlySet<DataClass> = new Set([
  'user-authored',
  'derived-user-visible',
  'relationship',
  'interaction-history',
]);

export interface ResourceReference {
  readonly type: string;
  readonly id: string;
}

export interface PluginFeature {
  readonly id: string;
  readonly name: string;
  readonly resources: readonly ResourceReference[];
  readonly capabilities: readonly Capability[];
}

export interface DataDeclaration {
  readonly name: string;
  readonly dataClass: DataClass;
  readonly strategy: DataStrategy;
  readonly schemaVersion?: string;
}

export interface ExternalRuntimeDeclaration {
  readonly transport: 'stdio' | 'ipc';
  readonly entrypoint: string;
}

export interface BuiltinRuntimeDeclaration {
  readonly transport: 'builtin';
  readonly entrypoint?: string;
}

export type RuntimeDeclaration = ExternalRuntimeDeclaration | BuiltinRuntimeDeclaration;

export interface PluginManifest {
  readonly pluginId: string;
  readonly version: string;
  readonly contractVersion: string;
  readonly name: string;
  readonly description?: string;
  readonly features: readonly PluginFeature[];
  readonly data?: readonly DataDeclaration[];
  readonly runtime: RuntimeDeclaration;
}

// ─── 验证结果类型 ────────────────────────────────────────────────────

export interface ManifestValidationError {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
}

export type ManifestValidationResult =
  | { readonly valid: true; readonly manifest: PluginManifest; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly ManifestValidationError[] };

// ─── validateEffectiveGrants ─────────────────────────────────────────

/**
 * Validate that effectiveGrants:
 *   1. Does not exceed MAX_GRANT_ITEMS (17).
 *   2. Contains no duplicates.
 *   3. Contains only valid Capability enum members (closed-enum check).
 *
 * Fail-closed: any unrecognized capability value returns false.
 * This is an authorization boundary — fail-open would allow
 * uncontrolled privilege escalation.
 */
export function validateEffectiveGrants(grants: readonly string[]): boolean {
  if (grants.length > MAX_GRANT_ITEMS) return false;
  const seen = new Set<string>();
  for (const g of grants) {
    if (!VALID_CAPABILITIES.has(g as Capability)) return false; // unknown capability
    if (seen.has(g)) return false; // duplicate
    seen.add(g);
  }
  return true;
}

// ─── validateManifest（手写 fail-closed 校验） ────────────────────────
// 语义对齐契约 schema：required 字段 + additionalProperties: false +
// 封闭枚举 + semver 模式 + 铁律 #5 data 策略约束。

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const DATA_CLASSES: ReadonlySet<string> = new Set([
  'cache',
  'ephemeral',
  'user-authored',
  'derived-user-visible',
  'relationship',
  'interaction-history',
]);
const DATA_STRATEGIES: ReadonlySet<string> = new Set(['lifecycle', 'retained', 'ask-on-uninstall']);
const TRANSPORTS: ReadonlySet<string> = new Set(['stdio', 'ipc', 'builtin']);

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errors(...items: ManifestValidationError[]): ManifestValidationResult {
  return { valid: false, errors: items };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 校验一个 PluginFeature（/features/N） */
function validateFeature(value: unknown, instancePath: string, out: ManifestValidationError[]): void {
  if (!isObject(value)) {
    out.push({ instancePath, schemaPath: '#/properties/features/items', keyword: 'type', message: 'must be an object' });
    return;
  }
  const allowed = new Set(['id', 'name', 'resources', 'capabilities']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      out.push({ instancePath: `${instancePath}/${key}`, schemaPath: '#/properties/features/items/additionalProperties', keyword: 'additionalProperties', message: 'must NOT have additional properties' });
    }
  }
  if (!nonEmptyString(value.id)) {
    out.push({ instancePath: `${instancePath}/id`, schemaPath: '#/properties/features/items/required', keyword: 'required', message: "must have required property 'id'" });
  }
  if (!nonEmptyString(value.name)) {
    out.push({ instancePath: `${instancePath}/name`, schemaPath: '#/properties/features/items/required', keyword: 'required', message: "must have required property 'name'" });
  }
  if (!Array.isArray(value.resources)) {
    out.push({ instancePath: `${instancePath}/resources`, schemaPath: '#/properties/features/items/required', keyword: 'required', message: "must have required property 'resources'" });
  } else {
    value.resources.forEach((resource, index) => {
      if (!isObject(resource) || !nonEmptyString(resource.type) || !nonEmptyString(resource.id)) {
        out.push({ instancePath: `${instancePath}/resources/${index}`, schemaPath: '#/properties/features/items/properties/resources/items', keyword: 'required', message: 'must have non-empty type and id' });
      }
    });
  }
  if (!Array.isArray(value.capabilities)) {
    out.push({ instancePath: `${instancePath}/capabilities`, schemaPath: '#/properties/features/items/required', keyword: 'required', message: "must have required property 'capabilities'" });
  } else {
    value.capabilities.forEach((capability, index) => {
      if (!VALID_CAPABILITIES.has(capability as Capability)) {
        out.push({ instancePath: `${instancePath}/capabilities/${index}`, schemaPath: '#/$defs/Capability', keyword: 'enum', message: 'must be a known capability identifier' });
      }
    });
  }
}

/** 校验一个 DataDeclaration（/data/N） */
function validateDataDeclaration(value: unknown, instancePath: string, out: ManifestValidationError[]): void {
  if (!isObject(value)) {
    out.push({ instancePath, schemaPath: '#/properties/data/items', keyword: 'type', message: 'must be an object' });
    return;
  }
  const allowed = new Set(['name', 'dataClass', 'strategy', 'schemaVersion']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      out.push({ instancePath: `${instancePath}/${key}`, schemaPath: '#/properties/data/items/additionalProperties', keyword: 'additionalProperties', message: 'must NOT have additional properties' });
    }
  }
  if (!nonEmptyString(value.name)) {
    out.push({ instancePath: `${instancePath}/name`, schemaPath: '#/properties/data/items/required', keyword: 'required', message: "must have required property 'name'" });
  }
  if (!nonEmptyString(value.dataClass) || !DATA_CLASSES.has(value.dataClass)) {
    out.push({ instancePath: `${instancePath}/dataClass`, schemaPath: '#/$defs/DataClass', keyword: 'enum', message: 'must be a known data class' });
  }
  if (!nonEmptyString(value.strategy) || !DATA_STRATEGIES.has(value.strategy)) {
    out.push({ instancePath: `${instancePath}/strategy`, schemaPath: '#/$defs/DataStrategy', keyword: 'enum', message: 'must be a known data strategy' });
  }
  // 铁律 #5: user-visible data MUST NOT use lifecycle strategy
  if (
    nonEmptyString(value.dataClass) &&
    USER_VISIBLE_DATA_CLASSES.has(value.dataClass as DataClass) &&
    value.strategy === 'lifecycle'
  ) {
    out.push({ instancePath: `${instancePath}/strategy`, schemaPath: '#/$defs/DataDeclaration/allOf/0/then/properties/strategy', keyword: 'enum', message: 'user-visible data must be retained or ask-on-uninstall' });
  }
}

/** 校验 runtime（/runtime） */
function validateRuntime(value: unknown, out: ManifestValidationError[]): void {
  const instancePath = '/runtime';
  if (!isObject(value)) {
    out.push({ instancePath, schemaPath: '#/properties/runtime', keyword: 'type', message: 'must be an object' });
    return;
  }
  const allowed = new Set(['transport', 'entrypoint']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      out.push({ instancePath: `${instancePath}/${key}`, schemaPath: '#/properties/runtime/additionalProperties', keyword: 'additionalProperties', message: 'must NOT have additional properties' });
    }
  }
  if (!nonEmptyString(value.transport) || !TRANSPORTS.has(value.transport)) {
    out.push({ instancePath: `${instancePath}/transport`, schemaPath: '#/$defs/RuntimeTransport', keyword: 'enum', message: 'must be stdio, ipc or builtin' });
    return;
  }
  if (value.transport === 'builtin') {
    if (value.entrypoint !== undefined && !nonEmptyString(value.entrypoint)) {
      out.push({ instancePath: `${instancePath}/entrypoint`, schemaPath: '#/$defs/BuiltinRuntimeDeclaration/properties/entrypoint', keyword: 'minLength', message: 'must be a non-empty string when present' });
    }
    return;
  }
  if (!nonEmptyString(value.entrypoint)) {
    out.push({ instancePath: `${instancePath}/entrypoint`, schemaPath: '#/$defs/ExternalRuntimeDeclaration/required', keyword: 'required', message: "must have required property 'entrypoint'" });
  }
}

/**
 * Validates an untrusted plugin manifest against the contract-owned shape.
 * Fail-closed: unknown fields are rejected; unknown capabilities are rejected.
 */
export function validateManifest(value: unknown): ManifestValidationResult {
  const out: ManifestValidationError[] = [];

  if (!isObject(value)) {
    return errors({ instancePath: '', schemaPath: '#/type', keyword: 'type', message: 'must be an object' });
  }

  // additionalProperties: false at root
  const rootAllowed = new Set(['pluginId', 'version', 'contractVersion', 'name', 'description', 'features', 'data', 'runtime']);
  for (const key of Object.keys(value)) {
    if (!rootAllowed.has(key)) {
      out.push({ instancePath: `/${key}`, schemaPath: '#/additionalProperties', keyword: 'additionalProperties', message: 'must NOT have additional properties' });
    }
  }

  if (!nonEmptyString(value.pluginId)) {
    out.push({ instancePath: '/pluginId', schemaPath: '#/required', keyword: 'required', message: "must have required property 'pluginId'" });
  }
  if (!nonEmptyString(value.version) || !SEMVER_PATTERN.test(value.version)) {
    out.push({ instancePath: '/version', schemaPath: '#/$defs/SemVer', keyword: 'pattern', message: 'must be a valid semver version' });
  }
  if (!nonEmptyString(value.contractVersion) || !SEMVER_PATTERN.test(value.contractVersion)) {
    out.push({ instancePath: '/contractVersion', schemaPath: '#/$defs/SemVer', keyword: 'pattern', message: 'must be an exact published semver version' });
  }
  if (!nonEmptyString(value.name)) {
    out.push({ instancePath: '/name', schemaPath: '#/required', keyword: 'required', message: "must have required property 'name'" });
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    out.push({ instancePath: '/description', schemaPath: '#/properties/description', keyword: 'type', message: 'must be a string' });
  }
  if (!Array.isArray(value.features) || value.features.length < 1) {
    out.push({ instancePath: '/features', schemaPath: '#/properties/features', keyword: 'minItems', message: 'must be a non-empty array' });
  } else {
    value.features.forEach((feature, index) => validateFeature(feature, `/features/${index}`, out));
  }
  if (value.data !== undefined) {
    if (!Array.isArray(value.data)) {
      out.push({ instancePath: '/data', schemaPath: '#/properties/data', keyword: 'type', message: 'must be an array' });
    } else {
      value.data.forEach((declaration, index) => validateDataDeclaration(declaration, `/data/${index}`, out));
    }
  }
  validateRuntime(value.runtime, out);

  if (out.length > 0) return errors(...out);

  const manifest = value as unknown as PluginManifest;
  return { valid: true, manifest, errors: [] };
}
