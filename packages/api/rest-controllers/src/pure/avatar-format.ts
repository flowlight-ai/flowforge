/**
 * Avatar upload format guards (B21 assets; ported from clowder-ai
 * `packages/api/src/routes/avatars.ts` + `packages/shared/src/avatar-limits.ts`).
 *
 * Self-contained, dependency-free: magic-byte sniffing, declared-vs-detected
 * mimetype agreement, extension mapping and the raw file size limit. These live
 * in `pure/` so they are unit-testable without an HTTP framework.
 *
 * The flowforge contract layer is JSON-only (no multipart), so uploads arrive as
 * base64 image payloads; the byte-level sniffing below is unchanged ground truth
 * and does not trust any client-declared mimetype.
 */

/** Hard raw-file ceiling for a single avatar upload. */
export const AVATAR_RAW_FILE_LIMIT_BYTES = 10 * 1024 * 1024;

/** Accepted image container formats (mirrors clowder `ACCEPTED_IMAGE_MIME`). */
export const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME)[number];

export function isAcceptedMime(mime: string): mime is AcceptedImageMime {
  return (ACCEPTED_IMAGE_MIME as readonly string[]).includes(mime);
}

/** Map a detected/accepted mime to its on-disk extension (jpeg → jpg). */
export function extForMime(mime: AcceptedImageMime): string {
  if (mime === 'image/jpeg') return 'jpg';
  return mime.split('/')[1] ?? 'bin';
}

/**
 * Sniff the image container format from the leading magic bytes. Returns the
 * detected MIME or `null` when no supported signature matches. This is the only
 * trusted ground-truth source; mimetype supplied by the client is advisory.
 */
export function detectImageMime(bytes: Uint8Array): AcceptedImageMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Maximum accepted base64 length before decoding (permissive 4/3 overhead). */
export const MAX_BASE64_IMAGE_LENGTH = Math.ceil(AVATAR_RAW_FILE_LIMIT_BYTES * (4 / 3)) + 4;

/**
 * Decode a base64 image payload into bytes. Accepts either a bare base64 string
 * or a `data:image/...;base64,` data-URL prefix. Returns `null` when the payload
 * is not base64 (avoids `node:buffer` throwing on caller-supplied garbage).
 */
export function decodeBase64Image(payload: string): Uint8Array | null {
  let clean = payload;
  if (payload.startsWith('data:')) {
    const comma = payload.indexOf(',');
    if (comma < 0) return null;
    clean = payload.slice(comma + 1);
  }
  const normalized = clean.replace(/\s+/g, '');
  if (normalized.length === 0) return null;
  try {
    return Uint8Array.from(Buffer.from(normalized, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Validate an upload payload shape before the controller touches it. Returns a
 * discriminated result so the controller can map failures to HTTP statuses
 * without repeated try/catch plumbing.
 */
export type UploadParseOutcome =
  | { ok: true; bytes: Uint8Array; declaredMime: string | null }
  | { ok: false; code: 'INVALID_PAYLOAD' | 'NOT_BASE64' }
  | { ok: false; code: 'PAYLOAD_TOO_LARGE'; maxBytes: number };

export function parseAvatarUpload(body: Record<string, unknown> | undefined): UploadParseOutcome {
  const data = body && typeof body['data'] === 'string' ? (body['data'] as string) : null;
  if (!data) return { ok: false, code: 'INVALID_PAYLOAD' };
  if (data.length > AVATAR_RAW_FILE_LIMIT_BYTES && data.length > MAX_BASE64_IMAGE_LENGTH) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE', maxBytes: AVATAR_RAW_FILE_LIMIT_BYTES };
  }
  const bytes = decodeBase64Image(data);
  if (bytes === null) return { ok: false, code: 'NOT_BASE64' };
  if (bytes.length > AVATAR_RAW_FILE_LIMIT_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE', maxBytes: AVATAR_RAW_FILE_LIMIT_BYTES };
  }
  const declaredMime = body && typeof body['mime'] === 'string' ? (body['mime'] as string) : null;
  return { ok: true, bytes, declaredMime };
}