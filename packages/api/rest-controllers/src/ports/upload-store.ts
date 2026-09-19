/**
 * Upload storage seam (B21 assets; ported from clowder-ai `getDefaultUploadDir`
 * + `node:fs/promises` write in `routes/avatars.ts`).
 *
 * The avatars controller writes decoded image bytes through this seam so contract
 * tests stay framework-free; the host binds the real filesystem upload directory
 * in EP2 (resolving `UPLOAD_DIR`/default as clowder does).
 */

/** Result of persisting an uploaded file: the client-facing URL path. */
export interface AvatarSaved {
  /** Server-relative URL the client can fetch the stored image at. */
  url: string;
  /** On-disk filename (basename only, e.g. `avatar-<ts>-<rnd>.png`). */
  filename: string;
}

export interface UploadStoreSeam {
  /**
   * Persist raw image bytes and return a client-addressable URL. The store owns
   * naming and directory resolution; callers pass extension and bytes only.
   */
  save(input: { bytes: Uint8Array; ext: string }): Promise<AvatarSaved>;
}

/**
 * In-memory contract implementation: records the last saved bytes/filename and
 * returns a deterministic URL. Keeps a registry of every save for assertions.
 */
export class MemoryUploadStore implements UploadStoreSeam {
  readonly saved: AvatarSaved[] = [];
  savedBytes = new Map<string, Uint8Array>();

  async save(input: { bytes: Uint8Array; ext: string }): Promise<AvatarSaved> {
    const filename = `avatar-${this.saved.length + 1}.${input.ext}`;
    const url = `/uploads/${filename}`;
    this.saved.push({ url, filename });
    this.savedBytes.set(url, input.bytes);
    return { url, filename };
  }
}