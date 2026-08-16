/**
 * @flowforge/skill-security — skill security boundary (C36): content
 * scanning, external-skill permission policy, and the fingerprint-backed
 * approval store. Mapped from the upstream skill-security reference (C36);
 * see the module docs of each file for the source mapping.
 *
 * @module @flowforge/skill-security
 */

export type { ContentScanFinding } from './scanner.ts'
export { SCAN_PATTERNS, scanSkillContent } from './scanner.ts'
export type { PermissionContext, SkillPermissionSet, ToolPermissionResult } from './permissions.ts'
export { HIGH_RISK_VERBS, checkToolPermission, getSkillPermissions, isHighRiskTool } from './permissions.ts'
export type {
  FingerprintVerification,
  SkillFingerprint,
  SkillRegisterInput,
  SkillSecurityEntry,
  SkillSecurityStatus,
} from './store.ts'
export { SkillSecurityStore } from './store.ts'
