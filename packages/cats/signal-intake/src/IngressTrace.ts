/**
 * 信号入站诊断轨迹（IngressTrace）：有界保留、无载荷的日志采集。
 * 它永远不是入站真值，仅用于诊断。
 *
 * 忠实移植 clowder-ai `domains/signal-intake/IngressTrace.ts`。
 *
 * @flowforge/cats-signal-intake
 */

export interface SignalIngressTrace {
  readonly at: number
  readonly pluginInstanceId: string
  readonly signalType?: string
  readonly outcome: 'accepted' | 'duplicate' | 'rejected'
  readonly rejectionCode?: string
}

/** Payload-free, bounded-retention diagnostics sink. Never intake truth. */
export interface SignalIngressTraceSink {
  record(trace: SignalIngressTrace): Promise<void> | void
}

export class MemorySignalIngressTraceSink implements SignalIngressTraceSink {
  readonly traces: SignalIngressTrace[] = []

  record(trace: SignalIngressTrace): void {
    this.traces.push(structuredClone(trace))
  }
}