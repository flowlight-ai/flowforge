/**
 * evidence-sensors — Harness 第 3 层：验证现实（F009 evidence-sensors）。
 *
 * 移植 `harness/evidence_sensors.py`（TS 重写）：
 * agent 声称完成时，必须提供可验证的证据（commit / test / trace / screenshot / log）。
 * 解决开放环境失败模式 3（验证失败：agent 声称做完但没证据）。
 *
 * - EvidenceSource：五种证据来源（对应 roleagent.md §2.2 五项终止条件 2）
 * - EvidenceCollector：采集 + 哈希校验 + 自动验证
 * - SensorBase：主动感知机制，定期观测环境状态
 *
 * @module @flowforge/forgekin-harness
 */

import { createHash, randomUUID } from 'node:crypto';

/** 证据来源类型 —— Built-to-Persist（对应"证据已附"终止条件）。 */
export enum EvidenceSource {
  /** git commit hash。 */
  COMMIT = 'commit',
  /** 测试用例通过结果。 */
  TEST = 'test',
  /** 执行 trace 日志。 */
  TRACE = 'trace',
  /** DOM / UI 截图（T8 测试铁律）。 */
  SCREENSHOT = 'screenshot',
  /** 运行日志。 */
  LOG = 'log',
}

/** 证据记录 —— Built-to-Persist（hash 字段校验内容未被篡改）。 */
export interface Evidence {
  /** 证据唯一 ID（`ev-` + uuid4 前 12 位）。 */
  readonly evidence_id: string;
  /** 证据来源类型。 */
  readonly source_type: EvidenceSource;
  /** 证据内容（commit hash / 测试输出 / trace 摘要 等）。 */
  readonly content: string;
  /** 内容哈希（用于完整性校验）。 */
  readonly hash: string;
  /** 附加元数据（如 commit_url / test_run_id）。 */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** 采集时间 ISO 8601。 */
  readonly created_at: string;
  /** 是否已通过 verify。 */
  readonly verified: boolean;
}

/** 传感器读数 —— Built-to-Persist（SensorBase.observe() 的返回值）。 */
export interface SensorReading {
  /** 传感器实例 ID。 */
  readonly sensor_id: string;
  /** 读数唯一 ID（`rd-` + uuid4 前 12 位）。 */
  readonly reading_id: string;
  /** 读数值（任意可序列化数据）。 */
  readonly value: unknown;
  /** 单位（如 ms / count / ratio）。 */
  readonly unit: string;
  /** 读数时间 ISO 8601。 */
  readonly timestamp: string;
  /** 是否异常（用于触发告警）。 */
  readonly anomaly: boolean;
}

/** 构建一条传感器读数。 */
export function createSensorReading(
  sensorId: string,
  value: unknown,
  options: { unit?: string | undefined; anomaly?: boolean | undefined } = {},
): SensorReading {
  return {
    sensor_id: sensorId,
    reading_id: `rd-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    value,
    unit: options.unit ?? '',
    timestamp: new Date().toISOString(),
    anomaly: options.anomaly ?? false,
  };
}

/** 证据采集器 —— Built-to-Persist（验证反馈回路）。 */
export class EvidenceCollector {
  readonly hashAlgorithm: string;
  readonly retentionDays: number;
  readonly autoVerify: boolean;
  readonly enabledSources: Set<EvidenceSource>;

  /** 内存存储（生产环境应替换为持久存储）。 */
  readonly storage = new Map<string, Evidence>();

  constructor(options: {
    hashAlgorithm?: string | undefined;
    retentionDays?: number | undefined;
    autoVerify?: boolean | undefined;
    enabledSources?: readonly EvidenceSource[] | undefined;
  } = {}) {
    this.hashAlgorithm = options.hashAlgorithm ?? 'sha256';
    this.retentionDays = options.retentionDays ?? 90;
    this.autoVerify = options.autoVerify ?? true;
    this.enabledSources = new Set(
      options.enabledSources ?? Object.values(EvidenceSource),
    );
  }

  /** 计算内容哈希。 */
  private computeHash(content: string): string {
    return createHash(this.hashAlgorithm).update(content, 'utf8').digest('hex');
  }

  /** 采集一条证据（已计算 hash；autoVerify 时自动校验）。 */
  async collect(
    sourceType: EvidenceSource,
    content: string,
    metadata?: Readonly<Record<string, unknown>> | undefined,
  ): Promise<Evidence> {
    if (!this.enabledSources.has(sourceType)) {
      const enabled = [...this.enabledSources].map((s) => s.valueOf()).join(', ');
      throw new Error(
        `EvidenceSource '${sourceType}' is not enabled; enabled: ${enabled}`,
      );
    }

    const evidence: Evidence = {
      evidence_id: `ev-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      source_type: sourceType,
      content,
      hash: this.computeHash(content),
      metadata: { ...(metadata ?? {}) },
      created_at: new Date().toISOString(),
      verified: false,
    };
    this.storage.set(evidence.evidence_id, evidence);

    if (this.autoVerify) {
      const verified = await this.verify(evidence);
      const updated: Evidence = { ...evidence, verified };
      this.storage.set(evidence.evidence_id, updated);
      return updated;
    }
    return evidence;
  }

  /** 校验证据完整性（重算哈希比对）。 */
  async verify(evidence: Evidence): Promise<boolean> {
    const actualHash = this.computeHash(evidence.content);
    return actualHash === evidence.hash;
  }

  /** 按 ID 查询证据。 */
  getEvidence(evidenceId: string): Evidence | undefined {
    return this.storage.get(evidenceId);
  }

  /** 列出证据（可按来源过滤）。 */
  listEvidence(sourceType?: EvidenceSource | undefined): Evidence[] {
    if (sourceType === undefined) {
      return [...this.storage.values()];
    }
    return [...this.storage.values()].filter((e) => e.source_type === sourceType);
  }
}

/** 传感器抽象基类 —— Built-to-Persist（探针基础设施）。 */
export abstract class SensorBase {
  readonly sensorId: string;
  readonly name: string;

  constructor(sensorId: string, name = '') {
    this.sensorId = sensorId;
    this.name = name || sensorId;
  }

  /**
   * 观测环境状态，返回读数。
   * 实现者应执行具体感知逻辑；检测到异常时设置 anomaly=true。
   */
  abstract observe(): Promise<SensorReading>;
}
