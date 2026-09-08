/** Current installed Session validation routed through the injected {@link InstalledSessionPort}. */

import type { SessionFormatArtifact, SessionFormatHeader } from '@flowforge/session-format'
import type { InstalledSessionPort } from './ports/installed-session.ts'

/**
 * Validate current logical metadata through the installed Session port.
 * @param installed - injected installed current Session (real memory implementation in the emitted catalog).
 * @param header - detached current logical header.
 * @returns the same header after successful validation.
 */
export function validateInstalledCurrentSessionHeader(
  installed: InstalledSessionPort,
  header: SessionFormatHeader,
): SessionFormatHeader {
  installed.validateHeader(header)
  return header
}

/**
 * Validate current header and event envelope types through the installed Session port.
 * @param installed - injected installed current Session (real memory implementation in the emitted catalog).
 * @param artifact - vocabulary-restored current logical artifact.
 * @returns the same artifact after successful validation.
 */
export function validateInstalledCurrentSessionArtifact(
  installed: InstalledSessionPort,
  artifact: SessionFormatArtifact,
): SessionFormatArtifact {
  installed.validateArtifact(artifact)
  return artifact
}