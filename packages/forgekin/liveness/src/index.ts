/**
 * @flowforge/forgekin-liveness — Liveness 探针 + 规范读模型（F42 / F023）。
 *
 * TS 移植 flowforge Python `core/reliability/liveness.py` + canonical read
 * 设计：
 *   - probe：LivenessSpec 注册表 + 串行隔离执行（healthy/latencyMs/error）
 *   - canonical：单一规范读模型，源优先级 durable > tracker > cache，
 *     四态 alive/degraded/zombie/grace_waiting 判定 + 宽限期
 *
 * @module @flowforge/forgekin-liveness
 */

import { Context, Service } from '@flowforge/cordis';

import { CanonicalReadModel, type CanonicalReadInput, type LivenessRecord } from './canonical.ts';
import { LivenessProbe, type ProbeCheck, type ProbeResult, type ProbeSpecPatch } from './probe.ts';

export {
  CanonicalReadModel,
  DEFAULT_LIVENESS_THRESHOLDS,
  judgeLiveness,
  resolveCanonicalSignal,
  type CanonicalReadInput,
  type CanonicalReadModelOptions,
  type CanonicalSource,
  type LivenessRecord,
  type LivenessSignal,
  type LivenessState,
  type LivenessThresholds,
} from './canonical.ts';
export {
  LivenessError,
  LivenessProbe,
  type LivenessSpec,
  type ProbeCheck,
  type ProbeRegistration,
  type ProbeResult,
  type ProbeSpecPatch,
} from './probe.ts';

declare module '@flowforge/cordis' {
  interface Context {
    /** Liveness 探针 + 规范读（F42）：只读探针注册执行 + 四态规范读。 */
    forgeLiveness: LivenessService;
  }
}

export interface LivenessServiceOptions {
  probe?: LivenessProbe;
  readModel?: CanonicalReadModel;
}

export class LivenessService extends Service {
  readonly probe: LivenessProbe;
  readonly readModel: CanonicalReadModel;

  constructor(ctx: Context, options: LivenessServiceOptions = {}) {
    super(ctx, 'forgeLiveness');
    this.probe = options.probe ?? new LivenessProbe();
    this.readModel = options.readModel ?? new CanonicalReadModel();
  }

  /** 注册只读探针。 */
  registerProbe(name: string, check: ProbeCheck, spec?: ProbeSpecPatch): void {
    this.probe.registerProbe(name, check, spec);
  }

  /** 串行运行全部探针。 */
  runAll(): Promise<ProbeResult[]> {
    return this.probe.runAll();
  }

  /** 规范读单记录。 */
  readLiveness(forgekinId: string, input: CanonicalReadInput): LivenessRecord {
    return this.readModel.read(forgekinId, input);
  }
}

export default LivenessService;
