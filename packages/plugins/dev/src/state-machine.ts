/**
 * @flowforge/plugin-dev — seven-phase delivery state machine (EP0):
 * requirement → design → plan → implement → review → verify → finish.
 * Illegal transitions are rejected; three hard gates enforce the
 * superpowers engineering methodology fused with our rules (mgr PR exit,
 * T1-T9 test iron rules — see docs/refactor/33-stage-ep0-plugin-dev.md).
 *
 * @module @flowforge/plugin-dev/state-machine
 */

/** Ordered phases of the software engineering delivery process. */
export const PROCESS_PHASES = [
  'requirement',
  'design',
  'plan',
  'implement',
  'review',
  'verify',
  'finish',
] as const

/** One phase of the delivery process. */
export type ProcessPhase = (typeof PROCESS_PHASES)[number]

/** Gate flags required by phase transitions. */
export interface ProcessGateFlags {
  /** Design artifact signed off by the operator (design → plan gate). */
  readonly designApproved: boolean
  /** Plan artifact validated — no placeholders, TDD steps present (plan → implement gate). */
  readonly planValidated: boolean
  /** Verification evidence recorded — commands, exit codes, output (verify → finish gate). */
  readonly verificationEvidence: boolean
}

/** Artifact paths produced along the process (Plane 1 documents). */
export interface ProcessArtifactPaths {
  design?: string
  plan?: string
  review?: string
  verification?: string
}

/** One legal transition of the state machine (the transition table). */
export interface ProcessTransition {
  readonly from: ProcessPhase
  readonly to: ProcessPhase
  /** Gate flag that must be set before this transition is allowed. */
  readonly requiresGate?: keyof ProcessGateFlags
}

/**
 * The legal transition table: strictly linear phase order, with the three
 * hard gates from the engineering methodology:
 * - design 未签核禁止 plan（design → plan requires designApproved）
 * - plan 未校验禁止 implement（plan → implement requires planValidated）
 * - verify 无证据禁止 finish（verify → finish requires verificationEvidence）
 */
export const PROCESS_TRANSITIONS: readonly ProcessTransition[] = [
  { from: 'requirement', to: 'design' },
  { from: 'design', to: 'plan', requiresGate: 'designApproved' },
  { from: 'plan', to: 'implement', requiresGate: 'planValidated' },
  { from: 'implement', to: 'review' },
  { from: 'review', to: 'verify' },
  { from: 'verify', to: 'finish', requiresGate: 'verificationEvidence' },
]

/** Result of a gate check for the next transition. */
export interface ProcessGateCheck {
  readonly allowed: boolean
  /** Human-readable blocking reason when the gate is closed. */
  readonly reason?: string
}

/** Entry of the phase history (audit trail of the instance). */
export interface ProcessPhaseRecord {
  readonly phase: ProcessPhase
  readonly enteredAt: string
}

/** JSON-serializable snapshot of a process instance. */
export interface ProcessSnapshot {
  readonly name: string
  readonly phase: ProcessPhase
  readonly gates: ProcessGateFlags
  readonly artifacts: ProcessArtifactPaths
  readonly history: readonly ProcessPhaseRecord[]
}

export interface ForgeProcessStateMachineOptions {
  /** Instance name (unique within a registry). */
  readonly name: string
  /** Injected clock for deterministic tests. */
  readonly now?: () => Date
}

/** Error thrown on illegal transitions or closed gates. */
export class ProcessTransitionError extends Error {
  constructor(
    message: string,
    readonly readonlyFrom: ProcessPhase,
    readonly attemptedTo: ProcessPhase,
  ) {
    super(message)
    this.name = 'ProcessTransitionError'
  }
}

function isoNow(now: () => Date): string {
  return now().toISOString()
}

/**
 * Seven-phase delivery state machine for one process instance.
 *.advance() moves exactly one phase forward; every other jump is rejected.
 */
export class ForgeProcessStateMachine {
  private readonly nameValue: string
  private readonly now: () => Date
  private phaseValue: ProcessPhase
  private readonly gatesValue: {
    designApproved: boolean
    planValidated: boolean
    verificationEvidence: boolean
  }
  private readonly artifactsValue: ProcessArtifactPaths
  private readonly historyValue: ProcessPhaseRecord[]

  constructor(options: ForgeProcessStateMachineOptions) {
    this.nameValue = options.name
    this.now = options.now ?? (() => new Date())
    this.phaseValue = 'requirement'
    this.gatesValue = { designApproved: false, planValidated: false, verificationEvidence: false }
    this.artifactsValue = {}
    this.historyValue = [{ phase: 'requirement', enteredAt: isoNow(this.now) }]
  }

  get name(): string {
    return this.nameValue
  }

  get phase(): ProcessPhase {
    return this.phaseValue
  }

  get gates(): Readonly<ProcessGateFlags> {
    return this.gatesValue
  }

  get artifacts(): Readonly<ProcessArtifactPaths> {
    return this.artifactsValue
  }

  get history(): readonly ProcessPhaseRecord[] {
    return [...this.historyValue]
  }

  /** True once the instance reached the terminal phase. */
  get finished(): boolean {
    return this.phaseValue === 'finish'
  }

  /** The single legal transition from the current phase, if any. */
  nextTransition(): ProcessTransition | undefined {
    return PROCESS_TRANSITIONS.find(transition => transition.from === this.phaseValue)
  }

  /**
   * Check the gate for the next transition without moving.
   * Returns the blocking reason when the gate is closed.
   */
  guard(): ProcessGateCheck {
    const transition = this.nextTransition()
    if (transition === undefined) {
      return { allowed: false, reason: `process '${this.nameValue}' already finished` }
    }
    if (transition.requiresGate === undefined) {
      return { allowed: true }
    }
    if (this.gatesValue[transition.requiresGate]) {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: `gate '${transition.requiresGate}' closed: ${transition.from} → ${transition.to} blocked (${this.gateRequirementText(transition.requiresGate)})`,
    }
  }

  /**
   * Advance exactly one phase forward. Rejects:
   * - advancing past `finish` (terminal phase);
   * - moving while the gate for the next transition is closed.
   */
  advance(): ProcessSnapshot {
    const transition = this.nextTransition()
    if (transition === undefined) {
      throw new ProcessTransitionError(
        `process '${this.nameValue}' is already in the terminal phase 'finish'`,
        'finish',
        'finish',
      )
    }
    const gate = this.guard()
    if (!gate.allowed) {
      throw new ProcessTransitionError(gate.reason ?? 'gate closed', this.phaseValue, transition.to)
    }
    this.phaseValue = transition.to
    this.historyValue.push({ phase: transition.to, enteredAt: isoNow(this.now) })
    return this.snapshot()
  }

  /**
   * Advance to an explicit target phase. Only a legal single forward step
   * from the current phase is accepted — every other target (skipping
   * phases, moving backwards, staying) is an illegal transition.
   */
  advanceTo(target: ProcessPhase): ProcessSnapshot {
    const transition = this.nextTransition()
    if (transition === undefined || transition.to !== target) {
      throw new ProcessTransitionError(
        `illegal transition ${this.phaseValue} → ${target}: only the next phase in ${PROCESS_PHASES.join(' → ')} is reachable`,
        this.phaseValue,
        target,
      )
    }
    return this.advance()
  }

  /** Sign off the design artifact (opens the design → plan gate). */
  approveDesign(path: string): void {
    this.gatesValue.designApproved = true
    this.artifactsValue.design = path
  }

  /** Validate the plan artifact (opens the plan → implement gate). */
  validatePlan(path: string): void {
    this.gatesValue.planValidated = true
    this.artifactsValue.plan = path
  }

  /** Record verification evidence (opens the verify → finish gate). */
  recordVerification(path: string): void {
    this.gatesValue.verificationEvidence = true
    this.artifactsValue.verification = path
  }

  /** Register the review artifact path (bookkeeping only, no gate). */
  registerReview(path: string): void {
    this.artifactsValue.review = path
  }

  /** Serializable snapshot of the instance. */
  snapshot(): ProcessSnapshot {
    return {
      name: this.nameValue,
      phase: this.phaseValue,
      gates: { ...this.gatesValue },
      artifacts: { ...this.artifactsValue },
      history: [...this.historyValue],
    }
  }

  /** Rebuild an instance from a snapshot (e.g. after CLI restart). */
  static restore(snapshot: ProcessSnapshot, options?: { now?: () => Date }): ForgeProcessStateMachine {
    const machine = new ForgeProcessStateMachine({
      name: snapshot.name,
      ...(options?.now !== undefined ? { now: options.now } : {}),
    })
    const phaseIndex = PROCESS_PHASES.indexOf(snapshot.phase)
    if (phaseIndex < 0) {
      throw new Error(`unknown phase '${snapshot.phase}' in snapshot of process '${snapshot.name}'`)
    }
    machine.phaseValue = snapshot.phase
    machine.gatesValue.designApproved = snapshot.gates.designApproved
    machine.gatesValue.planValidated = snapshot.gates.planValidated
    machine.gatesValue.verificationEvidence = snapshot.gates.verificationEvidence
    Object.assign(machine.artifactsValue, snapshot.artifacts)
    machine.historyValue.length = 0
    machine.historyValue.push(...snapshot.history.map(record => ({ ...record })))
    return machine
  }

  private gateRequirementText(gate: keyof ProcessGateFlags): string {
    switch (gate) {
      case 'designApproved':
        return 'design artifact must be signed off via approveDesign() before entering plan'
      case 'planValidated':
        return 'plan artifact must be validated via validatePlan() before entering implement'
      case 'verificationEvidence':
        return 'verification evidence must be recorded via recordVerification() before finishing'
    }
  }
}
