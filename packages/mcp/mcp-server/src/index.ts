/**
 * @flowforge/mcp-server — self-contained MCP server governance framework.
 *
 * Ported from clowder-ai packages/mcp-server (EP1-1a): tool governance
 * certificates, canonical tool registry + projections, surface snapshots,
 * JSON Schema→Zod (v4) conversion, env-driven toolset assembly, callback
 * refresh loop, and a generic protocol server. Self-contained base before the
 * domain-coupled toolsets (EP1-1b) are wired in.
 */

export {
  bindMcpImplementation,
  defineMcpTool,
  defineMigrationCandidateMcpTool,
  deriveSdkAnnotations,
  compareToolRegistries,
  deriveProfileNames,
} from './tool-governance.js';

export type {
  EvidenceRef,
  GovernanceFinding,
  McpActionBoundary,
  McpAuthorizationPath,
  McpImplementationBinding,
  McpMigrationCandidateInput,
  McpOperationContract,
  McpRisk,
  McpRuntimeProfile,
  McpSchemaDeliveryPolicy,
  McpStandaloneReason,
  McpToolDefinition,
  McpToolDefinitionInput,
  McpToolPolicy,
  NonEmptyReadonlyArray,
  ProtectedToolSnapshot,
  ResolvedAdmissionClaim,
  ResolvedEvidenceCatalog,
  ResolvedImplementationCatalog,
  ToolRegistryDelta,
} from './tool-governance-types.js';

export {
  buildCanonicalToolRegistry,
  projectCanonicalToolRegistry,
  projectServerFamily,
  derivedProfileSet,
} from './canonical-tool-registry.js';
export type { CanonicalToolSources, CanonicalToolsetEnv } from './canonical-tool-registry.js';

export { validateToolGovernance } from './tool-governance-validation.js';

export {
  createMcpSurfaceSnapshot,
  compareMcpSurfaceRegistry,
  compareMcpSurfaceProtocol,
  serializeMcpSurfaceSnapshot,
  normalizeMcpInputSchema,
  digestMcpInputSchema,
} from './tool-governance-snapshot.js';
export type {
  McpServerFamily,
  FamilyToolDefinition,
  McpSurfaceSnapshot,
  McpSurfaceSnapshotEntry,
  ProtocolParityFinding,
} from './tool-governance-snapshot.js';

export { jsonSchemaToZod } from './json-schema-to-zod.js';

export {
  parseToolsetEnv,
  applyReadonlyFilter,
  registerTools,
  registerToolset,
  projectSchemaDeliveryMeta,
} from './server-toolsets.js';
export type { ToolsetEnv } from './server-toolsets.js';

export {
  computeNextRefreshDelay,
  handleRefreshFailure,
  performRefreshTick,
  installShutdownHandlers,
  startRefreshLoop,
} from './refresh-loop.js';
export type { RefreshTickResult, RefreshLoopHandle, ShutdownProcess } from './refresh-loop.js';

export { setCallbackConfig, getCallbackConfig, buildAuthHeaders } from './callback-config.js';
export type { CallbackConfig } from './callback-config.js';
export { CALLBACK_AUTH_FAILURE_REASONS, isCallbackAuthFailureReason } from './callback-types.js';
export type { CallbackAuthFailureReason } from './callback-types.js';

export { errorResult, successResult } from './tool-result.js';
export type { ToolResult } from './tool-result.js';
export {
  createProtocolTools,
  buildProviderFromEnv,
  buildCredentialsFromEnv,
  isImageOutputCapability,
  deriveMimeType,
  deriveFileName,
} from './protocol-tools.js';
export type { ProtocolToolConfig, ToolExtra } from './protocol-tools.js';
export { startProtocolServer, buildProtocolToolConfig } from './protocol-server.js';

export {
  loadProtocolsFromDir,
  loadProtocolTemplate,
  clearTemplateCache,
  submit,
  poll,
  execute,
  scrubCredentials,
  buildSecretsList,
  getAuthStrategy,
  renderTemplate,
  renderBody,
  extractString,
  extractJsonPath,
  ProtocolTemplateSchema,
} from './protocol-engine/index.js';
export type {
  AuthResult,
  AuthStrategy,
  AuthType,
  ExecutionParams,
  PollResult,
  ProtocolTemplate,
  ProviderInstance,
  SubmitResult,
  SyncResult,
  TaskStatus,
  Capability,
  Endpoint,
  PollEndpoint,
  ResponseMapping,
} from './protocol-engine/types.js';