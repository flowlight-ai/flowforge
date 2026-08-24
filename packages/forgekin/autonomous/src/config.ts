/**
 * autonomous config — F052 自主守护进程默认配置（对齐 Python 常量，红线 11 可覆盖）。
 *
 * @module @flowforge/forgekin-autonomous
 */

/** 默认 10 分钟扫描一次（operator 要求 10min 自动找需求） */
export const DEFAULT_SCAN_INTERVAL_SECONDS = 600;
/** 同时执行的最大任务数 */
export const DEFAULT_MAX_CONCURRENT_TASKS = 3;
/** 每次扫描最多提交的任务数 */
export const DEFAULT_MAX_TASKS_PER_SCAN = 5;
/** 任务消费循环间隔（秒，与 SwarmCoordinator dispatch 节奏对齐，Bug 1 修复） */
export const DEFAULT_CONSUMER_INTERVAL_SECONDS = 5;
/** 心跳保活间隔（秒，SwarmCoordinator 30s 超时） */
export const DEFAULT_KEEPALIVE_INTERVAL_SECONDS = 10;

/** 文档缺失检查清单（相对项目根目录） */
export const DOC_CHECKLIST: readonly string[] = ['docs/spec.md', 'docs/arch.md'];

/**
 * TODO/FIXME 模式（红线 11：不硬编码，但正则模式是技术常量）。
 */
export const TODO_PATTERNS: readonly RegExp[] = [
  /#\s*TODO[:\s]/i,
  /#\s*FIXME[:\s]/i,
  /raise\s+NotImplementedError/i,
  /pass\s*#\s*placeholder/i,
];

/**
 * 扫描需排除的第三方/生成目录（Bug 3 修复：rglob 默认扫入
 * .venv/node_modules 等导致大量无效 TODO 任务与性能开销）。
 * 目录名按路径段匹配（任意层级）。
 */
export const SCAN_EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  '.venv',
  'venv',
  'env',
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '__pycache__',
  'site-packages',
  'build',
  'dist',
  '.next',
  '.nuxt',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.eggs',
  '.autonomous',
  'logs',
  'data',
]);

/** 无效产出标记（Bug 2 修复：覆盖 CLI 错误前缀） */
export const INVALID_OUTPUT_MARKERS: readonly string[] = [
  '无法回答',
  '无法回答这个问题',
  '我不能回答',
  '我无法提供',
  '[ZHIPU HTTP 429]',
  '[OpenRoute 超时]',
  '[ZHIPU 异常]',
  '[OpenRoute 异常]',
  '余额不足',
  '当前不可用',
  '[CLI 不可用]',
  '[CLI 错误]',
  '[CLI 超时]',
  '[CLI 启动失败]',
  '[CLI 退出码]',
];

/** 无效产出最小长度（低于该值视为无效） */
export const MIN_VALID_OUTPUT_LENGTH = 20;

/** 守护进程运行配置（可经 YAML/构造注入覆盖，红线 11） */
export interface AutonomousConfig {
  readonly scan_interval_seconds: number;
  readonly max_concurrent_tasks: number;
  readonly max_tasks_per_scan: number;
  readonly consumer_interval_seconds: number;
  readonly keepalive_interval_seconds: number;
}

/** 构造默认守护进程配置（支持部分覆盖） */
export function makeAutonomousConfig(
  overrides: Partial<AutonomousConfig> = {},
): AutonomousConfig {
  return {
    scan_interval_seconds: DEFAULT_SCAN_INTERVAL_SECONDS,
    max_concurrent_tasks: DEFAULT_MAX_CONCURRENT_TASKS,
    max_tasks_per_scan: DEFAULT_MAX_TASKS_PER_SCAN,
    consumer_interval_seconds: DEFAULT_CONSUMER_INTERVAL_SECONDS,
    keepalive_interval_seconds: DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
    ...overrides,
  };
}

/** 项目扫描配置（目录/清单/模式均可注入，红线 11） */
export interface ScannerConfig {
  /** 文档缺失检查清单（相对项目根） */
  readonly docChecklist: readonly string[];
  /** TODO/FIXME 正则模式 */
  readonly todoPatterns: readonly RegExp[];
  /** 排除目录名集合（按路径段匹配） */
  readonly excludedDirs: ReadonlySet<string>;
  /** 代码/测试扫描源目录（相对项目根，对齐 Python 的 flowforge 目录） */
  readonly sourceDirName: string;
  /** 扫描的源码扩展名 */
  readonly sourceExtensions: readonly string[];
  /** 核心模块清单（相对源目录，缺失测试检查对象） */
  readonly coreModules: readonly string[];
  /** 测试目录名（源目录下） */
  readonly testsDirName: string;
  /** 测试文件前缀/扩展名 */
  readonly testFilePrefix: string;
  readonly testFileExtension: string;
  /** import 匹配前缀（对齐 Python 的 flowforge 包前缀） */
  readonly importPrefix: string;
}

/** 构造默认扫描配置（支持部分覆盖） */
export function makeScannerConfig(
  overrides: Partial<ScannerConfig> = {},
): ScannerConfig {
  return {
    docChecklist: DOC_CHECKLIST,
    todoPatterns: TODO_PATTERNS,
    excludedDirs: SCAN_EXCLUDED_DIRS,
    sourceDirName: 'flowforge',
    sourceExtensions: ['.py'],
    coreModules: ['forgemind/swarm.py', 'forgemind/base.py', 'evolution/auto_dream.py'],
    testsDirName: 'tests',
    testFilePrefix: 'test_',
    testFileExtension: '.py',
    importPrefix: 'flowforge',
    ...overrides,
  };
}
