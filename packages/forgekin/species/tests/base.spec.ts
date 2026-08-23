/**
 * base — ForgekinBase 抽象基类契约验证（对齐 Python base.py）。
 *
 * 覆盖：构造校验 / buildSystemPrompt / chat 降级与注入 / 异常重试判定 /
 * canSelfEvolve / canForgeNewForgekin / describe。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import { forgeSoulImprint } from '@flowforge/forgekin-soul';
import { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinBase, isRetryableError, type ForgekinChatMessage } from '../src/base.js';
import { ForgekinSpecies } from '../src/species-enum.js';
import { VirtualForgekin } from '../src/impl/virtual.js';

function makeImprint(name = '鲁班') {
  return forgeSoulImprint({ name, species: 'virtual' }, ['不伤害 operator'], 'flowlight');
}

describe('构造校验', () => {
  it('forgekin_id / name 为空或缺 soul_imprint 抛错', () => {
    const imprint = makeImprint();
    expect(
      () => new VirtualForgekin({ forgekin_id: ' ', name: '鲁班', soul_imprint: imprint }),
    ).toThrow('forgekin_id');
    expect(
      () => new VirtualForgekin({ forgekin_id: 'fk-1', name: '  ', soul_imprint: imprint }),
    ).toThrow('name');
  });

  it('默认阶 E1/E1 + lifecycle=created', () => {
    const fk = new VirtualForgekin({ forgekin_id: 'fk-1', name: '鲁班', soul_imprint: makeImprint() });
    expect(fk.evolutionStage).toBe(EvolutionStage.E1);
    expect(fk.awakeningStage).toBe(AwakeningStage.E1);
    expect(fk.lifecycle_state).toBe('created');
    expect(fk.species).toBe(ForgekinSpecies.VIRTUAL);
  });
});

describe('buildSystemPrompt', () => {
  it('包含角色/形态/阶/价值锚点/行为准则', () => {
    const fk = new VirtualForgekin({
      forgekin_id: 'fk-1',
      name: '鲁班',
      soul_imprint: makeImprint(),
      forgekin_config: {
        role: { description: '机关造物大师' },
        personality: { summary: '沉稳务实' },
        capability_profile: { native_abilities: ['木工'], blind_spots: ['即兴创作'] },
        value_anchors: ['不伤害 operator'],
        restrictions: { forbidden_actions: ['绕过逃生舱'] },
      },
    });
    const prompt = fk.buildSystemPrompt();
    expect(prompt).toContain('你是 鲁班');
    expect(prompt).toContain('机关造物大师');
    expect(prompt).toContain('沉稳务实');
    expect(prompt).toContain('木工');
    expect(prompt).toContain('即兴创作');
    expect(prompt).toContain('不伤害 operator');
    expect(prompt).toContain('绕过逃生舱');
    expect(prompt).toContain('Magic Words 逃生舱始终可触发');
  });
});

describe('chat', () => {
  it('未注入 LLM 客户端时返回降级响应', async () => {
    const fk = new VirtualForgekin({ forgekin_id: 'fk-1', name: '鲁班', soul_imprint: makeImprint() });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(String(result['content'])).toContain('降级响应');
    expect(result['model']).toBe('none');
    expect(result['forgekin_id']).toBe('fk-1');
    expect(result['session_id']).toBe('fk-1');
  });

  it('注入客户端：system prompt 前置 + 默认参数 + 补全 forgekin_id/session_id', async () => {
    const seen: { messages?: ForgekinChatMessage[]; options?: Record<string, unknown> } = {};
    const fk = new VirtualForgekin({
      forgekin_id: 'fk-1',
      name: '鲁班',
      soul_imprint: makeImprint(),
      forgekin_config: { llm: { session_id_prefix: 'luban-chat' } },
      llm_client: {
        chat: async (messages, options) => {
          seen.messages = [...messages];
          seen.options = { ...options };
          return { content: '回答' };
        },
      },
    });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(seen.messages?.[0]?.role).toBe('system');
    expect(seen.messages?.[1]?.content).toBe('你好');
    expect(seen.options?.['temperature']).toBe(0.7);
    expect(seen.options?.['max_tokens']).toBe(8192);
    expect(seen.options?.['session_id']).toBe('luban-chat');
    expect(result['content']).toBe('回答');
    expect(result['forgekin_id']).toBe('fk-1');
  });

  it('客户端异常 → 错误响应并标注可重试性', async () => {
    const fk = new VirtualForgekin({
      forgekin_id: 'fk-1',
      name: '鲁班',
      soul_imprint: makeImprint(),
      llm_client: {
        chat: async () => {
          throw new Error('fetch failed');
        },
      },
    });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(result['error_type']).toBe('retryable');
    expect(result['retryable']).toBe(true);
  });

  it('配置类异常标记不可重试', async () => {
    const fk = new VirtualForgekin({
      forgekin_id: 'fk-1',
      name: '鲁班',
      soul_imprint: makeImprint(),
      llm_client: {
        chat: async () => {
          throw new Error('invalid api key');
        },
      },
    });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(result['error_type']).toBe('config');
    expect(result['retryable']).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('AbortError / TimeoutError / 网络消息可重试', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isRetryableError(abort)).toBe(true);
    expect(isRetryableError(new Error('Request Timeout'))).toBe(true);
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('bad config'))).toBe(false);
    expect(isRetryableError('string')).toBe(false);
  });
});

describe('能力判定 / describe', () => {
  it('E1 不可自进化也不可锻造新 Forgekin；高阶可', () => {
    const fk = new VirtualForgekin({ forgekin_id: 'fk-1', name: '鲁班', soul_imprint: makeImprint() });
    expect(fk.canSelfEvolve()).toBe(false);
    expect(fk.canForgeNewForgekin()).toBe(false);
    fk.awakeningStage = AwakeningStage.E4;
    fk.evolutionStage = EvolutionStage.E6;
    expect(fk.canSelfEvolve()).toBe(true);
    expect(fk.canForgeNewForgekin()).toBe(true);
  });

  it('describe 含谱系字段', () => {
    const imprint = makeImprint();
    const fk = new VirtualForgekin({ forgekin_id: 'fk-1', name: '鲁班', soul_imprint: imprint });
    const desc = fk.describe();
    expect(desc['imprint_hash']).toBe(imprint.imprintHash);
    expect(desc['namespace']).toBe('flowlight');
    expect(desc['species_chinese']).toBe('虚拟Forgekin');
    expect(fk.toString()).toContain('fk-1');
  });
});

describe('抽象类不可直接实例化', () => {
  it('ForgekinBase 为 abstract（子类覆盖才可用）', () => {
    // 编译期约束；运行期以子类行为准
    expect(typeof ForgekinBase).toBe('function');
    expect(new VirtualForgekin({ forgekin_id: 'fk-1', name: '鲁班', soul_imprint: makeImprint() })).toBeInstanceOf(ForgekinBase);
  });
});
