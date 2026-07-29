#!/usr/bin/env node

/**
 * FlowForge Web — Vendor Assets Sync Script
 *
 * 来源：clowder-ai/packages/web/scripts/sync-vendor-assets.mjs（简化版）
 * 改动：
 *   1. 删除 VAD/ONNX/esbuild 同步（FlowForge 不需要语音 VAD）
 *   2. 保留 xterm.css 同步（TerminalPanel 需要）
 *   3. 保留 app global CSS 同步（src/app/*.css → public/vendor/app/*.css）
 *   4. CSS 文件名重命名：cat-persona-* → forgekin-persona-*
 *
 * 使用：
 *   - 直接运行：node scripts/sync-vendor-assets.mjs
 *   - watch 模式：node scripts/sync-vendor-assets.mjs --watch
 *   - npm 脚本：predev / prebuild 自动调用
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, '..');
const vendorRoot = resolve(webRoot, 'public', 'vendor');

/**
 * 需要从 src/app 同步到 public/vendor/app 的 CSS 文件
 * 注意：cat-persona-tokens.css → forgekin-persona-tokens.css（重命名）
 */
const appGlobalCssFiles = [
  'theme-tokens.css',
  'forgekin-persona-tokens.css',  // 源文件已是 forgekin-persona-tokens.css（复制时已重命名）
  'forgekin-persona-derived.css',
  'console-shell.css',
  'console-controls.css',
  'console-tokens.css',
  'connector-tokens.css',
  'theme-extras.css',
];

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function resolvePackageDir(pkgName) {
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`, { paths: [webRoot] });
    return dirname(pkgJsonPath);
  } catch {
    const entryPath = require.resolve(pkgName, { paths: [webRoot] });
    let current = dirname(entryPath);
    while (current !== dirname(current)) {
      if (existsSync(resolve(current, 'package.json'))) return current;
      current = dirname(current);
    }
    throw new Error(`Cannot resolve package root for ${pkgName}`);
  }
}

function copyAsset(src, dest) {
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  console.log(`[sync-vendor-assets] ${src} -> ${dest}`);
}

/**
 * 同步 xterm CSS（从 @xterm/xterm 包中复制）
 */
function copyXtermCss() {
  try {
    const xtermCssPath = resolve(resolvePackageDir('@xterm/xterm'), 'css', 'xterm.css');
    if (!existsSync(xtermCssPath)) {
      console.warn(`[sync-vendor-assets] xterm CSS not found, skipping: ${xtermCssPath}`);
      return;
    }
    copyAsset(xtermCssPath, resolve(vendorRoot, 'xterm', 'xterm.css'));
  } catch (error) {
    console.warn(`[sync-vendor-assets] xterm copy skipped: ${error.message}`);
  }
}

function appGlobalCssPaths(file) {
  return {
    src: resolve(webRoot, 'src', 'app', file),
    dest: resolve(vendorRoot, 'app', file),
  };
}

function copyAppGlobalCssFile(file) {
  const { src, dest } = appGlobalCssPaths(file);
  if (!existsSync(src)) {
    throw new Error(`Missing app global CSS: ${src}`);
  }
  copyAsset(src, dest);
}

function copyAppGlobalCss() {
  for (const file of appGlobalCssFiles) {
    copyAppGlobalCssFile(file);
  }
}

function watchAppGlobalCss() {
  for (const cssFile of appGlobalCssFiles) {
    const { src } = appGlobalCssPaths(cssFile);
    if (!existsSync(src)) {
      throw new Error(`Missing app global CSS: ${src}`);
    }
  }
  return [
    watch(resolve(webRoot, 'src', 'app'), { persistent: true }, (_eventType, filename) => {
      const file = typeof filename === 'string' ? filename : filename?.toString();
      const exact = file && appGlobalCssFiles.includes(file);
      if (file && !exact && !file.endsWith('.css') && !file.includes('.css.')) return;
      try {
        if (exact) {
          copyAppGlobalCssFile(file);
        } else {
          copyAppGlobalCss();
        }
      } catch (error) {
        console.error('[sync-vendor-assets] watch failed:', error instanceof Error ? error.message : String(error));
      }
    }),
  ];
}

function syncVendorAssets() {
  copyXtermCss();
  copyAppGlobalCss();
}

function closeWatchers(watchers) {
  for (const watcher of watchers) {
    watcher.close();
  }
}

function runWatchMode(commandArgs) {
  syncVendorAssets();
  const watchers = watchAppGlobalCss();

  if (commandArgs.length === 0) {
    console.log('[sync-vendor-assets] watching app global CSS');
    return;
  }

  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  let closing = false;

  const close = (signal) => {
    if (closing) return;
    closing = true;
    closeWatchers(watchers);
    if (!child.killed) child.kill(signal);
  };

  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));
  child.once('error', (error) => {
    closeWatchers(watchers);
    console.error('[sync-vendor-assets] command failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
  child.once('exit', (code, signal) => {
    closeWatchers(watchers);
    if (signal) {
      process.exit(128);
    }
    process.exit(typeof code === 'number' ? code : 0);
  });
}

function parseArgs(argv) {
  if (argv[0] !== '--watch') {
    return { watchMode: false, commandArgs: [] };
  }
  const separator = argv.indexOf('--');
  return {
    watchMode: true,
    commandArgs: separator === -1 ? argv.slice(1) : argv.slice(separator + 1),
  };
}

try {
  const { watchMode, commandArgs } = parseArgs(process.argv.slice(2));
  if (watchMode) {
    runWatchMode(commandArgs);
  } else {
    syncVendorAssets();
  }
} catch (error) {
  console.error('[sync-vendor-assets] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
