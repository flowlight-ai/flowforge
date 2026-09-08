/**
 * Connector Gateway Bootstrap — framework body (B7)
 *
 * Wires all connector gateway components together from injected dependencies.
 * Decoupled from any external IM platform SDK/credentials: adapters, mention
 * patterns, media handling and voice resolution are all injected by the host.
 *
 * Bootstrap pattern:
 * - Takes options with dependencies
 * - Checks env config before starting
 * - Returns lifecycle handle { stop }
 */

import type { CatId, ConnectorSource, RichBlock } from '@flowforge/cats-shared';
import type { ConnectorRedisClient, Logger } from './connector-redis-client';
import { ConnectorCommandLayer, type ConnectorCommandLayerDeps } from './connector-command-layer';
import { type IConnectorPermissionStore, MemoryConnectorPermissionStore, RedisConnectorPermissionStore } from './connector-permission-store';
import { ConnectorRouter, type SocketManager } from './connector-router';
import {
  type IConnectorThreadBindingStore,
  MemoryConnectorThreadBindingStore,
  RedisConnectorThreadBindingStore,
} from './connector-thread-binding-store';
import {
  type IStreamableOutboundAdapter,
  type IOutboundAdapter,
  OutboundDeliveryHook,
} from './outbound-delivery-hook';
import { StreamingOutboundHook } from './streaming-outbound-hook';
import { InboundMessageDedup } from './inbound-message-dedup';
import type { ConnectorCommandRegistry } from './connector-command-helpers';

export interface ConnectorGatewayConfig {
  /** Override co-creator userId for connector threads (DEFAULT_OWNER_USER_ID). */
  coCreatorUserId?: string | undefined;
}

export interface ConnectorGatewayDeps {
  readonly messageStore: {
    append(input: {
      threadId: string;
      userId: string;
      catId: null;
      content: string;
      source: ConnectorSource;
      mentions: CatId[];
      timestamp: number;
    }): Promise<{ id: string }>;
    getById?(id: string): Promise<{ source?: ConnectorSource } | null>;
    getByThreadBefore?(
      threadId: string,
      timestamp: number,
      limit?: number,
    ):
      | Array<{ catId: string | null; userId?: string; content: string; timestamp: number }>
      | Promise<Array<{ catId: string | null; userId?: string; content: string; timestamp: number }>>;
  };
  readonly threadStore: ConnectorGatewayDepsThreadStore;
  /** Phase D: optional backlog store for feat-number matching in /use */
  readonly backlogStore?: {
    get(
      itemId: string,
      userId?: string,
    ): { tags: readonly string[] } | null | Promise<{ tags: readonly string[] } | null>;
  };
  readonly invokeTrigger: {
    trigger(
      threadId: string,
      catId: CatId,
      userId: string,
      message: string,
      messageId: string,
      ...args: unknown[]
    ): Promise<'dispatched' | 'enqueued' | 'full'>;
  };
  readonly socketManager?: SocketManager | undefined;
  readonly defaultUserId: string;
  readonly defaultCatId: CatId | (() => CatId);
  readonly redis?: ConnectorRedisClient | undefined;
  readonly log: Logger;
  readonly frontendBaseUrl?: string | undefined;
  /** F142: agent service registry for /cats command */
  readonly agentRegistry?: { has(catId: string): boolean };
  /** F142-B: unified command registry for /commands listing + audit */
  readonly commandRegistry?: ConnectorCommandRegistry;
  /** F142: shared binding store — if provided, gateway reuses it instead of creating a new instance */
  readonly bindingStore?: IConnectorThreadBindingStore;
  /** F142: cat roster for display names + availability. Keys = catIds. */
  readonly catRoster?: Record<string, { displayName: string; available?: boolean }>;
  /** F154: cat registry for /focus + /ask cat-name resolution. Optional, injected. */
  readonly catRegistry?: import('@flowforge/cats-shared').CatRegistry;
  /** @-mention patterns for mention resolution, keyed by catId. Injected (no CatRegistry coupling). */
  readonly mentionPatterns?: Map<string, string[]>;
  /** Outbound adapters, keyed by connectorId. Injected by host after adapter creation. */
  readonly adapters: Map<string, IOutboundAdapter>;
  /** Streamable subset of `adapters` (sendPlaceholder + editMessage). Optional: derived automatically. */
  readonly streamableAdapters?: Map<string, IStreamableOutboundAdapter>;
  /** Resolve a route URL (e.g. /uploads/x.png) to an absolute file path on disk. */
  readonly mediaPathResolver?: ((url: string) => string | undefined) | undefined;
  /** Look up a stored message by ID to retrieve its source.sender for @sender replies. */
  readonly messageLookup?:
    | ((messageId: string) => Promise<{ source?: { sender?: { id: string; name?: string } } } | null>)
    | undefined;
  /** Resolve audio blocks with text but no url (voiceMode frontend-only blocks) by synthesizing TTS. */
  readonly resolveVoiceBlocks?: ((blocks: RichBlock[], catId: string) => Promise<RichBlock[]>) | undefined;
  /** Optional physical embodiment fanout, downstream of Limb policy/lease/audit. */
  readonly limbDelivery?:
    | {
        deliver(threadId: string, content: string, catId?: CatId, triggerMessageId?: string): Promise<void>;
      }
    | undefined;
  /** Display-name lookup for a catId (e.g. for the identity header). Optional. */
  readonly catLookup?: ((catId: string) => { displayName: string } | undefined) | undefined;
}

/** Thread-store facade the gateway wires into the command layer + router. */
export interface ConnectorGatewayDepsThreadStore {
  create(userId: string, title?: string): { id: string } | Promise<{ id: string }>;
  get(id: string):
    | {
        id: string;
        title?: string | null;
        createdAt?: number;
        preferredCats?: string[];
        connectorHubState?: {
          v: 1;
          connectorId: string;
          externalChatId: string;
          createdAt: number;
          lastCommandAt?: number;
        };
      }
    | null
    | Promise<{
        id: string;
        title?: string | null;
        createdAt?: number;
        preferredCats?: string[];
        connectorHubState?: {
          v: 1;
          connectorId: string;
          externalChatId: string;
          createdAt: number;
          lastCommandAt?: number;
        };
      } | null>;
  list(
    userId: string,
  ):
    | Array<{ id: string; title?: string | null; lastActiveAt?: number; backlogItemId?: string }>
    | Promise<Array<{ id: string; title?: string | null; lastActiveAt?: number; backlogItemId?: string }>>;
  updateConnectorHubState(
    threadId: string,
    state: { v: 1; connectorId: string; externalChatId: string; createdAt: number; lastCommandAt?: number } | null,
  ): void | Promise<void>;
  updatePreferredCats?(threadId: string, catIds: string[]): void | Promise<void>;
  /** F142: participant activity for /cats and /status */
  getParticipantsWithActivity?(
    threadId: string,
  ):
    | Array<{ catId: string; lastMessageAt: number; messageCount: number }>
    | Promise<Array<{ catId: string; lastMessageAt: number; messageCount: number }>>;
}

export interface ConnectorGatewayHandle {
  /** Credential-free lifecycle diagnostic for the initial preconfigured-source resolution. */
  readonly preconfiguredAutostartStatus: PreconfiguredConnectorAutostartStatus;
  /** Inbound message router (bind/dedup/route/trigger). Host calls `route()` per webhook. */
  readonly router: ConnectorRouter;
  readonly outboundHook: OutboundDeliveryHook;
  readonly streamingHook: StreamingOutboundHook;
  readonly permissionStore: IConnectorPermissionStore;
  /** Live outbound adapters, keyed by connectorId. */
  readonly adapterRegistry: ReadonlyMap<string, IOutboundAdapter>;
  stop(): Promise<void>;
}

export type ConnectorAutostartEnv = {
  readonly [key: string]: string | undefined;
  readonly CONNECTOR_GATEWAY_AUTOSTART?: string | undefined;
};

export interface ConnectorGatewayStartOptions {
  /**
   * Test seam for the launching-process environment. Production callers omit
   * this so the final resolver reads the real process-level lifecycle decision.
   */
  readonly autostartEnv?: ConnectorAutostartEnv;
}

function parseBooleanOverride(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

export function isPreconfiguredConnectorAutostartEnabled(env: ConnectorAutostartEnv = process.env): boolean {
  return parseBooleanOverride(env.CONNECTOR_GATEWAY_AUTOSTART) === true;
}

export type PreconfiguredConnectorAutostartStatus =
  | 'enabled'
  | 'disabled-no-credentials'
  | 'disabled-credentials-suppressed';

const PRECONFIGURED_CONNECTOR_CREDENTIAL_FIELDS = [
  'coCreatorUserId',
] as const satisfies readonly (keyof ConnectorGatewayConfig)[];

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasConfigCredentials(config: ConnectorGatewayConfig): boolean {
  return PRECONFIGURED_CONNECTOR_CREDENTIAL_FIELDS.some((field) => hasText(config[field]));
}

export function classifyPreconfiguredConnectorAutostart(
  config: ConnectorGatewayConfig,
  env: ConnectorAutostartEnv = process.env,
  additionalCredentialSourcesPresent = false,
): PreconfiguredConnectorAutostartStatus {
  if (isPreconfiguredConnectorAutostartEnabled(env)) return 'enabled';

  const hasCredentials = additionalCredentialSourcesPresent || hasConfigCredentials(config);
  return hasCredentials ? 'disabled-credentials-suppressed' : 'disabled-no-credentials';
}

/**
 * Start the connector gateway framework.
 *
 * Wires the in-scope (framework-body) components — binding store, dedup,
 * permission store, command layer, router, outbound + streaming hooks — from
 * injected dependencies. Platform adapters are supplied by the host and
 * registered into `deps.adapters`.
 */
export async function startConnectorGateway(
  config: ConnectorGatewayConfig,
  deps: ConnectorGatewayDeps,
  options: ConnectorGatewayStartOptions = {},
): Promise<ConnectorGatewayHandle> {
  const { log } = deps;
  const autostartEnv = options.autostartEnv ?? process.env;

  const bindingStore =
    deps.bindingStore ??
    (deps.redis ? new RedisConnectorThreadBindingStore(deps.redis) : new MemoryConnectorThreadBindingStore());
  const dedup = new InboundMessageDedup();
  log.info({ store: deps.redis ? 'redis' : 'memory' }, '[ConnectorGateway] Binding store initialized');

  const permissionStore: IConnectorPermissionStore = deps.redis
    ? new RedisConnectorPermissionStore(deps.redis)
    : new MemoryConnectorPermissionStore();

  const commandLayerDeps: ConnectorCommandLayerDeps = {
    bindingStore,
    threadStore: deps.threadStore,
    ...(deps.backlogStore ? { backlogStore: deps.backlogStore } : {}),
    frontendBaseUrl: deps.frontendBaseUrl ?? 'http://localhost:3003',
    permissionStore,
    ...(deps.threadStore.getParticipantsWithActivity
      ? { participantStore: { getParticipantsWithActivity: deps.threadStore.getParticipantsWithActivity } }
      : {}),
    ...(deps.agentRegistry ? { agentRegistry: deps.agentRegistry } : {}),
    ...(deps.catRoster ? { catRoster: deps.catRoster } : {}),
    ...(deps.commandRegistry ? { commandRegistry: deps.commandRegistry } : {}),
    ...(deps.catRegistry ? { catRegistry: deps.catRegistry } : {}),
    ...(deps.messageStore.getByThreadBefore
      ? {
          messageStore: {
            getByThreadBefore: (threadId: string, timestamp: number, limit?: number) =>
              deps.messageStore.getByThreadBefore!(threadId, timestamp, limit),
          },
        }
      : {}),
  };
  const commandLayer = new ConnectorCommandLayer(commandLayerDeps);

  const connectorRouter = new ConnectorRouter({
    bindingStore,
    dedup,
    messageStore: deps.messageStore,
    threadStore: deps.threadStore,
    invokeTrigger: deps.invokeTrigger,
    socketManager: deps.socketManager,
    defaultUserId: deps.defaultUserId,
    defaultCatId: deps.defaultCatId,
    log,
    commandLayer,
    permissionStore,
    adapters: deps.adapters,
    ...(deps.mentionPatterns ? { mentionPatterns: deps.mentionPatterns } : {}),
  });

  const messageLookup = deps.messageLookup;
  const outboundHook = new OutboundDeliveryHook({
    bindingStore,
    adapters: deps.adapters,
    log,
    ...(deps.mediaPathResolver ? { mediaPathResolver: deps.mediaPathResolver } : {}),
    ...(messageLookup ? { messageLookup } : {}),
    ...(deps.resolveVoiceBlocks ? { resolveVoiceBlocks: deps.resolveVoiceBlocks } : {}),
    ...(deps.limbDelivery ? { limbDelivery: deps.limbDelivery } : {}),
    ...(deps.catLookup ? { catLookup: deps.catLookup } : {}),
  });

  const streamableAdapters = deps.streamableAdapters ?? new Map<string, IStreamableOutboundAdapter>();
  if (!deps.streamableAdapters) {
    for (const [id, adapter] of deps.adapters) {
      if ('sendPlaceholder' in adapter && 'editMessage' in adapter) {
        streamableAdapters.set(id, adapter as IStreamableOutboundAdapter);
      }
    }
  }

  const streamingHook = new StreamingOutboundHook({
    bindingStore,
    adapters: streamableAdapters,
    log,
    receiptOnlyUntilCommit: true,
    ...(deps.catLookup ? { catLookup: deps.catLookup } : {}),
  });

  return {
    preconfiguredAutostartStatus: classifyPreconfiguredConnectorAutostart(config, autostartEnv),
    router: connectorRouter,
    outboundHook,
    streamingHook,
    permissionStore,
    adapterRegistry: deps.adapters,
    async stop() {
      log.info('[ConnectorGateway] Stopped');
    },
  };
}