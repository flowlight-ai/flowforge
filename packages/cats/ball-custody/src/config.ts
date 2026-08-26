/**
 * @flowforge/cats-ball-custody — 配置加载（对齐 `forgemind/config` 模式）
 *
 * Ball Custody 依赖配置驱动（铁律5+P16）：
 *   - config/ball-custody.yaml — F005 TTL / C24 死球 grace / F006 push_back 开关
 *     （ball_custody.default_ttl_seconds=300 / dead_ball_zombie_grace_ms=600000；
 *      push_back.require_evidence=true / block_termination=true）
 *
 * 内置 YAML 随包发布（`packages/cats/ball-custody/config/`），缺省从包内
 * 加载；文件不存在时抛错（对齐 Python FileNotFoundError 语义）。
 *
 * @module @flowforge/cats-ball-custody/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** 球权托管配置（对齐 ball-custody.yaml 各段）。 */
export interface BallCustodyConfig {
  /** F005 球权租借配置。 */
  ball_custody: {
    /** lease 默认 TTL 秒数（F005 DEFAULT_TTL_SECONDS=300）。 */
    default_ttl_seconds: number;
    /** 死球迟到心跳 grace（C24 DEAD_BALL_ZOMBIE_GRACE_MS=600000ms）。 */
    dead_ball_zombie_grace_ms: number;
  };
  /** F006 推回协议配置。 */
  push_back: {
    /** 三要素强制开关（true=evidence 至少一个 anchor，RA-015）。 */
    require_evidence: boolean;
    /** 未解决推回阻塞终止条件开关（true=阻塞 QUALITY_BAR_MET）。 */
    block_termination: boolean;
  };
}

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析）。 */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 ball-custody.yaml 绝对路径。 */
export function builtinBallCustodyYamlPath(): string {
  return fileURLToPath(new URL('../config/ball-custody.yaml', import.meta.url));
}

function readYamlOrThrow(yamlPath: string, usage: string): Record<string, unknown> {
  if (!existsSync(yamlPath)) {
    throw new Error(`配置文件不存在: ${yamlPath}（${usage}，铁律5+P16）。`);
  }
  const raw = readFileSync(yamlPath, 'utf-8');
  const data = parseYaml(raw);
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 加载 Ball Custody 配置（ball-custody.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/ball-custody.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadBallCustodyConfig(yamlPath: string = builtinBallCustodyYamlPath()): BallCustodyConfig {
  const data = readYamlOrThrow(yamlPath, 'Ball Custody 配置驱动');
  const ballCustody = (data.ball_custody ?? {}) as Record<string, unknown>;
  const pushBack = (data.push_back ?? {}) as Record<string, unknown>;
  return {
    ball_custody: {
      default_ttl_seconds: asNumber(ballCustody.default_ttl_seconds, 300),
      dead_ball_zombie_grace_ms: asNumber(ballCustody.dead_ball_zombie_grace_ms, 600_000),
    },
    push_back: {
      require_evidence: asBoolean(pushBack.require_evidence, true),
      block_termination: asBoolean(pushBack.block_termination, true),
    },
  };
}
