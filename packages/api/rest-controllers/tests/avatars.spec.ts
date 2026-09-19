/**
 * Avatars controller contract tests (B21 assets).
 * Covers magic-byte sniffing, declared-vs-detected agreement, size limits and
 * the static avatar catalog manifest.
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { AvatarsController } from '../src/controllers/avatars.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';
import { type UploadStoreSeam, MemoryUploadStore } from '../src/ports/upload-store.ts';
import { AVATAR_RAW_FILE_LIMIT_BYTES, detectImageMime } from '../src/pure/avatar-format.ts';
import { STATIC_AVATAR_NAMES } from '../src/pure/avatar-catalog.ts';

function req(method: string, url: string, body?: unknown): HttpRequest {
  return { method, url, headers: { 'x-cat-cafe-user': 'u1' }, ...(body !== undefined ? { body: body as Record<string, unknown> } : {}) };
}

/** Build a Uint8Array with a real PNG magic signature and return its base64. */
function pngBytes(extra = 0): Uint8Array {
  const data = new Uint8Array(8 + extra);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return data;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function make(store?: UploadStoreSeam) {
  return new AvatarsController(new DefaultRequestContextResolver(), store ? { uploadStore: store } : {});
}

describe('detectImageMime (pure)', () => {
  it('detects png / jpeg / webp magic signatures', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectImageMime(webp)).toBe('image/webp');
    expect(detectImageMime(new Uint8Array([0x45, 0x30, 0x30]))).toBeNull();
  });
});

describe('AvatarsController upload', () => {
  it('accepts a valid base64 png and stores it, returning a servant URL', async () => {
    const store = new MemoryUploadStore();
    const controller = make(store);
    const res = await controller.handle(req('POST', '/api/uploads/avatar', { data: base64(pngBytes(16)) }));
    expect(res.status).toBe(200);
    const body = res.body as { url: string };
    expect(body.url).toMatch(/^\/uploads\/avatar-/);
    expect(body.url.endsWith('.png')).toBe(true);
    expect(store.saved).toHaveLength(1);
  });

  it('rejects an oversized payload with 413', async () => {
    const controller = make();
    const big = base64(pngBytes(AVATAR_RAW_FILE_LIMIT_BYTES + 1));
    const res = await controller.handle(req('POST', '/api/uploads/avatar', { data: big }));
    expect(res.status).toBe(413);
    expect((res.body as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects non-image bytes with 415 (no supported signature)', async () => {
    const controller = make();
    const res = await controller.handle(req('POST', '/api/uploads/avatar', { data: base64(new Uint8Array([1, 2, 3, 4])) }));
    expect(res.status).toBe(415);
  });

  it('rejects a declared mime that disagrees with the sniffed type', async () => {
    const controller = make();
    const res = await controller.handle(
      req('POST', '/api/uploads/avatar', { data: base64(pngBytes(8)), mime: 'image/jpeg' }),
    );
    expect(res.status).toBe(415);
    expect((res.body as { code: string }).code).toBe('IMAGE_FORMAT_MISMATCH');
  });

  it('accepts when the declared mime agrees with the sniffed type', async () => {
    const controller = make();
    const res = await controller.handle(req('POST', '/api/uploads/avatar', { data: base64(pngBytes(8)), mime: 'image/png' }));
    expect(res.status).toBe(200);
  });

  it('rejects a malformed payload with 400', async () => {
    const controller = make();
    const res = await controller.handle(req('POST', '/api/uploads/avatar', {}));
    expect(res.status).toBe(400);
  });
});

describe('AvatarsController catalog', () => {
  it('exposes the canonical static avatar manifest', async () => {
    const controller = make();
    const res = await controller.handle(req('GET', '/api/avatars'));
    expect(res.status).toBe(200);
    const body = res.body as { avatars: string[] };
    expect(body.avatars).toContain('default');
    expect(body.avatars.length).toBe(STATIC_AVATAR_NAMES.length);
  });
});