/**
 * @flowforge/config-schema — D28 配置体系基座：前端 schema 校验核心。
 *
 * 纯浏览器安全、零依赖的 env/config 编辑校验单一来源。与后端 env 契约
 * （packages/harness/env-registry EnvDefinition：sensitive/editable/
 * allowedValues/required 语义）对齐，但**不 import** 任何 Node/cordis 代码，
 * web 与 host 共享同一份源码（web 经 file: 依赖 + next transpilePackages）。
 *
 * 当前 surface：env 变量编辑器。校验前在 UI 层完成：
 *  1. 字段模型归一 toEnvSchemaEntry（legacy /api/v1/env payload 优雅降级）
 *  2. 单变量校验 validateEnvSchemaValue（可编辑白名单/必填/allowedValues/
 *     boolean 字面量/masked 哨兵未改放行）
 *  3. 整份草稿 validateEnvDraft（byName + allValid）
 *  4. .env 整文件语法解析 parseEnvDraft（行级错误）
 */

export type EnvValueKind = 'boolean' | 'enum' | 'number' | 'string' | 'path';

/** 归一后的 env 编辑条目（web payload 与 env-registry EnvDefinition 的公共视图）。 */
export interface EnvSchemaEntry {
  name: string;
  /** 人类可读说明/label。 */
  description?: string;
  /** 敏感：UI 显示掩码、摘要脱敏。 */
  sensitive: boolean;
  /** 可编辑白名单（服务端语义已应用；false 时拒绝写入）。 */
  editable: boolean;
  /** 必填（空串视为未配置）。 */
  required?: boolean;
  /** 显式允许值（select 选项；缺省仅做结构校验）。 */
  allowedValues?: string[];
  /** 值类型（缺省则除结构校验外不做类型断言）。 */
  valueKind?: EnvValueKind;
  /** 当前值在 UI 以掩码展示（secret）。 */
  masked?: boolean;
  /** 服务端当前值（可为 null）。 */
  currentValue?: string | null;
  /** legacy payload 透传类别（config/secret/path/model）。 */
  category?: string;
}

/** 掩码哨兵：UI 中未改的敏感变量沿用该值，绝不作为新值提交。 */
export const MASKED_VALUE = '***';

export interface EnvValidationResult {
  ok: boolean;
  errors: string[];
}

export interface EnvDraftResult {
  byName: Record<string, EnvValidationResult>;
  allValid: boolean;
}

// ── payload 归一 ────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length === value.length ? items : undefined;
}

function normalizeValueKind(kind: unknown): EnvValueKind | undefined {
  return kind === 'boolean' || kind === 'enum' || kind === 'number' || kind === 'string' || kind === 'path'
    ? kind
    : undefined;
}

/**
 * 归一化 /api/v1/env/summary 条目（含可选扩展字段 allowedValues/required/kind）。
 * 缺字段优雅降级：sensitive ← category==='secret' || masked；可编辑以 payload
 * editable 为准；allowedValues 存在才推 valueKind='enum'。非对象 → null。
 */
export function toEnvSchemaEntry(raw: unknown): EnvSchemaEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const name = asString(record.name);
  if (!name) return null;

  const category = asString(record.category);
  const masked = asBoolean(record.masked) ?? false;
  const explicitSensitive = asBoolean(record.sensitive);
  const sensitive = explicitSensitive === undefined ? category === 'secret' || masked : explicitSensitive;
  const editable = asBoolean(record.editable) ?? false;
  const allowedValues = asStringArray(record.allowedValues);
  const kind = normalizeValueKind(record.kind) ?? (allowedValues ? 'enum' : undefined);

  const description = asString(record.description);
  const required = asBoolean(record.required);
  const rawCurrent = record.currentValue;
  const currentValue = typeof rawCurrent === 'string' && rawCurrent !== '' ? rawCurrent : undefined;

  const entry: EnvSchemaEntry = {
    name,
    editable,
    sensitive,
  };
  if (description !== undefined) entry.description = description;
  if (required !== undefined) entry.required = required;
  if (allowedValues) entry.allowedValues = allowedValues;
  if (kind) entry.valueKind = kind;
  if (masked) entry.masked = true;
  if (currentValue !== undefined) entry.currentValue = currentValue;
  if (category) entry.category = category;
  return entry;
}

// ── 单变量校验 ─────────────────────────────────────────────

const BOOLEAN_LITERALS = new Set(['true', 'false']);

export function isMaskedSecretUnchanged(entry: EnvSchemaEntry, raw: string): boolean {
  return entry.masked === true && raw === MASKED_VALUE;
}

/**
 * 校验单个 env 编辑值：
 *  1. masked 且值等于 MASKED_VALUE → 放行（未改，调用方应跳过 PUT）
 *  2. !editable → 拒绝（写白名单外）
 *  3. required 且 trim 后为空 → 拒绝
 *  4. allowedValues 存在且不含 trim 值 → 拒绝（列出允许值）
 *  5. valueKind==='boolean' 且非 true/false 字面量 → 拒绝
 */
export function validateEnvSchemaValue(entry: EnvSchemaEntry, raw: string): EnvValidationResult {
  const errors: string[] = [];
  const trimmed = raw.trim();

  if (isMaskedSecretUnchanged(entry, raw)) {
    return { ok: true, errors };
  }
  if (!entry.editable) {
    errors.push(`变量 ${entry.name} 不可编辑`);
    return { ok: false, errors };
  }
  if (entry.required === true && trimmed === '') {
    errors.push(`变量 ${entry.name} 不能为空`);
  }
  if (entry.allowedValues && entry.allowedValues.length > 0 && !entry.allowedValues.includes(trimmed)) {
    errors.push(`变量 ${entry.name} 取值必须为：${entry.allowedValues.join(' / ')}`);
  }
  if (entry.valueKind === 'boolean' && trimmed !== '' && !BOOLEAN_LITERALS.has(trimmed)) {
    errors.push(`变量 ${entry.name} 必须是布尔值 true 或 false`);
  }
  return { ok: errors.length === 0, errors };
}

// ── 整份草稿 ───────────────────────────────────────────────

/**
 * 校验草稿中的全部可编辑条目（masked 未改视为 ok）。
 * 返回按 envName 的错误表 + allValid。
 */
export function validateEnvDraft(
  entries: readonly EnvSchemaEntry[],
  drafts: Readonly<Record<string, string>>,
): EnvDraftResult {
  const byName: Record<string, EnvValidationResult> = {};
  let allValid = true;
  for (const entry of entries) {
    const raw = drafts[entry.name];
    if (raw === undefined) continue;
    const result = validateEnvSchemaValue(entry, raw);
    byName[entry.name] = result;
    if (!result.ok) allValid = false;
  }
  return { byName, allValid };
}

// ── .env 整文件语法解析（SystemSection env 文件草稿） ──────

export interface EnvDraftLineError {
  /** 1-based 行号。 */
  line: number;
  text: string;
  message: string;
}

export interface EnvDraftParsedLine {
  name?: string;
  value: string;
}

export interface EnvDraftParseResult {
  lines: EnvDraftParsedLine[];
  errors: EnvDraftLineError[];
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/u;

function stripInlineComment(raw: string): string {
  const hashIndex = raw.indexOf(' #');
  return hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
}

/**
 * 逐行解析 .env 文件草稿：跳过空行/# 注释/export 前缀；剥离行内 ' #' 注释；
 * 非法 NAME 字符与缺失 '=' 的 malformed 行记入 errors（带 1-based 行号）。
 * 不做 per-var registry 查表（文件合并端点无法逐变量校验）。
 */
export function parseEnvDraft(text: string): EnvDraftParseResult {
  const lines: EnvDraftParsedLine[] = [];
  const errors: EnvDraftLineError[] = [];
  const rawLines = text.split(/\r?\n/u);

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? '';
    const lineNo = index + 1;
    let line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      errors.push({ line: lineNo, text: raw, message: `第 ${lineNo} 行缺少 '='：${truncate(raw, 60)}` });
      continue;
    }
    const name = line.slice(0, eqIndex).trim();
    if (!ENV_NAME_PATTERN.test(name)) {
      errors.push({ line: lineNo, text: raw, message: `第 ${lineNo} 行变量名非法：${name}` });
      continue;
    }
    const value = stripInlineComment(line.slice(eqIndex + 1)).trim();
    lines.push({ name, value });
  }

  return { lines, errors };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
