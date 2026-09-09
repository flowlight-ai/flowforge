/** Build-static first-party Session format migration catalog. */

export { sessionFormatCatalog } from './generated.ts'
export { SessionFormatUnsupportedMigrationError } from '@flowforge/session-format'
export type { InstalledSessionPort } from './ports/installed-session.ts'
export { INSTALLED_SESSION_FORMAT_VERSION, MemoryInstalledSession } from './ports/installed-session.ts'