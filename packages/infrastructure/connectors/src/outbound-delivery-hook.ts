import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatId, RichBlock } from '@flowforge/cats-shared';
import type { Logger } from './connector-redis-client';

import { ConnectorMessageFormatter, type MessageEnvelope, type MessageOrigin } from './connector-message-formatter';
import type { IConnectorThreadBindingStore } from './connector-thread-binding-store';
import { renderAllRichBlocksPlaintext } from './rich-block-plaintext';

export interface IOutboundAdapter {
  readonly connectorId: string;
  sendReply(externalChatId: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  sendRichMessage?(
    externalChatId: string,
    textContent: string,
    blocks: RichBlock[],
    catDisplayName: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  sendFormattedReply?(
    externalChatId: string,
    envelope: MessageEnvelope,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  /** Phase 5: Send a media message (image, file, audio). */
  sendMedia?(
    externalChatId: string,
    payload: { type: 'image' | 'file' | 'audio'; [key: string]: unknown },
  ): Promise<void>;
  /** F151: Delivery batch complete. `chainDone=true` = no more output for this task; send close frame. */
  onDeliveryBatchDone?(externalChatId: string, chainDone: boolean): Promise<void>;
  /** F157: Add an emoji reaction to a message (e.g. ❤️ on user's message as instant ack). */
  addReaction?(platformMessageId: string, emojiType: string): Promise<void>;
}

/** Adapter that supports edit-in-place streaming (placeholder → progressive edits). */
export interface IStreamableOutboundAdapter extends IOutboundAdapter {
  /** Send a placeholder message and return its platform-level message ID. */
  sendPlaceholder(externalChatId: string, text: string): Promise<string>;
  /** Edit an already-sent message in place. */
  editMessage(externalChatId: string, platformMessageId: string, text: string): Promise<void>;
  /**
   * Delete a message by platform message ID (cleanup after streaming).
   * externalChatId should be provided by callers that have it, because some
   * platform message_ids are only unique within a single chat.
   */
  deleteMessage?(platformMessageId: string, externalChatId?: string): Promise<void>;
  /**
   * F157: Edit a streaming placeholder to a minimal completion state (e.g. "✅ 已回复").
   * When present, cleanup prefers this over deleteMessage to avoid "recall" notifications.
   */
  finalizeStreamCard?(externalChatId: string, platformMessageId: string, catDisplayName: string): Promise<void>;
  /**
   * K2: Register a pending inline-final placeholder.
   * The next sendReply/sendRichMessage to this chatId will edit this placeholder
   * instead of sending a new message. Consumed on first use.
   */
  registerInlinePlaceholder?(externalChatId: string, platformMessageId: string): void;
  /**
   * K2: Clear a registered inline-final placeholder without delivering content.
   * Called by StreamingOutboundHook.cleanupPlaceholders when delivery is skipped.
   */
  clearInlinePlaceholder?(chatId: string, platformMessageId?: string): Promise<void>;
}

export interface ThreadMeta {
  readonly threadShortId: string;
  readonly threadTitle?: string | undefined;
  readonly featId?: string | undefined;
  readonly deepLinkUrl?: string | undefined;
}

export interface OutboundDeliveryHookOptions {
  readonly bindingStore: IConnectorThreadBindingStore;
  readonly adapters: Map<string, IOutboundAdapter>;
  readonly log: Logger;
  /** Resolve a route URL (e.g. /uploads/x.png) to an absolute file path on disk. */
  readonly mediaPathResolver?: ((url: string) => string | undefined) | undefined;
  /** F134: Look up a stored message by ID to retrieve its source.sender for group chat @sender replies. */
  readonly messageLookup?:
    | ((messageId: string) => Promise<{ source?: { sender?: { id: string; name?: string } } } | null>)
    | undefined;
  /** Resolve audio blocks with text but no url (voiceMode frontend-only blocks) by synthesizing TTS. */
  readonly resolveVoiceBlocks?: ((blocks: RichBlock[], catId: string) => Promise<RichBlock[]>) | undefined;
  /** Optional physical embodiment fanout. It remains downstream of Limb policy/lease/audit. */
  readonly limbDelivery?:
    | {
        deliver(threadId: string, content: string, catId?: CatId, triggerMessageId?: string): Promise<void>;
      }
    | undefined;
  /** Display-name lookup for a catId (e.g. for the identity header). Optional; defaults to empty. */
  readonly catLookup?: ((catId: string) => { displayName: string } | undefined) | undefined;
}

export class OutboundDeliveryHook {
  private readonly formatter = new ConnectorMessageFormatter();

  constructor(private readonly opts: OutboundDeliveryHookOptions) {}

  setLimbDelivery(delivery: NonNullable<OutboundDeliveryHookOptions['limbDelivery']>): void {
    (this.opts as { limbDelivery?: OutboundDeliveryHookOptions['limbDelivery'] }).limbDelivery = delivery;
  }

  /**
   * Return the set of connectorIds bound to a thread.
   * Used by the invocation trigger to detect single-token adapters that require
   * multi-turn content to be merged before delivery.
   */
  async getConnectorIds(threadId: string): Promise<string[]> {
    const bindings = await this.opts.bindingStore.getByThread(threadId);
    return [...new Set(bindings.map((b) => b.connectorId))];
  }

  async deliver(
    threadId: string,
    content: string,
    catId?: CatId,
    richBlocks?: RichBlock[],
    threadMeta?: ThreadMeta,
    origin?: MessageOrigin,
    triggerMessageId?: string,
  ): Promise<void> {
    return this.executeDelivery(threadId, content, catId, richBlocks, threadMeta, origin, triggerMessageId);
  }

  private async executeDelivery(
    threadId: string,
    content: string,
    catId?: CatId,
    richBlocks?: RichBlock[],
    threadMeta?: ThreadMeta,
    origin?: MessageOrigin,
    triggerMessageId?: string,
  ): Promise<void> {
    this.opts.log.info(
      { threadId, catId, contentLen: content.length, hasRichBlocks: !!(richBlocks && richBlocks.length) },
      '[OutboundDeliveryHook] deliver() called',
    );
    const bindings = await this.opts.bindingStore.getByThread(threadId);
    if (bindings.length === 0 && !this.opts.limbDelivery) {
      this.opts.log.warn(
        { threadId },
        '[OutboundDeliveryHook] No bindings found for thread — skipping outbound delivery',
      );
      return;
    }
    if (bindings.length > 0) {
      this.opts.log.info(
        { threadId, bindingCount: bindings.length, connectors: bindings.map((b) => b.connectorId) },
        '[OutboundDeliveryHook] Found bindings, delivering',
      );
    }

    // F134: Resolve sender from the trigger message for group chat @sender replies
    let replyToSender: { id: string; name?: string } | undefined;
    if (triggerMessageId && this.opts.messageLookup) {
      try {
        const msg = await this.opts.messageLookup(triggerMessageId);
        replyToSender = msg?.source?.sender ?? undefined;
      } catch (err) {
        this.opts.log.warn({ err, triggerMessageId }, '[OutboundDeliveryHook] messageLookup failed');
      }
    }

    const entry = catId ? this.opts.catLookup?.(catId) : undefined;
    const catDisplayName = entry?.displayName ?? '';
    const catEmoji = '🐱';
    const textPrefix = catDisplayName ? `【${catDisplayName}🐱】\n` : '';
    const finalContent = `${textPrefix}${content}`;

    // Resolve audio blocks that have text but no url (voiceMode frontend-only blocks).
    let resolvedBlocks = richBlocks;
    const hasUnresolvedAudio = resolvedBlocks?.some(
      (b) => b.kind === 'audio' && 'text' in b && (!('url' in b) || !b.url),
    );
    if (hasUnresolvedAudio && this.opts.resolveVoiceBlocks && catId) {
      try {
        resolvedBlocks = await this.opts.resolveVoiceBlocks(resolvedBlocks!, catId);
      } catch (err) {
        this.opts.log.warn({ err }, '[OutboundDeliveryHook] resolveVoiceBlocks failed — degrading to text');
      }
    }
    // Fallback: convert any remaining audio-without-url to plaintext-renderable blocks
    if (resolvedBlocks?.some((b) => b.kind === 'audio' && 'text' in b && (!('url' in b) || !b.url))) {
      resolvedBlocks = resolvedBlocks.map((b) => {
        if (b.kind === 'audio' && 'text' in b && (!('url' in b) || !b.url)) {
          return {
            id: b.id,
            kind: 'card' as const,
            v: 1 as const,
            title: '🔊 语音',
            bodyMarkdown: b.text as string,
          } as RichBlock;
        }
        return b;
      });
    }
    // After resolve + fallback, normalize to a concrete array so TS narrows downstream.
    const finalBlocks = resolvedBlocks ?? [];
    const hasRichBlocks = finalBlocks.length > 0;
    const outMeta = replyToSender ? { replyToSender } : undefined;

    await Promise.allSettled(
      bindings.map(async (binding) => {
        const adapter = this.opts.adapters.get(binding.connectorId);
        if (!adapter) {
          this.opts.log.warn({ connectorId: binding.connectorId }, 'No adapter registered for connector');
          return;
        }
        try {
          // Phase E: Always prefer sendFormattedReply (interactive card) when adapter supports it.
          if (adapter.sendFormattedReply && !hasRichBlocks) {
            const envelope = threadMeta
              ? this.formatter.format({
                  catDisplayName: catDisplayName || 'Cat',
                  catEmoji,
                  threadShortId: threadMeta.threadShortId,
                  threadTitle: threadMeta.threadTitle,
                  featId: threadMeta.featId,
                  body: content,
                  deepLinkUrl: threadMeta.deepLinkUrl,
                  timestamp: new Date(),
                  origin,
                })
              : this.formatter.formatMinimal({
                  catDisplayName: catDisplayName || 'Cat',
                  catEmoji,
                  body: content,
                  ...(origin ? { origin } : {}),
                });
            await adapter.sendFormattedReply(binding.externalChatId, envelope, outMeta);
          } else if (hasRichBlocks && adapter.sendRichMessage) {
            await adapter.sendRichMessage(
              binding.externalChatId,
              content,
              finalBlocks,
              catDisplayName || 'Cat',
              outMeta,
            );
          } else if (
            hasRichBlocks &&
            adapter.sendMedia &&
            finalBlocks.some((b) => b.kind === 'audio' || b.kind === 'file' || b.kind === 'media_gallery')
          ) {
            // Media-capable adapter without sendRichMessage (e.g. WeChat):
            // Render non-media blocks as plaintext alongside text content.
            const nonMediaBlocks = finalBlocks.filter(
              (b) => b.kind !== 'audio' && b.kind !== 'file' && b.kind !== 'media_gallery',
            );
            const blockText = nonMediaBlocks.length > 0 ? renderAllRichBlocksPlaintext(nonMediaBlocks) : '';
            const textToSend = blockText ? `${finalContent}\n\n${blockText}` : finalContent;
            if (textToSend) {
              await adapter.sendReply(binding.externalChatId, textToSend, outMeta);
            }
            // Media blocks sent below in Phase 5/6/J
          } else if (hasRichBlocks) {
            // Fallback for adapters without sendMedia: render blocks as plaintext
            const blockText = renderAllRichBlocksPlaintext(finalBlocks);
            await adapter.sendReply(binding.externalChatId, `${finalContent}\n\n${blockText}`, outMeta);
          } else {
            await adapter.sendReply(binding.externalChatId, finalContent, outMeta);
          }

          // Phase 6: Send audio blocks with url as media messages
          // Phase 5: Send media_gallery image items as image messages
          if (hasRichBlocks && adapter.sendMedia) {
            const resolve = this.opts.mediaPathResolver;
            for (const block of finalBlocks) {
              if (block.kind === 'audio' && 'url' in block && block.url) {
                const absPath = resolve?.(block.url);
                this.opts.log.info(
                  { blockKind: block.kind, url: block.url, absPath: absPath ?? null, hasResolver: !!resolve },
                  '[OutboundDeliveryHook] Phase 6: sending audio block',
                );
                await adapter.sendMedia(binding.externalChatId, {
                  type: 'audio',
                  url: block.url,
                  ...(absPath ? { absPath } : {}),
                  ...('text' in block && block.text ? { text: block.text as string } : {}),
                });
              }
              // Phase J: Send file blocks as file messages
              // P0 security: file blocks MUST resolve to absPath — never pass raw url to adapter.
              if (block.kind === 'file' && 'url' in block && block.url) {
                const fileUrl = block.url as string;
                const absPath = resolve?.(fileUrl);
                const fileName = 'fileName' in block ? (block.fileName as string) : undefined;
                if (absPath) {
                  this.opts.log.info(
                    { blockKind: block.kind, url: fileUrl, absPath, fileName },
                    '[OutboundDeliveryHook] Phase J: sending file block',
                  );
                  await adapter.sendMedia(binding.externalChatId, {
                    type: 'file',
                    absPath,
                    ...(fileName ? { fileName } : {}),
                  });
                } else if (fileUrl.startsWith('https://')) {
                  // External HTTPS URLs are safe to pass through (adapter downloads + uploads)
                  this.opts.log.info(
                    { blockKind: block.kind, url: fileUrl, fileName },
                    '[OutboundDeliveryHook] Phase J: sending file block via external URL',
                  );
                  await adapter.sendMedia(binding.externalChatId, {
                    type: 'file',
                    url: fileUrl,
                    ...(fileName ? { fileName } : {}),
                  });
                } else {
                  this.opts.log.warn(
                    { blockKind: block.kind, url: fileUrl },
                    '[OutboundDeliveryHook] Phase J: file block skipped — resolver failed and url is not https',
                  );
                }
              }
              if (block.kind === 'media_gallery' && 'items' in block) {
                const items = (block as { items?: Array<{ url?: string; type?: string }> }).items;
                if (items) {
                  for (const item of items) {
                    if (!item.url) continue;
                    const isImage = !item.type || item.type === 'image';
                    if (!isImage) continue;
                    if (item.url.startsWith('data:')) {
                      const absPath = await this.writeDataUriToTempFile(item.url);
                      if (absPath) {
                        try {
                          await adapter.sendMedia(binding.externalChatId, { type: 'image', absPath });
                        } finally {
                          await unlink(absPath).catch(() => {});
                        }
                      }
                    } else {
                      const absPath = resolve?.(item.url);
                      if (absPath) {
                        await adapter.sendMedia(binding.externalChatId, { type: 'image', absPath });
                      } else if (item.url.startsWith('https://')) {
                        // External HTTPS URL: adapter can download + upload to platform
                        await adapter.sendMedia(binding.externalChatId, {
                          type: 'image',
                          url: item.url,
                        });
                      } else if (item.url.startsWith('/uploads/') || item.url.startsWith('/api/connector-media/')) {
                        // Internal route URL — resolver failed (file not found or resolver not configured).
                        this.opts.log.warn(
                          { blockKind: block.kind, url: item.url, hasResolver: !!resolve },
                          '[OutboundDeliveryHook] media_gallery image skipped — local file not found (resolver returned undefined)',
                        );
                      } else {
                        this.opts.log.warn(
                          { blockKind: block.kind, url: item.url },
                          '[OutboundDeliveryHook] media_gallery image skipped — resolver failed and url is not https',
                        );
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          this.opts.log.error(
            {
              err,
              connectorId: binding.connectorId,
              externalChatId: binding.externalChatId,
            },
            'Outbound delivery failed',
          );
        }
      }),
    );

    if (this.opts.limbDelivery) {
      try {
        await this.opts.limbDelivery.deliver(threadId, content, catId, triggerMessageId);
      } catch (err) {
        this.opts.log.error({ err, threadId, catId }, 'Physical limb outbound delivery failed');
      }
    }
  }

  private async writeDataUriToTempFile(dataUri: string): Promise<string | null> {
    const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!match) return null;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2]!, 'base64');
    const filePath = join(tmpdir(), `flowforge-img-${randomBytes(8).toString('hex')}.${ext}`);
    await writeFile(filePath, buffer);
    return filePath;
  }
}