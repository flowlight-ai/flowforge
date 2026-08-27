/**
 * @flowforge/cats-guides — GuideRegistryLoader（F155，clowder guide-registry-loader.ts 直译）。
 *
 * 加载 guide registry（registry.yaml）+ orchestration flows（flows/*.yaml），
 * 提供服务端校验的已知 guide ID 集合 + 发现元数据 + 意图匹配。
 *
 * 插件化改造（对照 clowder）：
 *   - `findProjectRoot()` 硬编码仓库根 → 包内置 `config/registry.yaml`（缺省），
 *     显式 registryPath 可注入（测试/宿主覆盖）
 *   - registry 校验失败抛 GuidesError（fail-fast）
 *
 * @module @flowforge/cats-guides/registry-loader
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { builtinRegistryYamlPath, type GuidesConfig } from './config.js';
import { GuidesError } from './models.js';

// ---------------------------------------------------------------------------
// Registry 条目类型（clowder GuideRegistryEntry 字段级兼容）
// ---------------------------------------------------------------------------

export interface GuideRegistryEntry {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  category: string;
  priority: string;
  cross_system: boolean;
  estimated_time: string;
  flow_file: string;
  requires_member_cards?: boolean;
}

interface RegistryFile {
  guides: GuideRegistryEntry[];
}

/** 合法 guide target 字符集（advance/target 校验用）。 */
export const GUIDE_TARGET_RE = /^[a-zA-Z0-9._-]+$/;

// ---------------------------------------------------------------------------
// 加载器（可注入路径；模块级缓存对齐 clowder）
// ---------------------------------------------------------------------------

export interface GuideRegistryLoaderOptions {
  /** registry.yaml 绝对路径（缺省包内置 config/registry.yaml）。 */
  registryPath?: string;
  /** 关键词反向子串匹配阈值（缺省取 clowder MIN_ASCII=3 / MIN_NON_ASCII=2）。 */
  minAsciiReverseMatchLength?: number;
  minNonAsciiReverseMatchLength?: number;
}

/** 从 GuidesConfig 构造加载器选项（configPath 相对 config/ 目录解析）。 */
export function loaderOptionsFromConfig(config: GuidesConfig, configDir?: string): GuideRegistryLoaderOptions {
  const raw = config.guides.registry_path;
  const baseDir = configDir ?? dirname(builtinRegistryYamlPath());
  return {
    registryPath: isAbsolute(raw) ? raw : resolve(baseDir, raw),
    minAsciiReverseMatchLength: config.guides.min_ascii_reverse_match_length,
    minNonAsciiReverseMatchLength: config.guides.min_non_ascii_reverse_match_length,
  };
}

export class GuideRegistryLoader {
  private readonly registryPath: string;
  /** 反向子串匹配阈值（模块级 resolveGuideForIntent 访问，clowder 同模块级常量）。 */
  readonly minAscii: number;
  readonly minNonAscii: number;
  private entries: GuideRegistryEntry[] | null = null;
  private ids: Set<string> | null = null;
  /** flow 缓存（loadGuideFlowFrom 模块级读写）。 */
  readonly flowCache = new Map<string, OrchestrationFlow>();

  constructor(options: GuideRegistryLoaderOptions = {}) {
    this.registryPath = options.registryPath ?? builtinRegistryYamlPath();
    this.minAscii = options.minAsciiReverseMatchLength ?? 3;
    this.minNonAscii = options.minNonAsciiReverseMatchLength ?? 2;
  }

  /** 强制重载（测试用；registry 文件变更后调用）。 */
  reset(): void {
    this.entries = null;
    this.ids = null;
    this.flowCache.clear();
  }

  /** 已加载的 registry 绝对路径（诊断用）。 */
  getRegistryPath(): string {
    return this.registryPath;
  }

  // -- 内部加载 --

  private ensureLoaded(): void {
    if (this.entries) return;
    if (!existsSync(this.registryPath)) {
      throw new GuidesError(`[F155] Guide registry 不存在: ${this.registryPath}`);
    }
    const raw = readFileSync(this.registryPath, 'utf-8');
    const parsed = parseYaml(raw) as RegistryFile | null;
    if (!parsed?.guides || !Array.isArray(parsed.guides)) {
      throw new GuidesError('[F155] Invalid guide registry: missing "guides" array');
    }
    this.entries = parsed.guides;
    this.ids = new Set(parsed.guides.map((g) => g.id));
  }

  // -- 查询 --

  /** 有效 guide ID 集合。 */
  getValidGuideIds(): Set<string> {
    this.ensureLoaded();
    return this.ids!;
  }

  /** 全部 registry 条目。 */
  getRegistryEntries(): GuideRegistryEntry[] {
    this.ensureLoaded();
    return this.entries!;
  }

  /** 校验 guide target 字符集（advance/target）。 */
  isValidGuideTarget(target: string): boolean {
    return GUIDE_TARGET_RE.test(target);
  }

  /** guideId 是否已注册。 */
  isValidGuideId(guideId: string): boolean {
    return this.getValidGuideIds().has(guideId);
  }
}

// ---------------------------------------------------------------------------
// OrchestrationFlow（clowder guide-registry-loader.ts 直译）
// ---------------------------------------------------------------------------

export interface TipsMetadata {
  /** data-guide-id of a pre-composed card div (type: 'card') */
  target?: string;
  type: 'card' | 'png';
  /** Static image path (type: 'png') */
  src?: string;
  layout?: 'horizontal' | 'vertical';
  alt?: string;
}

export interface OrchestrationStep {
  id: string;
  target: string;
  tips: string;
  advance: 'click' | 'visible' | 'input' | 'confirm' | 'auto-confirm' | 'next';
  page?: string;
  timeoutSec?: number;
  tipsMetadata?: TipsMetadata;
}

export interface OrchestrationFlow {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  steps: OrchestrationStep[];
}

interface RawFlowFile {
  schemaVersion?: number;
  id: string;
  name: string;
  description?: string;
  steps: Array<{
    id: string;
    target: string;
    tips: string;
    advance: string;
    page?: string;
    timeoutSec?: number;
    tipsMetadata?: {
      target?: string;
      type?: string;
      src?: string;
      layout?: string;
      alt?: string;
    };
  }>;
}

const SUPPORTED_FLOW_SCHEMA_VERSION = 1;
const VALID_ADVANCE = new Set(['click', 'visible', 'input', 'confirm', 'auto-confirm', 'next']);

/** 归一化 flow schemaVersion（缺省 1；非法抛错）。 */
function normalizeFlowSchemaVersion(guideId: string, schemaVersion?: number): 1 {
  if (schemaVersion == null) return SUPPORTED_FLOW_SCHEMA_VERSION;
  if (schemaVersion !== SUPPORTED_FLOW_SCHEMA_VERSION) {
    throw new GuidesError(`[F155] Unsupported flow schemaVersion "${schemaVersion}" for "${guideId}"`);
  }
  return SUPPORTED_FLOW_SCHEMA_VERSION;
}

/**
 * 加载 guide flow YAML（相对 registry 所在目录的 flow_file 解析）并返回 OrchestrationFlow。
 * guideId 未知或 flow 文件非法时抛错（fail-fast，对齐 clowder）。
 */
export function loadGuideFlowFrom(
  loader: GuideRegistryLoader,
  guideId: string,
  registryDir: string = dirname(loader.getRegistryPath()),
): OrchestrationFlow {
  const cached = loader.flowCache.get(guideId);
  if (cached) return cached;

  const entry = loader.getRegistryEntries().find((e) => e.id === guideId);
  if (!entry) throw new GuidesError(`[F155] Unknown guide: ${guideId}`);

  const flowPath = isAbsolute(entry.flow_file) ? entry.flow_file : resolve(registryDir, entry.flow_file);
  if (!existsSync(flowPath)) {
    throw new GuidesError(`[F155] Flow file 不存在: ${flowPath}（guide "${guideId}"）`);
  }
  const raw = readFileSync(flowPath, 'utf-8');
  const parsed = parseYaml(raw) as RawFlowFile | null;

  if (parsed?.id !== guideId) {
    throw new GuidesError(
      `[F155] Invalid flow file for "${guideId}": expected id "${guideId}", got "${String(parsed?.id ?? '')}"`,
    );
  }
  if (!parsed?.steps || !Array.isArray(parsed.steps)) {
    throw new GuidesError(`[F155] Invalid flow file for "${guideId}": missing steps`);
  }

  const flow: OrchestrationFlow = {
    schemaVersion: normalizeFlowSchemaVersion(guideId, parsed.schemaVersion),
    id: parsed.id,
    name: parsed.name,
    ...(parsed.description ? { description: parsed.description } : {}),
    steps: parsed.steps.map((s) => {
      if (!VALID_ADVANCE.has(s.advance)) {
        throw new GuidesError(`[F155] Invalid advance type "${s.advance}" in step "${s.id}"`);
      }
      if (!loader.isValidGuideTarget(s.target)) {
        throw new GuidesError(`[F155] Invalid target "${s.target}" in step "${s.id}"`);
      }
      const step: OrchestrationStep = {
        id: s.id,
        target: s.target,
        tips: s.tips,
        advance: s.advance as OrchestrationStep['advance'],
        ...(s.page && { page: s.page }),
        ...(s.timeoutSec && { timeoutSec: s.timeoutSec }),
      };
      if (s.tipsMetadata?.type === 'card' || s.tipsMetadata?.type === 'png') {
        step.tipsMetadata = {
          type: s.tipsMetadata.type,
          ...(s.tipsMetadata.target && { target: s.tipsMetadata.target }),
          ...(s.tipsMetadata.src && { src: s.tipsMetadata.src }),
          ...(s.tipsMetadata.layout && { layout: s.tipsMetadata.layout as 'horizontal' | 'vertical' }),
          ...(s.tipsMetadata.alt && { alt: s.tipsMetadata.alt }),
        };
      }
      return step;
    }),
  };

  loader.flowCache.set(guideId, flow);
  return flow;
}

// ---------------------------------------------------------------------------
// 意图匹配 / 可用性（clowder resolveGuideForIntent / getAvailableGuides 直译）
// ---------------------------------------------------------------------------

export interface AvailableGuide {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: string;
  crossSystem: boolean;
  estimatedTime: string;
}

export interface GuideAvailabilityContext {
  memberCardCount?: number;
}

export interface GuideMatch {
  id: string;
  name: string;
  description: string;
  estimatedTime: string;
  score: number;
  totalKeywords: number;
}

export interface GuideResolveContext {
  memberCardCount?: number;
}

function normalizeGuideIntent(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function entryIsAvailable(entry: GuideRegistryEntry, context?: GuideAvailabilityContext | GuideResolveContext): boolean {
  if (entry.requires_member_cards && (context?.memberCardCount ?? 0) <= 0) return false;
  return true;
}

/**
 * 按用户意图匹配 guide registry 关键词，按分数降序返回。
 * 正向子串匹配 + 反向子串匹配（仅当查询足够长：ASCII≥3 / 非 ASCII≥2）。
 */
export function resolveGuideForIntent(
  loader: GuideRegistryLoader,
  intent: string,
  context?: GuideResolveContext,
): GuideMatch[] {
  const entries = loader.getRegistryEntries();
  const query = normalizeGuideIntent(intent);
  if (!query) return [];

  const compact = query.replace(/\s+/g, '');
  const allowReverseSubstringMatch = compact
    ? /^[a-z0-9._-]+$/i.test(compact)
      ? compact.length >= loader.minAscii
      : compact.length >= loader.minNonAscii
    : false;

  return entries
    .filter((entry) => entryIsAvailable(entry, context))
    .map((entry) => {
      const score = entry.keywords.filter((keyword) => {
        const normalizedKeyword = normalizeGuideIntent(keyword);
        return query.includes(normalizedKeyword) || (allowReverseSubstringMatch && normalizedKeyword.includes(query));
      }).length;

      return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        estimatedTime: entry.estimated_time,
        score,
        totalKeywords: entry.keywords.length,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.totalKeywords - b.totalKeywords);
}

/** 可用 guide 目录（entryIsAvailable 过滤 requires_member_cards）。 */
export function getAvailableGuides(
  loader: GuideRegistryLoader,
  context?: GuideAvailabilityContext,
): AvailableGuide[] {
  return loader
    .getRegistryEntries()
    .filter((entry) => entryIsAvailable(entry, context))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      priority: entry.priority,
      crossSystem: entry.cross_system,
      estimatedTime: entry.estimated_time,
    }));
}
