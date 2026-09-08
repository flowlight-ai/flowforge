/**
 * @flowforge/infrastructure-connectors — IM connector framework body.
 *
 * Port of clowder-ai `infrastructure/connectors` (framework-body only), the
 * platform-agnostic connector core: thread-binding store (Memory + Redis),
 * permission store (Memory + Redis), inbound dedup, router, command layer +
 * helpers, message formatter, outbound + streaming hooks, mention parsing,
 * rich-block plaintext rendering, external connector registry, gateway
 * bootstrap/lifecycle, and binding-key DSL.
 *
 * Decoupled from any external IM platform SDKs and legacy cat-cafe / fastify
 * dependencies.
 */

export { ConnectorBindingKeys } from './connector-binding-keys';

export type { ConnectorRedisClient, ConnectorRedisPipeline, Logger } from './connector-redis-client';
export { silentLogger } from './connector-redis-client';

export type { IConnectorThreadBindingStore } from './connector-thread-binding-store';
export {
  MemoryConnectorThreadBindingStore,
  RedisConnectorThreadBindingStore,
} from './connector-thread-binding-store';

export type { GroupEntry, PermissionConfig, IConnectorPermissionStore } from './connector-permission-store';
export {
  MemoryConnectorPermissionStore,
  RedisConnectorPermissionStore,
} from './connector-permission-store';

export { InboundMessageDedup } from './inbound-message-dedup';

export type { ParsedMention } from './mention-parser';
export { parseMentions } from './mention-parser';

export { renderRichBlockPlaintext, renderAllRichBlocksPlaintext } from './rich-block-plaintext';

export type { ExternalConnectorMeta } from './external-connector-registry';
export {
  registerExternalConnectorMeta,
  updateExternalConnectorConfigured,
  getAllExternalConnectorMeta,
  unregisterExternalConnectorMeta,
  clearExternalConnectorRegistry,
} from './external-connector-registry';

export type { MessageOrigin, CardAction, MessageEnvelope, FormatInput } from './connector-message-formatter';
export { DEFAULT_QUICK_ACTIONS, ConnectorMessageFormatter } from './connector-message-formatter';

export type { ConnectorCommandRegistry, CommandInfoDeps } from './connector-command-helpers';
export {
  buildThreadDeepLink,
  auditSlashCommand,
  buildCommandsList,
  buildCatsInfo,
  buildStatusInfo,
  matchByListIndex,
  matchByIdPrefix,
  matchByTitle,
  matchByFeatId,
  extractFeatIds,
  resolveFeatBadges,
} from './connector-command-helpers';

export type { CommandResult, ConnectorCommandLayerDeps } from './connector-command-layer';
export { ConnectorCommandLayer } from './connector-command-layer';

export type { SocketManager, RouteResult, ConnectorRouterOptions } from './connector-router';
export { ConnectorRouter } from './connector-router';

export type { IOutboundAdapter, IStreamableOutboundAdapter, ThreadMeta, OutboundDeliveryHookOptions } from './outbound-delivery-hook';
export { OutboundDeliveryHook } from './outbound-delivery-hook';

export type { StreamingOutboundHookOptions } from './streaming-outbound-hook';
export { StreamingOutboundHook } from './streaming-outbound-hook';

export type {
  ConnectorGatewayConfig,
  ConnectorGatewayDeps,
  ConnectorGatewayDepsThreadStore,
  ConnectorGatewayHandle,
  ConnectorAutostartEnv,
  ConnectorGatewayStartOptions,
  PreconfiguredConnectorAutostartStatus,
} from './connector-gateway-bootstrap';
export {
  isPreconfiguredConnectorAutostartEnabled,
  classifyPreconfiguredConnectorAutostart,
  startConnectorGateway,
} from './connector-gateway-bootstrap';

export { restartConnectorGateway } from './connector-gateway-lifecycle';