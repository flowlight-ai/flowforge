/**
 * EmbodimentService — T6.4 Cordis 插件挂载契约验证。
 *
 * 覆盖：
 * - `ctx.plugin(EmbodimentService)` 挂载 ctx.limbEmbodiment 服务句柄
 * - putBinding/getBinding/getBindingsByThread/removeBinding 代理
 * - loadDeclaration 便捷入口（临时 YAML）
 * - 默认导出 Plugin 函数等价挂载；注入自定义 store
 *
 * @module @flowforge/limb-embodiment/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import EmbodimentPlugin, { EmbodimentService } from '../src/index.ts';
import { MemoryLimbEmbodimentBindingStore } from '../src/index.ts';

const BINDING = {
  nodeId: 'camera-01',
  userId: 'user-1',
  threadId: 'thread-a',
  catId: 'cat_a',
  expressionRef: 'calm',
  voiceProfileRef: 'default',
  volumePercent: 70,
  updatedAt: 1000,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'limb-embodiment-svc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('EmbodimentService Cordis 插件挂载', () => {
  it('ctx.plugin(EmbodimentService) 挂载 ctx.limbEmbodiment', async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(EmbodimentService);

    expect(ctx.limbEmbodiment).toBeInstanceOf(EmbodimentService);
    expect(ctx.limbEmbodiment.store).toBeInstanceOf(MemoryLimbEmbodimentBindingStore);
    await fiber.dispose();
  });

  it('默认导出 Plugin 函数等价挂载', async () => {
    const ctx = new Context();
    await EmbodimentPlugin(ctx);
    expect(ctx.limbEmbodiment).toBeInstanceOf(EmbodimentService);
  });

  it('绑定代理方法全链路', async () => {
    const ctx = new Context();
    await ctx.plugin(EmbodimentService);

    expect(await ctx.limbEmbodiment.getBinding('camera-01')).toBeUndefined();
    await ctx.limbEmbodiment.putBinding(BINDING);
    expect((await ctx.limbEmbodiment.getBinding('camera-01'))?.catId).toBe('cat_a');
    expect(await ctx.limbEmbodiment.getBindingsByThread('thread-a')).toHaveLength(1);
    expect(await ctx.limbEmbodiment.getBindingsByThread('other')).toHaveLength(0);

    await ctx.limbEmbodiment.removeBinding('camera-01');
    expect(await ctx.limbEmbodiment.getBinding('camera-01')).toBeUndefined();
  });

  it('loadDeclaration 从临时 YAML 加载声明', () => {
    const p = join(dir, 'limb.yml');
    writeFileSync(
      p,
      `nodeId: cam
displayName: Camera
platform: linux
capabilities: []
commands: {}
`,
      'utf-8',
    );
    const svc = new EmbodimentService(new Context());
    const declaration = svc.loadDeclaration(p);
    expect(declaration.nodeId).toBe('cam');
  });

  it('注入自定义 store 生效', async () => {
    const ctx = new Context();
    const custom = new MemoryLimbEmbodimentBindingStore();
    await ctx.plugin(EmbodimentService, { store: custom });
    expect(ctx.limbEmbodiment.store).toBe(custom);
  });
});
