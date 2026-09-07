/**
 * external-connector-registry 契约测试。
 * 覆盖注册、configured 更新、枚举、注销、清空等。真实模块级注册表。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearExternalConnectorRegistry,
  getAllExternalConnectorMeta,
  registerExternalConnectorMeta,
  unregisterExternalConnectorMeta,
  updateExternalConnectorConfigured,
  type ExternalConnectorMeta,
} from '../src/index.ts';
import type { ConnectorDefinition } from '@flowforge/cats-shared';

function meta(id: string, extra: Partial<ExternalConnectorMeta> = {}): ExternalConnectorMeta {
  const definition: ConnectorDefinition = {
    id,
    name: id,
    displayName: id,
    description: '',
    icon: { type: 'svg', iconId: id },
  } as unknown as ConnectorDefinition;
  return {
    id,
    definition,
    requiredEnvKeys: ['TOKEN'],
    optionalEnvKeys: [],
    configured: false,
    ...extra,
  };
}

describe('ExternalConnectorRegistry', () => {
  beforeEach(() => clearExternalConnectorRegistry());

  it('register/getAll/update 往返', () => {
    registerExternalConnectorMeta(meta('feishu-ext'));
    registerExternalConnectorMeta(meta('telegram-ext'));
    expect(getAllExternalConnectorMeta()).toHaveLength(2);

    updateExternalConnectorConfigured('feishu-ext', true);
    const feishu = getAllExternalConnectorMeta().find((m) => m.id === 'feishu-ext');
    expect(feishu?.configured).toBe(true);
  });

  it('update 对未注册 id 为 no-op（不崩溃）', () => {
    expect(() => updateExternalConnectorConfigured('nope', true)).not.toThrow();
  });

  it('unregister 移除单项', () => {
    registerExternalConnectorMeta(meta('feishu-ext'));
    registerExternalConnectorMeta(meta('telegram-ext'));
    unregisterExternalConnectorMeta('feishu-ext');
    expect(getAllExternalConnectorMeta().map((m) => m.id)).toEqual(['telegram-ext']);
  });

  it('clear 清空注册表', () => {
    registerExternalConnectorMeta(meta('feishu-ext'));
    clearExternalConnectorRegistry();
    expect(getAllExternalConnectorMeta()).toHaveLength(0);
  });
});