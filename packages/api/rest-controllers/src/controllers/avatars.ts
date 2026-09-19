/**
 * Avatars controller (B21 assets; ported from clowder-ai `routes/avatars.ts`).
 *
 * POST /api/uploads/avatar — upload a persona avatar (JSON/base64, magic-sniffed)
 * GET  /api/avatars        — discover canonical static avatar assets
 *
 * flowforge contract layer is JSON-only (no multipart), so uploads arrive as an
 * object `{ data?: <base64|<data-url>>, mime?: <declared> }`. Ground truth is the
 * server-side magic-byte sniff; a client-declared `mime` (when present) must
 * agree with the sniffed type, exactly as clowder requires. Static persona avatars
 * are packaged as plugin assets; this controller exposes their discoverable
 * manifest (see `avatar-catalog.ts`).
 */

import { RestControllerBase } from '../ports/http.ts';
import { type RequestContextResolver } from '../ports/request-context.ts';
import { type UploadStoreSeam, MemoryUploadStore } from '../ports/upload-store.ts';
import {
  type AcceptedImageMime,
  ACCEPTED_IMAGE_MIME,
  AVATAR_RAW_FILE_LIMIT_BYTES,
  decodeBase64Image,
  detectImageMime,
  extForMime,
  isAcceptedMime,
  parseAvatarUpload,
} from '../pure/avatar-format.ts';
import { staticAvatarAssetNames, isSafeAvatarName } from '../pure/avatar-catalog.ts';

export interface AvatarsControllerOptions {
  /** Persists decoded upload bytes. Defaults to an in-memory store (contract tests). */
  uploadStore?: UploadStoreSeam;
}

export class AvatarsController extends RestControllerBase {
  private readonly uploadStore: UploadStoreSeam;

  constructor(private readonly identity: RequestContextResolver, opts: AvatarsControllerOptions = {}) {
    super();
    this.uploadStore = opts.uploadStore ?? new MemoryUploadStore();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // GET /api/avatars — canonical static persona avatar manifest.
    this.get('/api/avatars', (_req) => {
      const assets = staticAvatarAssetNames();
      return {
        status: 200,
        body: { avatars: assets, assetPathFor: (n: string) => (isSafeAvatarName(n) ? `/avatar-assets/${n}.png` : null) },
      };
    });

    // POST /api/uploads/avatar — base64 avatar upload via the JSON contract layer.
    this.post('/api/uploads/avatar', async (req) => {
      if (this.identity.resolveUserId(req) === null) {
        return { status: 401, body: { error: 'Identity required' } };
      }
      const parsed = parseAvatarUpload(req.body as Record<string, unknown> | undefined);
      if (!parsed.ok) {
        if (parsed.code === 'PAYLOAD_TOO_LARGE') {
          return {
            status: 413,
            body: { error: '头像文件过大', code: parsed.code, maxBytes: parsed.maxBytes },
          };
        }
        return { status: 400, body: { error: 'Invalid avatar payload', code: parsed.code } };
      }

      // Server-side magic sniffing — a client-declared mime is advisory only.
      const detected = detectImageMime(parsed.bytes);
      if (detected === null) {
        return {
          status: 415,
          body: { error: 'File contents do not match a supported image type', code: 'IMAGE_FORMAT_MISMATCH', detected },
        };
      }
      if (parsed.declaredMime !== null && !isAcceptedMime(parsed.declaredMime)) {
        return {
          status: 415,
          body: {
            error: 'Unsupported image type. Allowed: png, jpeg, webp',
            code: 'UNSUPPORTED_MEDIA_TYPE',
            accepted: ACCEPTED_IMAGE_MIME,
            declared: parsed.declaredMime,
          },
        };
      }
      if (parsed.declaredMime !== null && parsed.declaredMime !== detected) {
        return {
          status: 415,
          body: {
            error: 'File contents do not match the declared image type',
            code: 'IMAGE_FORMAT_MISMATCH',
            declared: parsed.declaredMime,
            detected,
          },
        };
      }

      const saved = await this.uploadStore.save({ bytes: parsed.bytes, ext: extForMime(detected as AcceptedImageMime) });
      return { status: 200, body: { url: saved.url } };
    });
  }
}

export { AVATAR_RAW_FILE_LIMIT_BYTES, decodeBase64Image, detectImageMime, extForMime };