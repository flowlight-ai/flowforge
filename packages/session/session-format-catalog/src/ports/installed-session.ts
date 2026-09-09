/**
 * Installed current Session port seam.
 *
 * The catalog must restore and validate \"current\" (v2) logical artifacts through
 * whatever Session package is installed at runtime. dsh sourced this from
 * `@deepseek-ai/dsh-session` (`SESSION_FORMAT_VERSION` / `KNOWN_SESSION_EVENT_TYPES` /
 * `Session.fromRestore`). FlowForge has no standalone `@flowforge/session` core yet, so
 * this responsibility enters through the injected {@link InstalledSessionPort}.
 *
 * {@link MemoryInstalledSession} is the real in-memory implementation used by the
 * assembled catalog and by the contract tests (rule T9: no mocks). It carries the
 * released-v2 event vocabulary and the version/event-type validation the emitted
 * catalog depends on.
 */

import { SessionFormatError } from '@flowforge/session-format'
import { RELEASED_V2_EVENT_TYPES } from '@flowforge/session-format-v1-to-v2'
import type { SessionFormatArtifact, SessionFormatHeader } from '@flowforge/session-format'

/** The current generation number the installed Session understands. */
export const INSTALLED_SESSION_FORMAT_VERSION = 2

/**
 * Minimal current-Session capability the catalog needs at runtime.
 * Inject a port to avoid any runtime dependency on the installed Session package.
 */
export interface InstalledSessionPort {
  /** The installed current Session format generation (== currentVersion). */
  readonly version: number
  /** Exact event-type vocabulary the installed Session understands. */
  knownEventTypes(): ReadonlySet<string>
  /** Reject any header the installed Session cannot restore without reading bodies. */
  validateHeader(header: SessionFormatHeader): void
  /** Reject any artifact the installed Session cannot restore and validate. */
  validateArtifact(artifact: SessionFormatArtifact): void
}

/** Real in-memory installed current Session, carrying the released-v2 vocabulary. */
export class MemoryInstalledSession implements InstalledSessionPort {
  readonly version = INSTALLED_SESSION_FORMAT_VERSION
  private readonly known = new Set<string>(RELEASED_V2_EVENT_TYPES)

  knownEventTypes(): ReadonlySet<string> {
    return this.known
  }

  validateHeader(header: SessionFormatHeader): void {
    this.assertVersion(header.version)
  }

  validateArtifact(artifact: SessionFormatArtifact): void {
    this.assertVersion(artifact.header.version)
    const known = this.known
    for (const [index, event] of artifact.events.entries()) {
      if (event.seq !== index) {
        throw new SessionFormatError(`installed Session event at seq ${index} is not dense`)
      }
      if (!known.has(event.type)) {
        // Vocabulary-restored growth: an installed-unknown event survives only when
        // its envelope opts out by marking itself ignorable (exactly the released-v2
        // current-mode rule) — an unknown *required* type is rejected.
        if (event['ignorable'] === true) continue
        throw new SessionFormatError(
          `installed Session rejects unknown event type ${JSON.stringify(event.type)} at seq ${index}`,
        )
      }
    }
  }

  private assertVersion(version: number): void {
    if (version !== this.version) {
      throw new SessionFormatError(
        `installed Session format is v${this.version}, got v${version}`,
      )
    }
  }
}