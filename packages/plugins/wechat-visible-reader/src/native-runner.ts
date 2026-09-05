/**
 * WeChat Visible Reader 原生 runner（C35，自包含移植）。
 *
 * 编译/执行 macOS 原生 Swift 读取器：源码哈希键控缓存（sha256 摘要 → tmpdir
 * 可执行文件），`--probe` / `--read` / `--navigation-spike` /
 * `--read-conversation-recent` 四命令；参数校验（limits/contact）在 TS 侧
 * 完成，native 输出经 zod schema 严格解析。任何执行失败回落到
 * `capture_failed` 安全失败，绝不透传原生原始输出。
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseWeChatConversationRecentResult,
  parseWeChatNavigationSpikeResult,
  parseWeChatVisibleProbeResult,
  parseWeChatVisibleReadResult,
  type WeChatConversationRecentResult,
  type WeChatNavigationSpikeResult,
  type WeChatVisibleFailure,
  type WeChatVisibleProbeResult,
  type WeChatVisibleReadResult,
} from './types.ts';

export const DEFAULT_WECHAT_VISIBLE_BLOCKS = 80;
export const DEFAULT_WECHAT_VISIBLE_CHARS = 8_000;
export const MAX_WECHAT_VISIBLE_BLOCKS = 200;
export const MAX_WECHAT_VISIBLE_CHARS = 20_000;

const NATIVE_TIMEOUT_MS = 30_000;
const NATIVE_NAVIGATION_TIMEOUT_MS = 60_000;
const NATIVE_COMPILE_TIMEOUT_MS = 120_000;
const NATIVE_MAX_BUFFER_BYTES = 512 * 1024;

/** 原生 Swift 源文件按依赖顺序列出（生产用，插件随包分发）。 */
export const DEFAULT_NATIVE_SOURCE_NAMES = [
  'WeChatReaderModels.swift',
  'WeChatReaderCore.swift',
  'WeChatLayoutGuard.swift',
  'WeChatNavigationModels.swift',
  'WeChatConversationNavigator.swift',
  'WeChatNavigationFixtures.swift',
  'WeChatVisibleReader.swift',
] as const;

export interface WeChatVisibleReadOptions {
  maxBlocks?: number;
  maxChars?: number;
}

export interface WeChatConversationRecentOptions {
  contact: string;
  limit: number;
}

export interface NativeExecutionOptions {
  encoding: 'utf8';
  timeout: number;
  maxBuffer: number;
  windowsHide: true;
}

export type NativeCommandExecutor = (
  file: string,
  args: readonly string[],
  options: NativeExecutionOptions,
) => Promise<{ stdout: string }>;

export interface WeChatVisibleReaderNativeRunnerOptions {
  /** 原生 Swift 源文件路径（生产由宿主注入 bundle 内路径）。 */
  sourcePaths?: readonly string[];
  /** 测试用确定性编译断言捷径。 */
  sourceDigest?: string;
  cacheDirectory?: string;
  /** 预编译可执行文件测试缝；生产不设置。 */
  executablePath?: string;
  execute?: NativeCommandExecutor;
}

export interface WeChatVisibleReaderNativeRunner {
  read(options?: WeChatVisibleReadOptions): Promise<WeChatVisibleReadResult>;
  probe(): Promise<WeChatVisibleProbeResult>;
  navigationSpike(contact: string): Promise<WeChatNavigationSpikeResult>;
  readConversationRecent(options: WeChatConversationRecentOptions): Promise<WeChatConversationRecentResult>;
}

const SAFE_CAPTURE_FAILURE: WeChatVisibleFailure = {
  ok: false,
  error: {
    code: 'capture_failed',
    userAction: '微信读取失败，请稍后重试。',
  },
};

const defaultExecutor: NativeCommandExecutor = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });

function isValidLimit(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= maximum;
}

function isValidContact(value: string): boolean {
  const trimmed = value.trim();
  const containsControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  return trimmed.length > 0 && [...trimmed].length <= 128 && !containsControlCharacter;
}

function safeCaptureFailure(): WeChatVisibleFailure {
  return {
    ok: false,
    error: { ...SAFE_CAPTURE_FAILURE.error },
  };
}

async function hashSources(sourcePaths: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const sourcePath of sourcePaths) {
    hash.update(sourcePath);
    hash.update('\0');
    hash.update(await readFile(sourcePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function createWeChatVisibleReaderNativeRunner(
  options: WeChatVisibleReaderNativeRunnerOptions = {},
): WeChatVisibleReaderNativeRunner {
  const execute = options.execute ?? defaultExecutor;
  const injectedExecutable =
    options.executablePath ?? (options.execute && !options.sourceDigest ? '/injected/cat-cafe-wechat-visible-reader' : undefined);
  const sourcePaths = options.sourcePaths ?? [];
  const cacheDirectory = options.cacheDirectory ?? tmpdir();
  let executablePromise: Promise<string> | undefined;

  const resolveExecutable = (): Promise<string> => {
    if (injectedExecutable) return Promise.resolve(injectedExecutable);
    if (sourcePaths.length === 0) {
      // 生产宿主注入 native 源路径；无路径时无法编译，回落到安全失败。
      return Promise.resolve('');
    }
    executablePromise ??= (async () => {
      const digest = options.sourceDigest ?? (await hashSources(sourcePaths));
      const executable = join(cacheDirectory, `cat-cafe-wechat-reader-${digest}`);
      try {
        await access(executable, fsConstants.X_OK);
        return executable;
      } catch {
        // A source-hash keyed executable contains code only. No capture, OCR,
        // message body, or user data is written into this cache.
      }
      if (execute === defaultExecutor) {
        await mkdir(cacheDirectory, { recursive: true });
      }
      await execute('/usr/bin/xcrun', ['swiftc', ...sourcePaths, '-o', executable], {
        encoding: 'utf8',
        timeout: NATIVE_COMPILE_TIMEOUT_MS,
        maxBuffer: NATIVE_MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      return executable;
    })();
    return executablePromise;
  };

  return {
    async probe(): Promise<WeChatVisibleProbeResult> {
      try {
        const executable = await resolveExecutable();
        if (!executable) return safeCaptureFailure();
        const { stdout } = await execute(executable, ['--probe'], {
          encoding: 'utf8',
          timeout: NATIVE_TIMEOUT_MS,
          maxBuffer: NATIVE_MAX_BUFFER_BYTES,
          windowsHide: true,
        });
        return parseWeChatVisibleProbeResult(JSON.parse(stdout));
      } catch {
        return safeCaptureFailure();
      }
    },
    async navigationSpike(contact: string): Promise<WeChatNavigationSpikeResult> {
      if (!isValidContact(contact)) return safeCaptureFailure();
      try {
        const executable = await resolveExecutable();
        if (!executable) return safeCaptureFailure();
        const { stdout } = await execute(executable, ['--navigation-spike', '--contact', contact], {
          encoding: 'utf8',
          timeout: NATIVE_TIMEOUT_MS,
          maxBuffer: NATIVE_MAX_BUFFER_BYTES,
          windowsHide: true,
        });
        return parseWeChatNavigationSpikeResult(JSON.parse(stdout));
      } catch {
        return safeCaptureFailure();
      }
    },
    async readConversationRecent(readOptions): Promise<WeChatConversationRecentResult> {
      if (!isValidContact(readOptions.contact) || !isValidLimit(readOptions.limit, 30)) {
        return safeCaptureFailure();
      }
      const contact = readOptions.contact.trim();
      try {
        const executable = await resolveExecutable();
        if (!executable) return safeCaptureFailure();
        const { stdout } = await execute(
          executable,
          ['--read-conversation-recent', '--contact', contact, '--limit', String(readOptions.limit)],
          {
            encoding: 'utf8',
            timeout: NATIVE_NAVIGATION_TIMEOUT_MS,
            maxBuffer: NATIVE_MAX_BUFFER_BYTES,
            windowsHide: true,
          },
        );
        return parseWeChatConversationRecentResult(JSON.parse(stdout), {
          maxBlocks: readOptions.limit,
          maxChars: MAX_WECHAT_VISIBLE_CHARS,
        });
      } catch {
        return safeCaptureFailure();
      }
    },
    async read(readOptions = {}): Promise<WeChatVisibleReadResult> {
      const maxBlocks = readOptions.maxBlocks ?? DEFAULT_WECHAT_VISIBLE_BLOCKS;
      const maxChars = readOptions.maxChars ?? DEFAULT_WECHAT_VISIBLE_CHARS;
      if (!isValidLimit(maxBlocks, MAX_WECHAT_VISIBLE_BLOCKS) || !isValidLimit(maxChars, MAX_WECHAT_VISIBLE_CHARS)) {
        return safeCaptureFailure();
      }

      try {
        const executable = await resolveExecutable();
        if (!executable) return safeCaptureFailure();
        const { stdout } = await execute(
          executable,
          ['--read', '--max-blocks', String(maxBlocks), '--max-chars', String(maxChars)],
          {
            encoding: 'utf8',
            timeout: NATIVE_TIMEOUT_MS,
            maxBuffer: NATIVE_MAX_BUFFER_BYTES,
            windowsHide: true,
          },
        );
        return parseWeChatVisibleReadResult(JSON.parse(stdout), { maxBlocks, maxChars });
      } catch {
        return safeCaptureFailure();
      }
    },
  };
}
