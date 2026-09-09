/**
 * Build-static first-party Session format catalog assembly.
 *
 * Ported from dsh `dsh-session-format-catalog` generated.ts. The direct imports make
 * historical readability independent of mounted plugins. dsh sourced its installed
 * current Session (vocabulary + restore/validation) from `@deepseek-ai/dsh-session`;
 * here that seam is the injected {@link MemoryInstalledSession} (see
 * {@link InstalledSessionPort}), so there is no runtime `@deepseek-ai/*` dependency.
 */

import { createSessionFormatCatalog } from '@flowforge/session-format'
import {
  releasedV0SessionFormatCodec,
  releasedV1SessionFormatCodec,
  sessionFormatV0ToV1,
} from '@flowforge/session-format-v0-to-v1'
import {
  assertReleasedV2Header,
  releasedV2SessionFormatCodec,
  restoreReleasedV2Artifact,
  sessionFormatV1ToV2,
} from '@flowforge/session-format-v1-to-v2'
import {
  validateInstalledCurrentSessionArtifact,
  validateInstalledCurrentSessionHeader,
} from './current.ts'
import { MemoryInstalledSession } from './ports/installed-session.ts'

const installedSession = new MemoryInstalledSession()

/**
 * Physical codec dispatch and complete adjacent v0->v1->v2 chain, independent of
 * mounted plugins. Current (v2) restoration runs through the installed Session seam.
 */
export const sessionFormatCatalog = createSessionFormatCatalog({
  currentVersion: 2,
  codecs: [releasedV0SessionFormatCodec, releasedV1SessionFormatCodec, releasedV2SessionFormatCodec],
  encodeCurrentArtifact: artifact => releasedV2SessionFormatCodec.encodeArtifact(artifact),
  migrations: [sessionFormatV0ToV1, sessionFormatV1ToV2],
  restoreCurrent(artifact) {
    const restored = restoreReleasedV2Artifact(artifact, installedSession.knownEventTypes())
    return validateInstalledCurrentSessionArtifact(installedSession, restored)
  },
  restoreCurrentHeader(header) {
    assertReleasedV2Header(header)
    return validateInstalledCurrentSessionHeader(installedSession, header)
  },
})