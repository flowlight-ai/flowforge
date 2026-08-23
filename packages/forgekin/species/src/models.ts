/**
 * @flowforge/forgekin-species — Forgekin 通用数据模型
 *
 * TS 移植自 `forgemind/forgekin.py`：Forgekin 是跨任务存续的长期主体
 * （roleagent.md Ch.0），角色（role）只是单任务期间的运行时标签。
 *
 * @module @flowforge/forgekin-species/models
 */

/** Forgekin 领域错误（对齐 Python ForgekinError） */
export class ForgekinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgekinError';
  }
}

/** Forgekin 类型（非穷举，可经插件扩展；对齐 Python ForgekinType） */
export enum ForgekinType {
  ANIMAL_COMPANION = 'animal_companion',
  ORGANIZATION = 'organization',
  OBJECT_SPIRIT = 'object_spirit',
  FICTIONAL_CHARACTER = 'fictional_character',
  VR_PERSONA = 'vr_persona',
  CODE_AGENT = 'code_agent',
  CUSTOM = 'custom',
}

/** 能力维度（如 coding / empathy），proficiency 0.0..1.0 */
export interface Capability {
  readonly name: string;
  proficiency: number;
  evidence: string[];
  lastAssessedAt: string | null;
}

/** 创建能力条目 */
export function makeCapability(
  name: string,
  proficiency = 0.0,
  evidence: string[] = [],
  lastAssessedAt: string | null = null,
): Capability {
  return { name, proficiency, evidence: [...evidence], lastAssessedAt };
}

/** 已知盲点 — 知道自己盲点的 Forgekin 比假装全知的更安全 */
export interface BlindSpot {
  readonly name: string;
  severity: number;
  /** 补偿方式（委派 / 请求人工等） */
  mitigation: string;
  discoveredAt: string;
}

/** 创建盲点条目 */
export function makeBlindSpot(name: string, severity = 0.0, mitigation = '', discoveredAt?: string): BlindSpot {
  return { name, severity, mitigation, discoveredAt: discoveredAt ?? new Date().toISOString() };
}

/** Forgekin 可变运行时状态 */
export interface ForgekinState {
  /** 任务预算余量 0.0..1.0 */
  energy: number;
  mood: string;
  lastTaskAt: string | null;
  /** 未交接的 capsule id 列表 */
  openHandoffs: string[];
}

/** 创建默认运行时状态（energy=1.0 / neutral） */
export function makeForgekinState(): ForgekinState {
  return { energy: 1.0, mood: 'neutral', lastTaskAt: null, openHandoffs: [] };
}

/** 生成默认 forgekin_id（fk-{12 位随机十六进制}，对齐 Python uuid4 hex[:12]） */
export function defaultForgekinId(): string {
  const hex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `fk-${hex}`;
}

/** Forgekin 构造入参（name 必填，其余有默认值） */
export interface ForgekinInit {
  readonly name: string;
  readonly forgekinType?: ForgekinType | undefined;
  readonly forgekinId?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly vendor?: string | undefined;
  readonly modelLineage?: readonly string[] | undefined;
  readonly boundExternalAgents?: readonly string[] | undefined;
}

/** 通用 Forgekin（ForgekinSpecies）— 长期能力主体 */
export class Forgekin {
  readonly name: string;
  readonly forgekinType: ForgekinType;
  readonly forgekinId: string;
  readonly createdAt: string;

  /** 长期画像 */
  readonly capabilities = new Map<string, Capability>();
  readonly blindSpots: BlindSpot[] = [];
  readonly history: Array<Record<string, unknown>> = [];

  /** 运行时状态 */
  readonly state: ForgekinState = makeForgekinState();

  /** 厂商 / 模型谱系（council 跨厂商评审用） */
  readonly vendor: string;
  readonly modelLineage: string[];

  /** 绑定的外部 agent（external-agents 插件填充） */
  readonly boundExternalAgents: string[];

  constructor(init: ForgekinInit) {
    if (!init.name || !init.name.trim()) {
      throw new ForgekinError('Forgekin name must not be empty');
    }
    this.name = init.name;
    this.forgekinType = init.forgekinType ?? ForgekinType.CUSTOM;
    this.forgekinId = init.forgekinId ?? defaultForgekinId();
    this.createdAt = init.createdAt ?? new Date().toISOString();
    this.vendor = init.vendor ?? 'flowforge';
    this.modelLineage = [...(init.modelLineage ?? [])];
    this.boundExternalAgents = [...(init.boundExternalAgents ?? [])];
  }

  addCapability(cap: Capability): void {
    this.capabilities.set(cap.name, cap);
  }

  addBlindSpot(spot: BlindSpot): void {
    this.blindSpots.push(spot);
  }

  recordHistory(event: Record<string, unknown>): void {
    const stamped = { ...event };
    if (stamped['timestamp'] === undefined) {
      stamped['timestamp'] = new Date().toISOString();
    }
    this.history.push(stamped);
  }

  hasCapability(name: string, minProficiency = 0.5): boolean {
    const cap = this.capabilities.get(name);
    return cap !== undefined && cap.proficiency >= minProficiency;
  }

  /** 检查能否承接要求给定能力的任务；返回 [可承接, 缺失能力列表] */
  canTakeTask(requiredCapabilities: readonly string[]): [boolean, string[]] {
    const missing: string[] = [];
    for (const req of requiredCapabilities) {
      if (!this.hasCapability(req)) {
        missing.push(req);
      }
    }
    if (missing.length > 0) {
      return [false, missing];
    }
    if (this.state.energy <= 0.0) {
      return [false, ['energy depleted']];
    }
    return [true, []];
  }

  spendEnergy(amount: number): void {
    if (amount < 0) {
      throw new ForgekinError(`energy amount must be >= 0, got ${amount}`);
    }
    this.state.energy = Math.max(0.0, this.state.energy - amount);
    this.state.lastTaskAt = new Date().toISOString();
  }

  recoverEnergy(amount: number): void {
    if (amount < 0) {
      throw new ForgekinError(`energy amount must be >= 0, got ${amount}`);
    }
    this.state.energy = Math.min(1.0, this.state.energy + amount);
  }

  toString(): string {
    return `<Forgekin ${JSON.stringify(this.name)} type=${this.forgekinType} id=${this.forgekinId} energy=${this.state.energy.toFixed(2)}>`;
  }
}
