/**
 * config — Trae 桥接配置契约验证（对齐 Python config.py）。
 *
 * 覆盖：makeTraeBridgeConfig 默认值 / 空 shared_dir 回退 / ${ENV:default} 展开 /
 *       loadTraeBridgeConfigFromYaml（内置 YAML 保真 + 文件缺失 + 环境变量覆盖）/
 *       makeTraeClientConfig mode 校验。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultSharedDir,
  expandEnvPlaceholders,
  loadTraeBridgeConfigFromYaml,
  makeTraeBridgeConfig,
  makeTraeClientConfig,
  requestsPath,
  statusFilePath,
} from '../src/config.js';

const BUILTIN_YAML = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'trae-bridge.yaml',
);

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'trae-bridge-cfg-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('makeTraeBridgeConfig 默认值', () => {
  it('全量默认值（对齐 Python TraeBridgeConfig）', () => {
    const config = makeTraeBridgeConfig({ shared_dir: '/tmp/bridge' });
    expect(config).toMatchObject({
      enabled: true,
      shared_dir: '/tmp/bridge',
      requests_dir: 'requests',
      responses_dir: 'responses',
      cancels_dir: 'cancels',
      acks_dir: 'acks',
      archive_dir: 'archive',
      poll_interval_seconds: 2.0,
      default_timeout_seconds: 300,
      long_task_timeout_seconds: 1800,
      ack_timeout_seconds: 60,
      archive_completed: true,
      max_archive_files: 1000,
      cleanup_on_startup: false,
      update_status_on_write: true,
      update_status_on_complete: true,
      stream_enabled: false,
      stream_chunk_interval: 0.5,
      health_check_on_init: true,
    });
  });

  it('空 shared_dir 回退默认值（对齐 _validate_shared_dir）', () => {
    expect(makeTraeBridgeConfig({ shared_dir: '   ' }).shared_dir).toBe(defaultSharedDir());
    expect(makeTraeBridgeConfig().shared_dir).toBe(defaultSharedDir());
  });

  it('路径派生函数', () => {
    const config = makeTraeBridgeConfig({ shared_dir: '/tmp/bridge' });
    expect(requestsPath(config)).toBe(path.join('/tmp/bridge', 'requests'));
    expect(statusFilePath(config)).toBe(path.join('/tmp/bridge', 'status.json'));
  });
});

describe('expandEnvPlaceholders', () => {
  it('${VAR:default} 展开：环境变量存在时用环境变量', () => {
    expect(expandEnvPlaceholders('dir: ${MY_DIR:/fallback}', { MY_DIR: '/real' })).toBe(
      'dir: /real',
    );
  });

  it('${VAR:default} 展开：缺省用默认值；无冒号缺省空串', () => {
    expect(expandEnvPlaceholders('dir: "${MY_DIR:}"', {})).toBe('dir: ""');
    expect(expandEnvPlaceholders('${MY_DIR:sub}', {})).toBe('sub');
    expect(expandEnvPlaceholders('${MY_DIR}', {})).toBe('');
  });
});

describe('loadTraeBridgeConfigFromYaml', () => {
  it('内置 trae-bridge.yaml 保真加载（显式空 env）', async () => {
    const config = await loadTraeBridgeConfigFromYaml(BUILTIN_YAML, { env: {} });
    expect(config.enabled).toBe(true);
    // shared_dir 占位符 ${FLOWFORGE_BRIDGE_DIR:} 展开为空 → 回退默认
    expect(config.shared_dir).toBe(defaultSharedDir());
    expect(config.poll_interval_seconds).toBe(2.0);
    expect(config.default_timeout_seconds).toBe(300);
    expect(config.long_task_timeout_seconds).toBe(1800);
    expect(config.ack_timeout_seconds).toBe(60);
    expect(config.archive_completed).toBe(true);
    expect(config.max_archive_files).toBe(1000);
    expect(config.cleanup_on_startup).toBe(false);
    expect(config.update_status_on_write).toBe(true);
    expect(config.update_status_on_complete).toBe(true);
    expect(config.stream_enabled).toBe(false);
    expect(config.health_check_on_init).toBe(true);
  });

  it('FLOWFORGE_BRIDGE_DIR 环境变量覆盖 shared_dir', async () => {
    const config = await loadTraeBridgeConfigFromYaml(BUILTIN_YAML, {
      env: { FLOWFORGE_BRIDGE_DIR: '/custom/bridge' },
    });
    expect(config.shared_dir).toBe('/custom/bridge');
  });

  it('FLOWFORGE_BRIDGE_* 环境变量优先级高于 YAML', async () => {
    const config = await loadTraeBridgeConfigFromYaml(BUILTIN_YAML, {
      env: {
        FLOWFORGE_BRIDGE_POLL_INTERVAL: '0.5',
        FLOWFORGE_BRIDGE_TIMEOUT: '99',
        FLOWFORGE_BRIDGE_ENABLED: 'false',
      },
    });
    expect(config.poll_interval_seconds).toBe(0.5);
    expect(config.default_timeout_seconds).toBe(99);
    expect(config.enabled).toBe(false);
  });

  it('文件不存在 → 默认配置（对齐 Python FileNotFoundError 分支）', async () => {
    const config = await loadTraeBridgeConfigFromYaml(
      path.join(makeTmpDir(), 'missing.yaml'),
      { env: {} },
    );
    expect(config).toEqual(makeTraeBridgeConfig());
  });

  it('YAML 损坏 → 默认配置；无 bridge 段 → 默认配置', async () => {
    const dir = makeTmpDir();
    const broken = path.join(dir, 'broken.yaml');
    writeFileSync(broken, ':\n  - ]{', 'utf-8');
    expect((await loadTraeBridgeConfigFromYaml(broken, { env: {} })).default_timeout_seconds).toBe(300);

    const noBridge = path.join(dir, 'nobridge.yaml');
    writeFileSync(noBridge, 'other: 1\n', 'utf-8');
    expect((await loadTraeBridgeConfigFromYaml(noBridge, { env: {} })).poll_interval_seconds).toBe(2.0);
  });

  it('bridge 段部分覆盖（类型非法的字段被忽略）', async () => {
    const dir = makeTmpDir();
    const partial = path.join(dir, 'partial.yaml');
    writeFileSync(
      partial,
      'bridge:\n  default_timeout_seconds: 60\n  poll_interval_seconds: "not-a-number"\n',
      'utf-8',
    );
    const config = await loadTraeBridgeConfigFromYaml(partial, { env: {} });
    expect(config.default_timeout_seconds).toBe(60);
    expect(config.poll_interval_seconds).toBe(2.0); // 非法类型回退默认
  });
});

describe('makeTraeClientConfig', () => {
  it('默认值（mode=bridge/default_model=trae/session_persistence=true）', () => {
    expect(makeTraeClientConfig()).toMatchObject({
      mode: 'bridge',
      default_model: 'trae',
      session_persistence: true,
      max_retries: 3,
      timeout: 120,
    });
  });

  it('非法 mode 抛错（对齐 _validate_mode）', () => {
    expect(() => makeTraeClientConfig({ mode: 'websocket' as never })).toThrow(TypeError);
  });
});
