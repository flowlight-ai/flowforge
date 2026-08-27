/**
 * @flowforge/cats-guides — 配置加载（对齐 `forgemind/config` 模式）
 *
 * Guides/Concierge 依赖配置驱动（铁律5+P16）：
 *   - config/guides.yaml — guides.registry_path / default_thread_id / 关键词阈值 +
 *     concierge 默认值（displayName/personaTone/skin/proactivePolicy/球尺寸范围）
 *   - config/registry.yaml — F155 guide registry（随包发布）
 *   - config/flows/*.yaml — F155 orchestration flows（随包发布）
 *
 * 内置 YAML 随包发布（`packages/cats/guides/config/`），缺省从包内加载；
 * registry_path 可被显式路径覆盖（测试/宿主部署注入）。
 *
 * @module @flowforge/cats-guides/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { BALL_SIZE_DEFAULT, BALL_SIZE_MAX, BALL_SIZE_MIN } from './models.js';

/** C25 guides/concierge 配置（对齐 guides.yaml 各段）。 */
export interface GuidesConfig {
  guides: {
    /** 内置 registry 相对路径（相对包 config/ 目录，可被 configPath 覆盖）。 */
    registry_path: string;
    /** 共享默认线程 id（clowder DEFAULT_THREAD_ID='default'）。 */
    default_thread_id: string;
    /** 关键词反向子串匹配最小长度（ASCII 查询，clowder MIN=3）。 */
    min_ascii_reverse_match_length: number;
    /** 关键词反向子串匹配最小长度（非 ASCII 查询，clowder MIN=2）。 */
    min_non_ascii_reverse_match_length: number;
  };
  concierge: {
    /** 默认前台猫显示名。 */
    default_display_name: string;
    /** 默认一句话人设基调。 */
    default_persona_tone: string;
    /** 默认皮肤。 */
    default_skin: string;
    /** 默认主动性等级。 */
    default_proactive_policy: string;
    ball_size_min: number;
    ball_size_max: number;
    ball_size_default: number;
  };
}

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析）。 */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 guides.yaml 绝对路径。 */
export function builtinGuidesYamlPath(): string {
  return fileURLToPath(new URL('../config/guides.yaml', import.meta.url));
}

/** 内置 registry.yaml 绝对路径。 */
export function builtinRegistryYamlPath(): string {
  return fileURLToPath(new URL('../config/registry.yaml', import.meta.url));
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

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 解析 registry.yaml 绝对路径（yaml 内相对路径基于包 config/ 目录解析）。 */
export function resolveRegistryYamlPath(config: GuidesConfig, configDir: string = builtinConfigDir()): string {
  const raw = config.guides.registry_path;
  return isAbsolute(raw) ? raw : resolve(configDir, raw);
}

/**
 * 加载 C25 配置（guides.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/guides.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadGuidesConfig(yamlPath: string = builtinGuidesYamlPath()): GuidesConfig {
  const data = readYamlOrThrow(yamlPath, 'Guides/Concierge 配置驱动');
  const guides = (data.guides ?? {}) as Record<string, unknown>;
  const concierge = (data.concierge ?? {}) as Record<string, unknown>;
  return {
    guides: {
      registry_path: asString(guides.registry_path, 'registry.yaml'),
      default_thread_id: asString(guides.default_thread_id, 'default'),
      min_ascii_reverse_match_length: asNumber(guides.min_ascii_reverse_match_length, 3),
      min_non_ascii_reverse_match_length: asNumber(guides.min_non_ascii_reverse_match_length, 2),
    },
    concierge: {
      default_display_name: asString(concierge.default_display_name, '猫猫球'),
      default_persona_tone: asString(concierge.default_persona_tone, '温暖、简短、不啰嗦'),
      default_skin: asString(concierge.default_skin, 'yanyan-codex'),
      default_proactive_policy: asString(concierge.default_proactive_policy, 'quiet-badge'),
      ball_size_min: asNumber(concierge.ball_size_min, BALL_SIZE_MIN),
      ball_size_max: asNumber(concierge.ball_size_max, BALL_SIZE_MAX),
      ball_size_default: asNumber(concierge.ball_size_default, BALL_SIZE_DEFAULT),
    },
  };
}

/** dirname 辅助（registry-loader 复用：flow 文件相对 registry 所在目录解析）。 */
export function dirnameOf(path: string): string {
  return dirname(path);
}
