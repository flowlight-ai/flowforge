/**
 * @flowforge/forgekin-external-agents — 外部第三方 Agent 适配器
 *
 * 对齐 Python `forgemind/external_agents.py`：Forgekin 通过子进程调用
 * 第三方编码/Agent 工具（claude_code / codex / gemini / opencode / trae /
 * custom），崩溃隔离在子进程内，统一异步接口 invoke(prompt) → stdout。
 */
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import * as path from 'node:path';

/** 外部 Agent 种类（对齐 ExternalAgentKind 枚举） */
export const ExternalAgentKind = {
  CLAUDE_CODE: 'claude_code',
  CODEX: 'codex',
  GEMINI: 'gemini',
  OPENCODE: 'opencode',
  TRAE: 'trae',
  CUSTOM: 'custom',
} as const;

export type ExternalAgentKind = (typeof ExternalAgentKind)[keyof typeof ExternalAgentKind];

/** 一个外部 Agent 适配器的配置（对齐 ExternalAgentConfig dataclass） */
export interface ExternalAgentConfig {
  readonly kind: ExternalAgentKind;
  /** CLI 二进制名（如 claude / codex / opencode / trae） */
  readonly binary: string;
  readonly description?: string | undefined;
  /** 附加子进程环境变量（叠加在父进程 env 之上） */
  readonly env?: Record<string, string> | undefined;
  readonly defaultTimeout?: number | undefined;
}

/** 子进程执行器：args 为完整 argv，返回 stdout 文本 */
export type SpawnFn = (args: string[], options: SpawnOptions) => Promise<string>;

export interface SpawnOptions {
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly timeoutMs: number;
}

/** 二进制探测器：返回可执行文件绝对路径，未找到返回 null */
export type BinaryResolver = (binary: string) => string | null;

/** 外部 Agent 调用失败（对齐 ExternalAgentError） */
export class ExternalAgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExternalAgentError';
  }
}

/** 默认二进制探测：遍历 PATH（Windows 附加 .exe/.cmd/.bat/.com 扩展名） */
export function findInPath(binary: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.com'] : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // 继续探测下一个候选
      }
    }
  }
  return null;
}

/** 默认子进程执行器：spawn + 超时 kill + 非零退出码报错 */
export function defaultSpawn(args: string[], options: SpawnOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(args[0] ?? '', args.slice(1), {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new ExternalAgentError(`External agent ${args[0] ?? ''} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ExternalAgentError(`Failed to spawn ${args[0] ?? ''}`, { cause: err }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new ExternalAgentError(
          `External agent ${args[0] ?? ''} exited with ${code}: ${stderr.slice(0, 200)}`,
        ));
        return;
      }
      resolve(stdout);
    });
  });
}

/** 默认配置——可由 forgemind.yaml 的 external_agents 段覆盖（对齐 DEFAULT_CONFIGS，仅五种内置 kind，不含 custom） */
export const DEFAULT_CONFIGS: Readonly<Partial<Record<ExternalAgentKind, ExternalAgentConfig>>> = {
  [ExternalAgentKind.CLAUDE_CODE]: {
    kind: ExternalAgentKind.CLAUDE_CODE,
    binary: 'claude',
    description: 'Anthropic Claude Code — coding & code review',
  },
  [ExternalAgentKind.CODEX]: {
    kind: ExternalAgentKind.CODEX,
    binary: 'codex',
    description: 'OpenAI Codex CLI — code generation',
  },
  [ExternalAgentKind.GEMINI]: {
    kind: ExternalAgentKind.GEMINI,
    binary: 'gemini',
    description: 'Google Gemini CLI — multimodal coding & review',
  },
  [ExternalAgentKind.OPENCODE]: {
    kind: ExternalAgentKind.OPENCODE,
    binary: 'opencode',
    description: 'Open-source coding agent',
  },
  [ExternalAgentKind.TRAE]: {
    kind: ExternalAgentKind.TRAE,
    binary: 'trae',
    description: 'Trae IDE agent — coding & debugging',
  },
};

export interface ExternalAgentAdapterOptions {
  readonly resolveBinary?: BinaryResolver | undefined;
  readonly spawnFn?: SpawnFn | undefined;
}

/** 子进程型外部 Agent 适配器（对齐 ExternalAgentAdapter） */
export class ExternalAgentAdapter {
  readonly config: ExternalAgentConfig;
  private readonly resolveBinary: BinaryResolver;
  private readonly spawnFn: SpawnFn;

  constructor(config: ExternalAgentConfig, options: ExternalAgentAdapterOptions = {}) {
    this.config = config;
    this.resolveBinary = options.resolveBinary ?? findInPath;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
  }

  /** 探测该 Agent 的 CLI 二进制是否已安装（shutil.which 语义） */
  isAvailable(): boolean {
    return this.resolveBinary(this.config.binary) !== null;
  }

  /** 以 one-shot prompt 模式调用外部 Agent，返回 stdout 文本 */
  async invoke(
    prompt: string,
    options: {
      cwd?: string | undefined;
      timeout?: number | undefined;
      extraArgs?: string[] | undefined;
    } = {},
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new ExternalAgentError(
        `External agent ${this.config.kind} binary '${this.config.binary}' not found in PATH`,
      );
    }
    const args = [this.config.binary];
    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(...options.extraArgs);
    }
    args.push('--prompt', prompt);
    const timeoutMs = (options.timeout ?? this.config.defaultTimeout ?? 120) * 1000;
    return this.spawnFn(args, {
      cwd: options.cwd,
      env: this.config.env,
      timeoutMs,
    });
  }
}

/** 构造全部内置外部 Agent 适配器（对齐 build_default_adapters，仅五种内置 kind，不含 custom） */
export function buildDefaultAdapters(
  options: ExternalAgentAdapterOptions = {},
): ReadonlyMap<ExternalAgentKind, ExternalAgentAdapter> {
  const adapters = new Map<ExternalAgentKind, ExternalAgentAdapter>();
  for (const kind of Object.keys(DEFAULT_CONFIGS) as ExternalAgentKind[]) {
    adapters.set(kind, new ExternalAgentAdapter(DEFAULT_CONFIGS[kind]!, options));
  }
  return adapters;
}

/**
 * 从 forgemind 配置加载外部 Agent 适配器（对齐 load_adapters_from_config）。
 *
 * 配置格式（external_agents 段）：
 *   external_agents:
 *     claude_code:
 *       binary: claude
 *       env: { ANTHROPIC_API_KEY: xxx }
 *     codex: { binary: codex }
 *
 * 无 external_agents 段或为空 → 回退默认适配器；存在则按段逐 kind 覆盖合并。
 */
export function loadAdaptersFromConfig(
  forgemindConfig: Readonly<Record<string, unknown>>,
  options: ExternalAgentAdapterOptions = {},
): ReadonlyMap<ExternalAgentKind, ExternalAgentAdapter> {
  const raw = (forgemindConfig.external_agents ?? {}) as Readonly<Record<string, unknown>> | undefined;
  if (!raw || Object.keys(raw).length === 0) {
    return buildDefaultAdapters(options);
  }
  const adapters = new Map<ExternalAgentKind, ExternalAgentAdapter>();
  for (const kind of Object.keys(DEFAULT_CONFIGS) as ExternalAgentKind[]) {
    const cfg = DEFAULT_CONFIGS[kind]!;
    const override = raw[kind] ?? raw[kind.replace('_', '-')] ?? {};
    if (override && typeof override === 'object' && Object.keys(override).length > 0) {
      const rec = override as Readonly<Record<string, unknown>>;
      adapters.set(kind, new ExternalAgentAdapter({
        kind,
        binary: typeof rec.binary === 'string' ? rec.binary : cfg.binary,
        description: typeof rec.description === 'string' ? rec.description : cfg.description,
        env: {
          ...(cfg.env ?? {}),
          ...(rec.env && typeof rec.env === 'object' ? rec.env as Readonly<Record<string, string>> : {}),
        },
        defaultTimeout: typeof rec.default_timeout === 'number' ? rec.default_timeout : cfg.defaultTimeout,
      }, options));
    } else {
      adapters.set(kind, new ExternalAgentAdapter(cfg, options));
    }
  }
  return adapters;
}
