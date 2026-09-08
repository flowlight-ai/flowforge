/**
 * Externalized user-facing copy / error strings.
 *
 * Every hint/error message referenced by controllers lives here so the host can
 * localize or adjust wording without touching control flow (matches the
 * "文案外部化" rule from the design doc).
 */

export const MESSAGES = {
  // identity
  identityRequired: 'Identity required (session cookie or X-Cat-Cafe-User header)',
  authenticationRequired: 'Authentication required',
  // session chain
  sessionNotFound: 'Session not found',
  sessionNotFoundCode: 'SESSION_NOT_FOUND',
  threadNotFound: 'Thread not found',
  threadNotFoundCode: 'THREAD_NOT_FOUND',
  accessDenied: 'Access denied',
  sessionAccessDeniedCode: 'SESSION_ACCESS_DENIED',
  onlyActiveSealable: 'Only an active session can be sealed',
  sessionNotActiveCode: 'SESSION_NOT_ACTIVE',
  sealUnavailable: 'Session sealing is temporarily unavailable',
  sealUnavailableCode: 'SESSION_SEAL_UNAVAILABLE',
  sealLivenessUnavailable: 'Unable to verify whether this Agent is still running',
  sealLivenessCode: 'SESSION_LIVENESS_UNAVAILABLE',
  sessionActiveInvocation: '请先停止该 Agent，再封存会话',
  sessionActiveInvocationCode: 'SESSION_ACTIVE_INVOCATION',
  sealRace: '会话状态已变化，请刷新后重试',
  sealRaceCode: 'SESSION_SEAL_RACE',
  sealPending: 'Session sealing has not completed yet',
  sealPendingCode: 'SESSION_SEAL_PENDING',
  sealPartial: 'Session sealed, but transcript or digest finalization did not complete',
  sealPartialCode: 'SESSION_SEAL_PARTIAL',
  restoreConfirmationRequiredCode: 'active_session_confirmation_required',
  restoreConfirmationRequired: 'Confirm the currently active session before restoring this historical session',
  activeSessionChangedCode: 'active_session_changed',
  activeSessionChanged: 'The active session changed; refresh before restoring',
  sessionSwitchBusyCode: 'session_switch_busy',
  sessionSwitchBusy: 'This cat has queued or running work in the thread; wait for it to finish before restoring',
  cliSessionIdBound: 'CLI session ID is already bound or the active session changed; please retry',
  invalidCatIdPrefix: 'Invalid catId: ',
  bindIncomplete: 'Invalid request body',
  // strategy
  strategyUnavailableReason: 'No concrete context capability is registered for this member',
  // handoff
  handoffProposalNotFound: 'Session handoff proposal not found',
  handoffRejectConflict: 'Rejected proposal feedback conflicts with the settled decision',
  handoffRejectBusy: 'Proposal is being approved — cannot reject; retry once it settles',
  handoffLegacyUnmigrated: 'Legacy rejected proposal has no disposition ledger entry',
  handoffInvariantFailure: 'Disposition ledger invariant failure',
  handoffRegistrationRequiresAgentKey: 'external_runtime_registration_requires_agent_key',
  handoffRegistrationReject: 'Proposal cannot be rejected',
  // runtime session
  externalRegisterAuthRequired: 'external_runtime_registration_requires_agent_key',
  // workspace
  worktreeIdRequired: 'worktreeId required',
  internalError: 'Internal error',
  repoRootNotAbsolute: 'repoRoot must be an absolute path',
  repoRootNotDirectory: (p: string) => `repoRoot does not exist or is not a directory: ${p}`,
  treeAuthRequired: 'worktreeId and path required',
  hrefRequired: 'href required',
  fileTooLarge: (mb: string) => `File too large (${mb}MB, max 10MB)`,
  queryTooLong: 'Query too long (max 200 chars)',
  timeoutMessage: 'operation timed out',
} as const;

export const TRANSCRIPT_VIEWS = ['raw', 'chat', 'handoff'] as const;
export type TranscriptView = (typeof TRANSCRIPT_VIEWS)[number];
export const VALID_TRANSCRIPT_VIEWS: ReadonlySet<string> = new Set<string>(TRANSCRIPT_VIEWS);