/**
 * Skill permission policy: what an external (third-party) skill may do
 * versus a first-party one, and which tool calls need explicit user
 * confirmation. Mapped from the upstream skill-security reference
 * `skill-permissions` (C36); the risk verb table and the `__`-scoped tool-name
 * convention come over unchanged.
 *
 * @module @flowforge/skill-security/permissions
 */

import type { SkillSecurityStatus } from './store.ts'

/** The situation a permission decision is made for. */
export interface PermissionContext {
  readonly isExternal: boolean
  readonly firstRun?: boolean
  readonly status?: SkillSecurityStatus
}

/** Permission set granted to a skill for this session. */
export interface SkillPermissionSet {
  readonly canWriteCapabilities: boolean
  readonly canTriggerSkills: boolean
  readonly toolAutoAllow: boolean
  readonly mode: 'full' | 'read-only' | 'dry-run'
}

/** One tool-call permission decision. */
export interface ToolPermissionResult {
  readonly requiresConfirmation: boolean
  readonly risk: 'high' | 'low'
}

/** Verbs that mark a tool as high-risk when they appear as a word segment. */
export const HIGH_RISK_VERBS: readonly string[] = [
  'write',
  'delete',
  'remove',
  'execute',
  'run',
  'send',
  'post',
  'push',
  'deploy',
  'install',
  'create',
  'update',
  'modify',
  'drop',
  'kill',
  'terminate',
  'publish',
]

/** Scoped tool names (`scope__name`) are judged by their effective name. */
function extractEffectiveName(toolName: string): string {
  const parts = toolName.split('__')
  return parts.length > 1 ? (parts[parts.length - 1] ?? toolName) : toolName
}

function camelToSnake(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

/** A tool is high-risk when a risk verb appears as a snake_case segment. */
export function isHighRiskTool(toolName: string): boolean {
  const effective = camelToSnake(extractEffectiveName(toolName))
  return HIGH_RISK_VERBS.some(verb => new RegExp(`(?:^|_)${verb}(?:_|$)`).test(effective))
}

/**
 * Resolve the permission set for a skill session. First-party skills run
 * full; external skills are read-only, or dry-run on their very first
 * run (so the user sees the intended effects before anything executes).
 */
export function getSkillPermissions(context: PermissionContext): SkillPermissionSet {
  if (!context.isExternal) {
    return { canWriteCapabilities: true, canTriggerSkills: true, toolAutoAllow: true, mode: 'full' }
  }
  const mode = context.firstRun ? 'dry-run' : 'read-only'
  return {
    canWriteCapabilities: false,
    canTriggerSkills: false,
    toolAutoAllow: false,
    mode,
  }
}

/**
 * Decide whether one tool call needs explicit confirmation. First-party:
 * never (risk is still reported for telemetry). External: high-risk
 * tools always confirm, and anything confirms until the skill is approved.
 */
export function checkToolPermission(toolName: string, context: PermissionContext): ToolPermissionResult {
  const risk = isHighRiskTool(toolName) ? 'high' : 'low'
  if (!context.isExternal) {
    return { requiresConfirmation: false, risk }
  }
  const requiresConfirmation = risk === 'high' || context.status !== 'approved'
  return { requiresConfirmation, risk }
}
