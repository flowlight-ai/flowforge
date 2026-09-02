/**
 * LivenessProbe 注册表与执行器（F42 / F023-liveness-probe，TS 移植）。
 *
 * 路由前的只读模型：任何能力可声明 LivenessSpec（name/description/
 * slaSeconds/requiredFor）并注册异步 check；run_all 串行按注册顺序执行，
 * 探针间隔离（一个抛异常不拖垮其他），每个 ProbeResult 带 healthy/
 * latencyMs/lastChecked/error。探针只报告不决策（恢复决策归 Tier 服务）。
 */

export class LivenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LivenessError';
  }
}

/** 异步 check：返回 true=健康 / false=不健康；可抛异常。 */
export type ProbeCheck = () => Promise<boolean>;

export interface LivenessSpec {
  name: string;
  description?: string;
  /** SLA 超时阈值（秒）：latencyMs > slaSeconds*1000 视为超时。 */
  slaSeconds?: number;
  /** 依赖此探针的能力名——不健康时这些能力被标记退化。 */
  requiredFor?: readonly string[];
}

export interface ProbeResult {
  name: string;
  healthy: boolean;
  latencyMs: number;
  lastChecked: string; // ISO 8601 (UTC)
  error?: string;
}

export interface ProbeRegistration {
  spec: Required<LivenessSpec>;
  check: ProbeCheck;
}

const DEFAULT_SLA_SECONDS = 5.0;

export type ProbeSpecPatch = Omit<LivenessSpec, 'name'>;

function normalizeSpec(name: string, spec?: ProbeSpecPatch): Required<LivenessSpec> {
  return {
    name,
    description: spec?.description ?? '',
    slaSeconds: spec?.slaSeconds ?? DEFAULT_SLA_SECONDS,
    requiredFor: spec?.requiredFor ?? [],
  };
}

export class LivenessProbe {
  private readonly probes = new Map<string, ProbeRegistration>();

  registerProbe(name: string, check: ProbeCheck, spec?: ProbeSpecPatch): void {
    if (!name.trim()) throw new LivenessError('probe name must be non-empty');
    if (this.probes.has(name)) throw new LivenessError(`probe "${name}" already registered`);
    this.probes.set(name, { spec: normalizeSpec(name, spec), check });
  }

  registerSpec(spec: LivenessSpec, check: ProbeCheck): void {
    if (!spec.name.trim()) throw new LivenessError('probe name must be non-empty');
    this.registerProbe(spec.name, check, spec);
  }

  listSpecs(): readonly Required<LivenessSpec>[] {
    return [...this.probes.values()].map((registration) => registration.spec);
  }

  getSpec(name: string): Required<LivenessSpec> {
    const registration = this.probes.get(name);
    if (!registration) throw new LivenessError(`probe "${name}" not registered`);
    return registration.spec;
  }

  count(): number {
    return this.probes.size;
  }

  async runProbe(name: string, now: () => Date = () => new Date()): Promise<ProbeResult> {
    const registration = this.probes.get(name);
    if (!registration) throw new LivenessError(`probe "${name}" not registered`);

    const startedAt = performance.now();
    try {
      const healthy = await registration.check();
      const latencyMs = performance.now() - startedAt;
      return {
        name,
        healthy,
        latencyMs,
        lastChecked: now().toISOString(),
      };
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      return {
        name,
        healthy: false,
        latencyMs,
        lastChecked: now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 串行执行所有探针（注册顺序）；单探针异常不影响其他。 */
  async runAll(now: () => Date = () => new Date()): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    for (const name of this.probes.keys()) {
      results.push(await this.runProbe(name, now));
    }
    return results;
  }

  /** SLA 超时判定：latencyMs > slaSeconds*1000。 */
  isSlaExceeded(result: ProbeResult): boolean {
    const spec = this.probes.get(result.name)?.spec;
    if (!spec) return false;
    return result.latencyMs > spec.slaSeconds * 1000;
  }

  /** 探针不健康影响的能力列表（供调用方标记退化）。 */
  impactedCapabilities(name: string): readonly string[] {
    return this.getSpec(name).requiredFor;
  }
}
